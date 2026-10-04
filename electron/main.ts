import { spawn, spawnSync } from "child_process";
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  dialog,
  Menu,
  powerSaveBlocker,
  screen,
  session,
  shell,
} from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import { MusicLibraryStore } from "./music-library";
import { MUSIC_EXTENSIONS, type MusicLibraryUpdate } from "../lib/music";
import type { DesktopApiRequest, ElectronBridge, ExportFormat } from "../lib/desktop-bridge";
import { normalizeFeatureRequestInput, type FeatureRequestResult } from "../lib/feature-request";
import * as licenseSvc from "./license-service";
import { backupDatabaseBeforeUpgrade } from "../server/db-backup";
import {
  BACKUP_ROOT_DIR,
  RESTORE_PENDING_DIR,
  RESTORE_READY_MARKER,
  applyPendingRestore,
  inspectBackupDir,
  stageConfigFiles,
  stageDirectory,
  stageExternalFiles,
  takeRestoreFollowup,
  writeManifest,
  type BackupManifest,
} from "../server/venue-backup";
import {
  choiceFromScreen,
  normalizeStadiumScreenChoice,
  numberScreens,
  pickStadiumScreen,
  type ScreenInfo,
  type StadiumScreenChoice,
  type StadiumScreensPayload,
} from "../lib/stadium-screen";
import { startMobileBridge, type MobileBridgeHandle } from "./mobile-bridge";
import { startStreamDeck, type StreamDeckHandle } from "./stream-deck";
import { startCloudControlAgent, type CloudAgentHandle } from "./cloud-control";
import { getAppResourceMetrics, getMemoryBreakdownForBootLog } from "./resource-metrics";
import { menuLabel, normalizeMenuLocale } from "./menu-i18n";
import {
  createLivestreamController,
  type BrowserSourceRequest,
  type LivestreamController,
  type MediaSourceRequest,
  type StreamWindowRequest,
} from "./livestream";
import { sanitizeBrowserUrl, type LivestreamSettings } from "../lib/livestream";

/**
 * Portable Windows-build (electron-builder): `userData` naar een map naast de .exe
 * (`stadium-portable-data`). De control-UI laadt als `file://…/index.html`; als dat pad
 * per sessie in een andere unpack-map ligt, wisselt de localStorage-origin en lijkt de
 * wedstrijd-tablay-out telkens terug te vallen op standaard. Vaste userData voorkomt dat
 * en bewaart database, uploads en `control-match-tab-layout.json` bij de portable.
 *
 * Moet vóór `app.whenReady()` en vóór elke andere `app.getPath("userData")`-aanroep.
 *
 * Na het omzetten van userData: kopieer zo nodig uit de vorige standaard-locatie (%AppData%/…):
 * - machine-id + licentie (anders tweede “installatie” op dezelfde sleutel)
 * - `data/` (Prisma/stadium.db: teams, wedstrijden, media, …), `uploads/`, control-tab lay-out
 */
function migrateArenaCueIdentityFromDefaultUserData(defaultUserData: string, portableUserData: string): void {
  if (path.resolve(defaultUserData) === path.resolve(portableUserData)) return;
  const fromM = path.join(defaultUserData, licenseSvc.ARENACUE_MACHINE_ID_FILENAME);
  const fromL = path.join(defaultUserData, licenseSvc.ARENACUE_LICENSE_FILENAME);
  const toM = path.join(portableUserData, licenseSvc.ARENACUE_MACHINE_ID_FILENAME);
  const toL = path.join(portableUserData, licenseSvc.ARENACUE_LICENSE_FILENAME);
  try {
    if (!fs.existsSync(fromM) && !fs.existsSync(fromL)) return;
    fs.mkdirSync(portableUserData, { recursive: true });

    if (!fs.existsSync(toM) && !fs.existsSync(toL)) {
      if (fs.existsSync(fromM)) fs.copyFileSync(fromM, toM);
      if (fs.existsSync(fromL)) fs.copyFileSync(fromL, toL);
      console.log("[electron] portable: machine-id/licentie overgezet van standaard userData");
      return;
    }

    // Random machine-id werd al geschreven vóór geslaagde activatie; licentie staat nog in Roaming.
    if (!fs.existsSync(toL) && fs.existsSync(fromL) && fs.existsSync(fromM)) {
      fs.copyFileSync(fromM, toM);
      fs.copyFileSync(fromL, toL);
      console.log("[electron] portable: machine-id/licentie hersteld van standaard userData");
    }
  } catch (e) {
    console.error("[electron] portable migrate arenacue-bestanden:", e);
  }
}

/** Zolang de portable-map nog geen `data/stadium.db` heeft: volledige venue-kopie uit Roaming. */
function migrateStadiumVenueBundleFromDefaultUserData(defaultUserData: string, portableUserData: string): void {
  if (path.resolve(defaultUserData) === path.resolve(portableUserData)) return;
  const fromDb = path.join(defaultUserData, "data", "stadium.db");
  const toDb = path.join(portableUserData, "data", "stadium.db");
  try {
    if (!fs.existsSync(fromDb)) return;
    if (fs.existsSync(toDb)) return;

    const fromData = path.join(defaultUserData, "data");
    const toData = path.join(portableUserData, "data");
    fs.mkdirSync(toData, { recursive: true });
    fs.cpSync(fromData, toData, { recursive: true });

    const fromUploads = path.join(defaultUserData, "uploads");
    const toUploads = path.join(portableUserData, "uploads");
    if (fs.existsSync(fromUploads)) {
      fs.mkdirSync(toUploads, { recursive: true });
      fs.cpSync(fromUploads, toUploads, { recursive: true });
    }

    const layoutName = "control-match-tab-layout.json";
    const fromLayout = path.join(defaultUserData, layoutName);
    const toLayout = path.join(portableUserData, layoutName);
    if (fs.existsSync(fromLayout) && !fs.existsSync(toLayout)) {
      fs.copyFileSync(fromLayout, toLayout);
    }

    console.log("[electron] portable: venue-data (database, uploads, lay-out) overgezet van standaard userData");
  } catch (e) {
    console.error("[electron] portable migrate venue-data:", e);
  }
}

function applyPortableUserDataPathEarly(): void {
  const isolatedDevDir = process.env.ARENACUE_USER_DATA_DIR?.trim();
  if (isolatedDevDir) {
    try {
      const dataRoot = path.resolve(isolatedDevDir);
      fs.mkdirSync(dataRoot, { recursive: true });
      app.setPath("userData", dataRoot);
      console.log(`[electron] isolated userData → ${dataRoot}`);
    } catch (e) {
      console.error("[electron] isolated userData:", e);
    }
    return;
  }

  const fromDir = process.env.PORTABLE_EXECUTABLE_DIR?.trim();
  const fromFile = process.env.PORTABLE_EXECUTABLE_FILE?.trim();
  const base =
    fromDir && fromDir.length > 0
      ? fromDir
      : fromFile && fromFile.length > 0
        ? path.dirname(fromFile)
        : "";
  if (!base) return;
  const dataRoot = path.join(base, "stadium-portable-data");
  try {
    const defaultUserData = app.getPath("userData");
    fs.mkdirSync(dataRoot, { recursive: true });
    app.setPath("userData", dataRoot);
    migrateArenaCueIdentityFromDefaultUserData(defaultUserData, dataRoot);
    migrateStadiumVenueBundleFromDefaultUserData(defaultUserData, dataRoot);
    console.log(`[electron] portable userData → ${dataRoot}`);
  } catch (e) {
    console.error("[electron] portable userData:", e);
  }
}

applyPortableUserDataPathEarly();

const IS_DEV = !app.isPackaged;
const VIDEO_DECODE_FALLBACK_FLAG = "disable-accelerated-video-decode.flag";

function videoDecodeFallbackFlagPath(): string {
  return path.join(app.getPath("userData"), VIDEO_DECODE_FALLBACK_FLAG);
}

function videoDecodeFallbackEnabled(): boolean {
  if (process.env.STADIUM_ENABLE_ACCELERATED_VIDEO_DECODE === "1") return false;
  if (process.env.STADIUM_DISABLE_ACCELERATED_VIDEO_DECODE === "1") return true;
  try {
    return fs.existsSync(videoDecodeFallbackFlagPath());
  } catch {
    return false;
  }
}

function enableVideoDecodeFallbackFlag(reason: string): void {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(
      videoDecodeFallbackFlagPath(),
      `${new Date().toISOString()} ${reason}\n`,
      "utf8",
    );
  } catch (e) {
    bootLog(`[gpu-fallback] kon fallback-vlag niet schrijven: ${String(e)}`);
  }
}

/**
 * Windows Direct Composition legt hardware-video in een aparte overlay-plane.
 * Naast HTML (L-frame scorebord) wordt dat vlak zwart; fullscreen-video blijft zichtbaar.
 * Canvas-compositing in de renderer vangt dit ook op; deze flag voorkomt de overlay-plane.
 */
if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-direct-composition-video-overlays");
  console.log("[electron] disable-direct-composition-video-overlays actief");
}

/**
 * Alleen op verzoek of na GPU-crash-vlag: software-decode (zwaarder op CPU).
 */
if (videoDecodeFallbackEnabled()) {
  app.commandLine.appendSwitch("disable-accelerated-video-decode");
  console.log("[electron] disable-accelerated-video-decode actief");
}

/**
 * Volledige software-rendering (minder GPU-stress; meer CPU). Bij wit/corrupt beeld na
 * zware sponsorvideo of driver-bugs: zet vóór start `STADIUM_DISABLE_HARDWARE_ACCELERATION=1`.
 * Moet vóór `app.ready` — daarom direct bij module-load.
 */
if (process.env.STADIUM_DISABLE_HARDWARE_ACCELERATION === "1") {
  app.disableHardwareAcceleration();
  console.log("[electron] STADIUM_DISABLE_HARDWARE_ACCELERATION=1 → disableHardwareAcceleration()");
}

/** Minder GPU-compositing; soms helpt tegen artefacten na driver/GPU-overbelasting. */
if (process.env.STADIUM_DISABLE_GPU_COMPOSITING === "1") {
  app.commandLine.appendSwitch("disable-gpu-compositing");
  console.log("[electron] STADIUM_DISABLE_GPU_COMPOSITING=1 → disable-gpu-compositing");
}

let controlWindow: BrowserWindow | null = null;
let displayWindow: BrowserWindow | null = null;
let streamWindow: BrowserWindow | null = null;
let browserSourceWindow: BrowserWindow | null = null;
let browserInteractWindow: BrowserWindow | null = null;
let mediaSourceWindow: BrowserWindow | null = null;
let gpuCrashStreak = 0;
let lastGpuCrashAt = 0;
let displayPreviewCaptureUsers = 0;
let displayPreviewTimer: ReturnType<typeof setInterval> | null = null;
let displayPreviewBusy = false;
/** True na bevestigde afsluiting of fatale fout — slaat de quit-waarschuwing over. */
let allowQuitWithoutConfirm = process.env.ARENACUE_QUIT_WITHOUT_CONFIRM === "1";

/** Laatste gemelde stadion-afspeelcontext (IPC van display-renderer). */
let lastDisplayPlaybackSummary = "—";

function fileBaseOnly(p: unknown): string | undefined {
  if (typeof p !== "string" || !p.trim()) return undefined;
  const s = p.replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return (i >= 0 ? s.slice(i + 1) : s).slice(0, 200);
}

function sanitizePlaybackPayload(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "—";
  const o = raw as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof o.source === "string") parts.push(`src=${o.source}`);
  if (typeof o.mode === "string") parts.push(`mode=${o.mode}`);
  if (typeof o.section === "string") parts.push(`sec=${o.section}`);
  if (typeof o.matchId === "string" && o.matchId) parts.push(`match=${o.matchId.slice(0, 14)}`);
  if (typeof o.sponsorId === "string" && o.sponsorId) parts.push(`spon=${o.sponsorId.slice(0, 14)}`);
  if (typeof o.mediaId === "string" && o.mediaId) parts.push(`mediaId=${o.mediaId.slice(0, 18)}`);
  if (typeof o.mediaType === "string") parts.push(`type=${o.mediaType}`);
  if (typeof o.mediaTitle === "string" && o.mediaTitle)
    parts.push(`title=${String(o.mediaTitle).slice(0, 72)}`);
  const bn = fileBaseOnly(o.mediaPath);
  if (bn) parts.push(`file=${bn}`);
  if (o.followMode === true) parts.push("follow=1");
  if (o.paused === true) parts.push("paused=1");
  if (typeof o.playlistId === "string" && o.playlistId) parts.push(`pl=${o.playlistId.slice(0, 12)}`);
  if (o.heartbeat === true) parts.push("hb=1");
  if (typeof o.atMs === "number") parts.push(`at=${o.atMs}`);
  const line = parts.join(" ");
  return line.length > 950 ? `${line.slice(0, 950)}…` : line;
}

function setLastDisplayPlaybackFromIpc(raw: unknown) {
  lastDisplayPlaybackSummary = sanitizePlaybackPayload(raw);
}

function sanitizeMediaDiagnostic(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "—";
  const o = raw as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof o.source === "string") parts.push(`src=${o.source}`);
  if (typeof o.event === "string") parts.push(`evt=${o.event}`);
  if (typeof o.mediaId === "string" && o.mediaId) parts.push(`id=${String(o.mediaId).slice(0, 22)}`);
  if (typeof o.mediaTitle === "string" && o.mediaTitle)
    parts.push(`title=${String(o.mediaTitle).slice(0, 72)}`);
  const bn = fileBaseOnly(o.mediaPath);
  if (bn) parts.push(`file=${bn}`);
  if (typeof o.mediaErrorCode === "number") parts.push(`errCode=${o.mediaErrorCode}`);
  if (typeof o.mediaErrorMessage === "string" && o.mediaErrorMessage)
    parts.push(`errMsg=${String(o.mediaErrorMessage).slice(0, 120)}`);
  if (typeof o.readyState === "number") parts.push(`rs=${o.readyState}`);
  if (typeof o.networkState === "number") parts.push(`ns=${o.networkState}`);
  if (typeof o.currentTime === "number") parts.push(`t=${o.currentTime}`);
  if (typeof o.droppedFrames === "number") parts.push(`drop=${o.droppedFrames}`);
  if (typeof o.totalVideoFrames === "number") parts.push(`frames=${o.totalVideoFrames}`);
  if (typeof o.atMs === "number") parts.push(`at=${o.atMs}`);
  const line = parts.join(" ");
  return line.length > 950 ? `${line.slice(0, 950)}…` : line;
}

function bootPlaybackContextSuffix(): string {
  return ` | lastPlayback=${lastDisplayPlaybackSummary}`;
}

function startBootMetricsLogging() {
  const raw = process.env.STADIUM_BOOT_METRICS_MS;
  const intervalMs = raw === "" || raw === "0" ? 0 : Number(raw ?? "300000");
  if (!Number.isFinite(intervalMs) || intervalMs < 60_000) return;
  const tick = () => {
    try {
      const m = getAppResourceMetrics();
      const br = getMemoryBreakdownForBootLog();
      bootLog(
        `[metrics] ramTotal=${m.ramTotalMb}MB gpuRam=${m.gpuRamMb}MB cpu≈${m.cpuTotalPercent}% | ${br}${bootPlaybackContextSuffix()}`,
      );
    } catch (e) {
      bootLog(`[metrics] error ${String(e)}`);
    }
  };
  tick();
  setInterval(tick, intervalMs);
}
let runtime: typeof import("./runtime") | null = null;
let desktopContext: ElectronBridge["context"] | null = null;
let mobileBridge: MobileBridgeHandle | null = null;
let cloudAgent: CloudAgentHandle | null = null;
let livestream: LivestreamController | null = null;
let streamDeck: StreamDeckHandle | null = null;
let splashWindow: BrowserWindow | null = null;

function bootLogPath(): string {
  return path.join(app.getPath("userData"), "boot.log");
}

function isBrokenPipeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EPIPE"
  );
}

let terminalOutputAvailable = true;

const handleTerminalOutputError = (error: NodeJS.ErrnoException) => {
  if (isBrokenPipeError(error)) {
    // A detached/closed launcher may invalidate stdout while the desktop app keeps
    // running. Logging to boot.log must continue without creating an exception loop.
    terminalOutputAvailable = false;
  }
};

process.stdout?.on("error", handleTerminalOutputError);
process.stderr?.on("error", handleTerminalOutputError);

/**
 * Logger zonder synchrone I/O op de main thread: regels worden gebufferd en met één append per
 * event-loop-tick weggeschreven. Rotatie: boot.log → boot.log.1 zodra 5 MB is bereikt (geen
 * 5 MB read+rewrite meer midden in een wedstrijd).
 */
const BOOT_LOG_MAX_BYTES = 5 * 1024 * 1024;
let bootLogBuffer: string[] = [];
let bootLogFlushScheduled = false;
let bootLogFlushing = false;
let bootLogApproxBytes: number | null = null;

function rotateBootLogIfNeeded(logFile: string, incomingBytes: number) {
  try {
    if (bootLogApproxBytes == null) {
      bootLogApproxBytes = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    }
    if (bootLogApproxBytes + incomingBytes > BOOT_LOG_MAX_BYTES) {
      const rotated = `${logFile}.1`;
      try {
        fs.rmSync(rotated, { force: true });
      } catch {
        /* ignore */
      }
      fs.renameSync(logFile, rotated);
      bootLogApproxBytes = 0;
    }
  } catch {
    bootLogApproxBytes = 0;
  }
}

function flushBootLog() {
  bootLogFlushScheduled = false;
  if (bootLogFlushing || bootLogBuffer.length === 0) return;
  const chunk = bootLogBuffer.join("");
  bootLogBuffer = [];
  bootLogFlushing = true;
  const logFile = bootLogPath();
  rotateBootLogIfNeeded(logFile, chunk.length);
  fs.appendFile(logFile, chunk, "utf8", () => {
    bootLogFlushing = false;
    bootLogApproxBytes = (bootLogApproxBytes ?? 0) + chunk.length;
    if (bootLogBuffer.length > 0) scheduleBootLogFlush();
  });
}

function scheduleBootLogFlush() {
  if (bootLogFlushScheduled) return;
  bootLogFlushScheduled = true;
  setImmediate(flushBootLog);
}

/** Bij afsluiten of fatale fout: wat nog in de buffer zit synchroon wegschrijven. */
function flushBootLogSync() {
  if (bootLogBuffer.length === 0) return;
  const chunk = bootLogBuffer.join("");
  bootLogBuffer = [];
  try {
    fs.appendFileSync(bootLogPath(), chunk, "utf8");
  } catch {
    /* ignore */
  }
}

function bootLog(line: string) {
  const lineWithNl = `[${new Date().toISOString()}] ${line}\n`;
  try {
    bootLogBuffer.push(lineWithNl);
    scheduleBootLogFlush();
  } catch {
    /* ignore */
  }
  if (terminalOutputAvailable) {
    try {
      console.log(line);
    } catch (error) {
      if (isBrokenPipeError(error)) terminalOutputAvailable = false;
    }
  }
}

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  bootLog(`[process] unhandledRejection ${msg}`);
});

process.on("uncaughtException", (error) => {
  if (isBrokenPipeError(error)) {
    terminalOutputAvailable = false;
    return;
  }
  bootLog(`[process] uncaughtException ${error.name}: ${error.message}`);
  if (allowQuitWithoutConfirm) {
    flushBootLogSync();
    app.exit(1);
    return;
  }
  allowQuitWithoutConfirm = true;
  try {
    app.relaunch();
  } catch (e) {
    bootLog(`[process] relaunch na uncaughtException mislukt ${String(e)}`);
  }
  flushBootLogSync();
  app.exit(1);
});

app.on("will-quit", () => {
  stopDisplayPreviewCapture();
  flushBootLogSync();
});

function appRoot(): string {
  return IS_DEV ? path.join(__dirname, "..", "..") : app.getAppPath();
}

function rendererEntryPath(): string {
  return path.join(appRoot(), "renderer-dist", "index.html");
}

/** ArenaCue-icoon voor vensters (.exe-icoon komt van electron-builder `build.icon`). */
function windowIconPath(): string | undefined {
  const p = path.join(appRoot(), "public", "app-icon.png");
  try {
    if (fs.existsSync(p)) {
      return p;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/**
 * SQLite kent één schrijver tegelijk; met één connectie in de Prisma-pool gelden `busy_timeout` en
 * WAL-instellingen voor élke query en verdwijnt "database is locked" tussen tick-loop en commando's.
 */
function prismaDatabaseUrl(dbPath: string): string {
  return `file:${dbPath.replace(/\\/g, "/")}?connection_limit=1`;
}

function configureDesktopContext() {
  const root = appRoot();
  const userDataDir = app.getPath("userData");
  const dataDir = path.join(userDataDir, "data");
  const uploadsDir = path.join(userDataDir, "uploads");

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });

  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = IS_DEV ? "development" : "production";
  env.DATABASE_URL = prismaDatabaseUrl(path.join(dataDir, "stadium.db"));
  env.STADIUM_UPLOADS_DIR = uploadsDir;
  env.STADIUM_APP_ROOT = root;
  const ffmpegExe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const bundledFfmpeg = path.join(root, "vendor", "ffmpeg", ffmpegExe);
  if (!env.STADIUM_FFMPEG_PATH && fs.existsSync(bundledFfmpeg)) {
    env.STADIUM_FFMPEG_PATH = bundledFfmpeg;
  }

  bootLog(`appRoot=${root} packaged=${app.isPackaged}`);
  bootLog(
    `userDataDir=${userDataDir} portableEnv=${Boolean(process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE)}`,
  );
  bootLog(`DATABASE_URL=${process.env.DATABASE_URL}`);

  // Een klaargezette venue-back-up omwisselen terwijl nog niets de database open heeft.
  const restore = applyPendingRestore({ userDataDir, appVersion: app.getVersion() });
  if (restore.kind === "applied") {
    bootLog(`[restore] back-up teruggezet; vorige gegevens in ${restore.followup.safetyDir}`);
  } else if (restore.kind === "failed") {
    bootLog(`[restore] terugzetten mislukt, oude gegevens behouden: ${restore.error}`);
    restoreNotice = { kind: "failed", error: restore.error };
  }

  // Vóór de runtime de database opent en het schema bijwerkt: één kopie per nieuwe versie.
  const backup = backupDatabaseBeforeUpgrade({ dataDir, version: app.getVersion() });
  if (backup.kind === "created") {
    bootLog(`[db-backup] kopie vóór update (van ${backup.fromVersion ?? "onbekende versie"}) in ${backup.dir}`);
  } else if (backup.kind === "failed") {
    bootLog(`[db-backup] kopie vóór update mislukt: ${backup.error}`);
  }

  return {
    isElectron: true as const,
    appRoot: root,
    userDataDir,
    uploadsDir,
  };
}

async function loadRuntime() {
  desktopContext = configureDesktopContext();
  runtime = await import("./runtime");
  await runtime.initDesktopRuntime({
    getControlWindow: () => controlWindow,
    getDisplayWindow: () => displayWindow,
    getStreamWindow: () => streamWindow,
    log: bootLog,
    onUiLocaleChanged: () => {
      void buildMenu();
    },
  });
  await finishRestoreAfterStart();
  await buildMenu();
  mobileBridge = await startMobileBridge({
    runtime: {
      apiRequest: (req) => runtime!.apiRequest(req),
      getDisplaySnapshot: () => runtime!.getDisplaySnapshot(),
      getSponsorLedgerSnapshot: () => runtime!.getSponsorLedgerSnapshot(),
      runCommand: (command) => runtime!.runCommand(command as any),
    },
    log: bootLog,
    credentialsPath: path.join(app.getPath("userData"), "mobile-bridge-credentials.json"),
  });
  cloudAgent = startCloudControlAgent({
    runtime: {
      apiRequest: (req) => runtime!.apiRequest(req),
      getDisplaySnapshot: () => runtime!.getDisplaySnapshot(),
      runCommand: (command) => runtime!.runCommand(command as any),
    },
    log: bootLog,
  });
}

function loadView(
  win: BrowserWindow,
  view: "control" | "display" | "stream" | "media",
  extra: Record<string, string> = {},
) {
  return win.loadFile(rendererEntryPath(), {
    query: { view, ...extra },
  });
}

let streamWindowOffscreen = false;

function streamWindowIsOffscreen(win: BrowserWindow): boolean {
  if (!streamWindowOffscreen) return false;
  try {
    const prefs = (win.webContents as Electron.WebContents & { getLastWebPreferences?: () => { offscreen?: boolean } }).getLastWebPreferences?.();
    if (prefs) return Boolean(prefs.offscreen);
  } catch {
    /* oudere typings */
  }
  return streamWindowOffscreen;
}

async function destroyStreamWindow() {
  streamWindowOffscreen = false;
  if (!streamWindow || streamWindow.isDestroyed()) {
    streamWindow = null;
    return;
  }
  const win = streamWindow;
  streamWindow = null;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1000);
    win.once("closed", () => {
      clearTimeout(timer);
      resolve();
    });
    win.destroy();
  });
}

async function ensureStreamWindow(req: StreamWindowRequest): Promise<{ win: BrowserWindow; reloaded: boolean }> {
  const cam = req.camera.trim();
  const extra = { camera: cam, overlay: req.overlay ? "1" : "0" };
  const applyFrameRate = (win: BrowserWindow) => {
    try {
      win.webContents.setFrameRate(req.fps);
      if (typeof win.webContents.startPainting === "function" && !win.webContents.isPainting()) {
        win.webContents.startPainting();
      }
    } catch {
      /* ignore */
    }
  };

  if (streamWindow && !streamWindow.isDestroyed()) {
    if (!streamWindowIsOffscreen(streamWindow)) {
      await destroyStreamWindow();
    }
  }

  if (streamWindow && !streamWindow.isDestroyed()) {
    const current = (() => {
      try {
        const url = new URL(streamWindow.webContents.getURL());
        return `${url.searchParams.get("camera") ?? ""}|${url.searchParams.get("overlay") ?? ""}`;
      } catch {
        return "";
      }
    })();
    const sizeChanged =
      streamWindow.getContentSize()[0] !== req.width || streamWindow.getContentSize()[1] !== req.height;
    if (sizeChanged) streamWindow.setContentSize(req.width, req.height);
    applyFrameRate(streamWindow);
    if (current === `${cam}|${extra.overlay}`) {
      return { win: streamWindow, reloaded: false };
    }
    await loadView(streamWindow, "stream", extra);
    applyFrameRate(streamWindow);
    return { win: streamWindow, reloaded: true };
  }

  const preload = path.join(__dirname, "preload.js");
  streamWindow = new BrowserWindow({
    width: req.width,
    height: req.height,
    useContentSize: true,
    title: "Stadium Scoreboard — Stream",
    backgroundColor: "#000000",
    frame: false,
    show: false,
    skipTaskbar: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: true,
    },
  });
  streamWindowOffscreen = true;
  streamWindow.on("closed", () => {
    streamWindow = null;
    streamWindowOffscreen = false;
  });
  await loadView(streamWindow, "stream", extra);
  applyFrameRate(streamWindow);
  return { win: streamWindow, reloaded: true };
}

function chromeUserAgent(): string {
  return session.defaultSession
    .getUserAgent()
    .replace(/\s*Electron\/\S+/g, "")
    .replace(/\s*stadium-scoreboard\/\S+/gi, "");
}

function applyBrowserSourceSession(): string {
  const ua = chromeUserAgent();
  session.fromPartition("persist:arenacue-browser").setUserAgent(ua);
  return ua;
}

function destroyBrowserSourceWindow(): Promise<void> {
  return new Promise((resolve) => {
    const win = browserSourceWindow;
    if (!win || win.isDestroyed()) {
      browserSourceWindow = null;
      resolve();
      return;
    }
    win.once("closed", () => {
      browserSourceWindow = null;
      resolve();
    });
    win.destroy();
  });
}

async function ensureBrowserSourceWindow(
  req: BrowserSourceRequest,
): Promise<{ win: BrowserWindow; reloaded: boolean }> {
  const url = req.url.trim();
  const ua = applyBrowserSourceSession();
  const applyFrameRate = (win: BrowserWindow) => {
    try {
      win.webContents.setUserAgent(ua);
      win.webContents.setAudioMuted(true);
      win.webContents.setFrameRate(req.fps);
      if (typeof win.webContents.startPainting === "function" && !win.webContents.isPainting()) {
        win.webContents.startPainting();
      }
    } catch {
      /* ignore */
    }
  };

  if (browserSourceWindow && !browserSourceWindow.isDestroyed()) {
    const sizeChanged =
      browserSourceWindow.getContentSize()[0] !== req.width ||
      browserSourceWindow.getContentSize()[1] !== req.height;
    if (sizeChanged) browserSourceWindow.setContentSize(req.width, req.height);
    applyFrameRate(browserSourceWindow);
    const current = (() => {
      try {
        return browserSourceWindow.webContents.getURL();
      } catch {
        return "";
      }
    })();
    if (current === url) return { win: browserSourceWindow, reloaded: false };
    await browserSourceWindow.loadURL(url, { userAgent: ua });
    applyFrameRate(browserSourceWindow);
    return { win: browserSourceWindow, reloaded: true };
  }

  browserSourceWindow = new BrowserWindow({
    width: req.width,
    height: req.height,
    useContentSize: true,
    title: "ArenaCue — Browserbron",
    backgroundColor: "#000000",
    frame: false,
    show: false,
    skipTaskbar: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: true,
      webviewTag: false,
      partition: "persist:arenacue-browser",
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  browserSourceWindow.on("closed", () => {
    browserSourceWindow = null;
  });
  applyFrameRate(browserSourceWindow);
  await browserSourceWindow.loadURL(url, { userAgent: ua }).catch(() => undefined);
  applyFrameRate(browserSourceWindow);
  return { win: browserSourceWindow, reloaded: true };
}

async function openBrowserSourceInteract(rawUrl: string): Promise<{ ok: boolean; error?: string }> {
  const url = sanitizeBrowserUrl(rawUrl);
  if (!url) return { ok: false, error: "Vul een website-URL in" };
  const ua = applyBrowserSourceSession();
  if (browserInteractWindow && !browserInteractWindow.isDestroyed()) {
    await browserInteractWindow.loadURL(url, { userAgent: ua }).catch(() => undefined);
    browserInteractWindow.show();
    browserInteractWindow.focus();
    return { ok: true };
  }
  browserInteractWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "ArenaCue — Inloggen / interactie",
    autoHideMenuBar: true,
    backgroundColor: "#111111",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:arenacue-browser",
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  browserInteractWindow.webContents.setUserAgent(ua);
  browserInteractWindow.webContents.setWindowOpenHandler(() => ({
    action: "allow",
    overrideBrowserWindowOptions: {
      width: 520,
      height: 740,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: "persist:arenacue-browser",
      },
    },
  }));
  browserInteractWindow.on("closed", () => {
    browserInteractWindow = null;
    if (browserSourceWindow && !browserSourceWindow.isDestroyed()) {
      browserSourceWindow.reload();
    }
  });
  await browserInteractWindow.loadURL(url, { userAgent: ua }).catch(() => undefined);
  return { ok: true };
}

function destroyMediaSourceWindow(): Promise<void> {
  return new Promise((resolve) => {
    const win = mediaSourceWindow;
    if (!win || win.isDestroyed()) {
      mediaSourceWindow = null;
      resolve();
      return;
    }
    win.once("closed", () => {
      mediaSourceWindow = null;
      resolve();
    });
    win.destroy();
  });
}

async function ensureMediaSourceWindow(
  req: MediaSourceRequest,
): Promise<{ win: BrowserWindow; reloaded: boolean }> {
  const filePath = req.path.trim();
  const extra = { path: filePath, loop: req.loop ? "1" : "0" };
  const applyFrameRate = (win: BrowserWindow) => {
    try {
      win.webContents.setFrameRate(req.fps);
      if (typeof win.webContents.startPainting === "function" && !win.webContents.isPainting()) {
        win.webContents.startPainting();
      }
    } catch {
      /* ignore */
    }
  };

  if (mediaSourceWindow && !mediaSourceWindow.isDestroyed()) {
    const sizeChanged =
      mediaSourceWindow.getContentSize()[0] !== req.width ||
      mediaSourceWindow.getContentSize()[1] !== req.height;
    if (sizeChanged) mediaSourceWindow.setContentSize(req.width, req.height);
    applyFrameRate(mediaSourceWindow);
    const current = (() => {
      try {
        return new URL(mediaSourceWindow.webContents.getURL());
      } catch {
        return null;
      }
    })();
    if (
      current?.searchParams.get("path") === filePath &&
      current.searchParams.get("loop") === extra.loop
    ) {
      return { win: mediaSourceWindow, reloaded: false };
    }
    await loadView(mediaSourceWindow, "media", extra);
    applyFrameRate(mediaSourceWindow);
    return { win: mediaSourceWindow, reloaded: true };
  }

  mediaSourceWindow = new BrowserWindow({
    width: req.width,
    height: req.height,
    useContentSize: true,
    title: "ArenaCue — Media",
    backgroundColor: "#000000",
    frame: false,
    show: false,
    skipTaskbar: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: true,
      webSecurity: false,
      webviewTag: false,
      preload: path.join(__dirname, "preload.js"),
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  mediaSourceWindow.on("closed", () => {
    mediaSourceWindow = null;
  });
  mediaSourceWindow.webContents.setAudioMuted(true);
  await loadView(mediaSourceWindow, "media", extra);
  applyFrameRate(mediaSourceWindow);
  return { win: mediaSourceWindow, reloaded: true };
}

/** De monitorkeuze hoort bij deze pc (kabels, poorten) en staat daarom naast, niet in, de database. */
function stadiumScreenFile(): string {
  return path.join(app.getPath("userData"), "stadium-screen.json");
}

function readStadiumScreenChoice(): StadiumScreenChoice | null {
  try {
    return normalizeStadiumScreenChoice(JSON.parse(fs.readFileSync(stadiumScreenFile(), "utf8")));
  } catch {
    return null;
  }
}

function writeStadiumScreenChoice(choice: StadiumScreenChoice | null) {
  const file = stadiumScreenFile();
  if (!choice) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.writeFileSync(file, JSON.stringify(choice, null, 2), "utf8");
}

function connectedScreens(): ScreenInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    label: d.label ?? "",
    x: d.bounds.x,
    y: d.bounds.y,
    width: d.bounds.width,
    height: d.bounds.height,
    primary: d.id === primaryId,
  }));
}

/**
 * Monitor voor het stadionscherm: de keuze van de operator. Zonder keuze, of als die monitor niet is
 * aangesloten, de niet-primaire (meestal HDMI → processor → muur), anders de primaire. Zo blijft de
 * taakbalk op de bedieningsmonitor staan.
 */
function stadiumDisplay() {
  const pick = pickStadiumScreen(connectedScreens(), readStadiumScreenChoice());
  const found = pick ? screen.getAllDisplays().find((d) => d.id === pick.screen.id) : undefined;
  return found ?? screen.getPrimaryDisplay();
}

function stadiumScreensPayload(): StadiumScreensPayload {
  const screens = connectedScreens();
  const choice = readStadiumScreenChoice();
  const pick = pickStadiumScreen(screens, choice);
  const scale = new Map(screen.getAllDisplays().map((d) => [d.id, d.scaleFactor]));
  return {
    screens: numberScreens(screens).map((row) => ({
      ...row,
      pixelWidth: Math.round(row.width * (scale.get(row.id) ?? 1)),
      pixelHeight: Math.round(row.height * (scale.get(row.id) ?? 1)),
      active: pick?.screen.id === row.id,
    })),
    via: pick?.via ?? "auto",
    missingLabel:
      pick?.via === "fallback" && choice ? choice.label || `${choice.width}×${choice.height}` : null,
  };
}

let identifyWindows: BrowserWindow[] = [];

function closeIdentifyWindows() {
  for (const win of identifyWindows) {
    try {
      if (!win.isDestroyed()) win.close();
    } catch {
      /* ignore */
    }
  }
  identifyWindows = [];
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Toont enkele seconden een groot nummer op elke monitor, zodat de operator weet welke welke is. */
function identifyScreens() {
  closeIdentifyWindows();
  const width = 380;
  const height = 250;
  for (const row of stadiumScreensPayload().screens) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
<style>
  body { margin: 0; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
    font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif; background: #09090b; color: #fafafa;
    border: 6px solid ${row.active ? "#22c55e" : "#3f3f46"}; box-sizing: border-box; }
  .n { font-size: 120px; font-weight: 900; line-height: 1; }
  .l { margin-top: 10px; font-size: 16px; color: #d4d4d8; max-width: 330px; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t { margin-top: 6px; font-size: 13px; font-weight: 700; letter-spacing: 0.16em; color: #22c55e; }
</style></head><body>
<div class="n">${row.number}</div>
<div class="l">${escapeHtml(row.label || "Monitor")} · ${row.pixelWidth} × ${row.pixelHeight}</div>
${row.active ? '<div class="t">SCOREBOARD</div>' : ""}
</body></html>`;
    const win = new BrowserWindow({
      x: Math.round(row.x + (row.width - width) / 2),
      y: Math.round(row.y + (row.height - height) / 2),
      width,
      height,
      frame: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      backgroundColor: "#09090b",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.once("ready-to-show", () => {
      if (!win.isDestroyed()) win.showInactive();
    });
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    identifyWindows.push(win);
  }
  const shown = identifyWindows;
  setTimeout(() => {
    if (identifyWindows === shown) closeIdentifyWindows();
  }, 4000);
}

function isLikelyVirtualAdapter(name: string): boolean {
  return /bluetooth|docker|hyper-v|loopback|npcap|tap|virtual|vmware|vethernet|wsl/i.test(name);
}

function localNetworkUrls(port: number): string[] {
  const primaryUrls: string[] = [];
  const fallbackUrls: string[] = [];
  const nets = os.networkInterfaces();
  for (const [name, entries] of Object.entries(nets)) {
    for (const net of entries ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      const url = `http://${net.address}:${port}`;
      if (isLikelyVirtualAdapter(name)) fallbackUrls.push(url);
      else primaryUrls.push(url);
    }
  }
  const urls = [...primaryUrls, ...fallbackUrls];
  return urls.length > 0 ? urls : [`http://localhost:${port}`];
}

function mobileLocalPairCodesWithPin(handle: MobileBridgeHandle, operatorPinForQr: string): string[] {
  return localNetworkUrls(handle.port).map((bridgeUrl) =>
    [
      "ACPAIR:local",
      encodeURIComponent(bridgeUrl),
      encodeURIComponent(handle.pairingCode),
      encodeURIComponent(operatorPinForQr),
    ].join("|"),
  );
}

function mobileLocalPairCodesViewer(handle: MobileBridgeHandle): string[] {
  return mobileLocalPairCodesWithPin(handle, "");
}

function mobileLocalPairCodesOperator(handle: MobileBridgeHandle): string[] {
  return mobileLocalPairCodesWithPin(handle, handle.operatorPin ?? "");
}

/**
 * Display-venster op de gekozen monitor in echte fullscreen — Windows verbergt dan de taakbalk op díé monitor.
 * (Werkgebied gebruiken zou juist ruimte voor de taakbalk vrijlaten.)
 */
function applyDisplayFullscreen(win: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return;
  try {
    const target = stadiumDisplay();
    const place = () => {
      if (win.isDestroyed()) return;
      const { x, y, width, height } = target.bounds;
      win.setBounds({ x, y, width, height });
      if (!win.isFullScreen()) win.setFullScreen(true);
    };
    // Een schermvullend venster laat zich niet naar een andere monitor verplaatsen: eerst uit fullscreen.
    if (win.isFullScreen() && screen.getDisplayMatching(win.getBounds()).id !== target.id) {
      let placed = false;
      const finish = () => {
        if (placed) return;
        placed = true;
        // Windows meldt "uit fullscreen" terwijl het venster nog terugspringt naar zijn oude plek;
        // pas daarna blijft de nieuwe plek staan.
        setTimeout(place, 150);
      };
      win.once("leave-full-screen", finish);
      setTimeout(finish, 700);
      win.setFullScreen(false);
      return;
    }
    place();
  } catch {
    try {
      win.maximize();
    } catch {
      /* ignore */
    }
  }
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    try {
      splashWindow.close();
    } catch {
      /* ignore */
    }
  }
  splashWindow = null;
}

function splashPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:" />
  <title>Stadium Scoreboard</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
      background: #09090b;
      color: #fafafa;
      -webkit-font-smoothing: antialiased;
    }
    .spinner {
      width: 42px;
      height: 42px;
      border: 3px solid #27272a;
      border-top-color: #22c55e;
      border-radius: 50%;
      animation: spin 0.75s linear infinite;
      margin-bottom: 20px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h1 { font-size: 15px; font-weight: 600; margin: 0 0 8px; letter-spacing: 0.02em; }
    p { font-size: 12px; color: #a1a1aa; margin: 0; text-align: center; max-width: 300px; line-height: 1.45; }
  </style>
</head>
<body>
  <div class="spinner" aria-hidden="true"></div>
  <h1>Stadium Scoreboard</h1>
  <p>Bezig met opstarten…<br />Database en bedieningsvenster worden geladen. Dit kan enkele seconden duren.</p>
</body>
</html>`;
}

function createSplashWindow() {
  closeSplashWindow();
  const winIcon = windowIconPath();
  const w = new BrowserWindow({
    width: 440,
    height: 300,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: true,
    backgroundColor: "#09090b",
    ...(winIcon ? { icon: winIcon } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  splashWindow = w;
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(splashPageHtml())}`;
  void w.loadURL(url);
}

/** Verberg splash zodra control klaar is om getoond te worden (of bij fout/timeout). */
function wireSplashUntilControlReady() {
  const ctrl = controlWindow;
  if (!ctrl) {
    closeSplashWindow();
    return;
  }

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    closeSplashWindow();
    if (!ctrl.isDestroyed() && !ctrl.isVisible()) {
      ctrl.show();
    }
  };

  ctrl.once("ready-to-show", finish);
  ctrl.webContents.once("did-fail-load", (_event, errorCode, errorDescription) => {
    bootLog(`[control] did-fail-load ${errorCode} ${errorDescription}`);
    finish();
  });

  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      bootLog("[splash] timeout — controlvenster wordt alsnog getoond");
      finish();
    }
  }, 60_000);
}

function displayWindowAlive(): boolean {
  return !!displayWindow && !displayWindow.isDestroyed();
}

/**
 * Het stadionscherm start los van control. Zonder deze poort laadt de display-renderer
 * (met audio) al terwijl de operator nog een licentie moet invoeren.
 */
let stadiumDisplayAllowed = false;

function allowStadiumDisplay(reason: string) {
  if (stadiumDisplayAllowed) {
    if (!displayWindowAlive() && !allowQuitWithoutConfirm) createDisplayWindow();
    return;
  }
  stadiumDisplayAllowed = true;
  bootLog(`[display] vrijgegeven (${reason})`);
  createDisplayWindow();
}

/**
 * Stadionscherm mag nooit in slaap- of schermbeveiliging vallen zolang de app draait, ongeacht de
 * Windows-energie-instellingen van de club-pc.
 */
let powerSaveBlockerId: number | null = null;

function startDisplayPowerSaveBlocker() {
  if (powerSaveBlockerId != null && powerSaveBlocker.isStarted(powerSaveBlockerId)) return;
  try {
    powerSaveBlockerId = powerSaveBlocker.start("prevent-display-sleep");
    bootLog(`[power] prevent-display-sleep actief (id=${powerSaveBlockerId})`);
  } catch (err) {
    bootLog(`[power] powerSaveBlocker mislukt: ${String(err)}`);
  }
}

function stopDisplayPowerSaveBlocker() {
  if (powerSaveBlockerId == null) return;
  try {
    if (powerSaveBlocker.isStarted(powerSaveBlockerId)) powerSaveBlocker.stop(powerSaveBlockerId);
  } catch {
    /* ignore */
  }
  powerSaveBlockerId = null;
}

function ensureDisplayWindow(): BrowserWindow | null {
  if (!stadiumDisplayAllowed) return displayWindowAlive() ? displayWindow : null;
  if (displayWindowAlive()) return displayWindow;
  bootLog("[display] venster ontbreekt — opnieuw aanmaken");
  createDisplayWindow();
  return displayWindow;
}

function wireDisplayWindow(win: BrowserWindow) {
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    bootLog(
      `[display] did-fail-load code=${errorCode} ${errorDescription} url=${String(validatedURL ?? "").slice(0, 200)}${bootPlaybackContextSuffix()}`,
    );
  });
  win.once("ready-to-show", () => {
    applyDisplayFullscreen(win);
    win.show();
    setImmediate(() => applyDisplayFullscreen(win));
  });
  win.webContents.on("did-finish-load", () => {
    void runtime?.broadcastDisplayState();
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    bootLog(
      `[display] render-process-gone reason=${details.reason} exitCode=${details.exitCode}${bootPlaybackContextSuffix()}`,
    );
    if (!win.isDestroyed()) win.webContents.reloadIgnoringCache();
  });
  win.webContents.on("unresponsive", () => {
    bootLog(`[display] renderer unresponsive (geen auto-reload)${bootPlaybackContextSuffix()}`);
  });
  win.on("closed", () => {
    if (displayWindow === win) displayWindow = null;
    if (allowQuitWithoutConfirm) return;
    setTimeout(() => {
      if (!allowQuitWithoutConfirm && stadiumDisplayAllowed && !displayWindowAlive()) {
        bootLog("[display] venster gesloten — automatisch herstellen");
        createDisplayWindow();
      }
    }, 300);
  });
}

function createDisplayWindow() {
  if (!stadiumDisplayAllowed) {
    bootLog("[display] uitgesteld — wacht op geldige licentie");
    return;
  }
  if (displayWindowAlive()) return;
  const preload = path.join(__dirname, "preload.js");
  const winIcon = windowIconPath();
  displayWindow = new BrowserWindow({
    title: "Stadium Scoreboard — Display",
    backgroundColor: "#000000",
    frame: false,
    show: false,
    fullscreenable: true,
    ...(winIcon ? { icon: winIcon } : {}),
    thickFrame: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  void loadView(displayWindow, "display");
  wireDisplayWindow(displayWindow);
}

function wireDisplayMonitorTracking() {
  const relayout = () => {
    // Het bedieningspaneel toont de lijst met monitoren; houd die actueel.
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.webContents.send("display:screensChanged", stadiumScreensPayload());
    }
    if (!displayWindowAlive()) {
      if (!allowQuitWithoutConfirm && stadiumDisplayAllowed) createDisplayWindow();
      return;
    }
    bootLog("[display] monitor gewijzigd — fullscreen opnieuw plaatsen");
    applyDisplayFullscreen(displayWindow);
  };
  screen.on("display-added", relayout);
  screen.on("display-removed", relayout);
  screen.on("display-metrics-changed", relayout);
}

function stopDisplayPreviewCapture() {
  if (displayPreviewTimer) {
    clearInterval(displayPreviewTimer);
    displayPreviewTimer = null;
  }
}

function setDisplayPreviewCaptureEnabled(on: boolean) {
  displayPreviewCaptureUsers = Math.max(0, displayPreviewCaptureUsers + (on ? 1 : -1));
  if (displayPreviewCaptureUsers > 0) startDisplayPreviewCapture();
  else stopDisplayPreviewCapture();
}

async function pushDisplayPreviewFrame() {
  if (displayPreviewBusy) return;
  const win = displayWindow;
  const ctrl = controlWindow;
  if (!win || win.isDestroyed() || !ctrl || ctrl.isDestroyed()) return;
  displayPreviewBusy = true;
  try {
    const image = await win.webContents.capturePage();
    if (image.isEmpty()) return;
    const size = image.getSize();
    const resized = size.width > 1920 ? image.resize({ width: 1920, quality: "best" }) : image;
    const jpeg = resized.toJPEG(90);
    ctrl.webContents.send("display:livePreviewFrame", `data:image/jpeg;base64,${jpeg.toString("base64")}`);
  } catch {
    /* ignore */
  } finally {
    displayPreviewBusy = false;
  }
}

function startDisplayPreviewCapture() {
  if (displayPreviewTimer) return;
  displayPreviewTimer = setInterval(() => {
    void pushDisplayPreviewFrame();
  }, 125);
  void pushDisplayPreviewFrame();
}

function createWindows() {
  const preload = path.join(__dirname, "preload.js");

  const winIcon = windowIconPath();

  controlWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Stadium Scoreboard — Control",
    backgroundColor: "#09090b",
    show: false,
    ...(winIcon ? { icon: winIcon } : {}),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      /** Zelfde als display: voorkomt throttling tijdens zware output op het andere venster. */
      backgroundThrottling: false,
    },
  });
  void loadView(controlWindow, "control");
  controlWindow.webContents.on("did-finish-load", () => {
    void runtime?.broadcastDisplayState();
  });
  controlWindow.webContents.on("render-process-gone", (_event, details) => {
    bootLog(
      `[control] render-process-gone reason=${details.reason} exitCode=${details.exitCode}${bootPlaybackContextSuffix()}`,
    );
    const win = controlWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.reloadIgnoringCache();
    }
  });
  controlWindow.webContents.on("unresponsive", () => {
    bootLog(`[control] renderer unresponsive (geen auto-reload)${bootPlaybackContextSuffix()}`);
  });
  if (IS_DEV && process.env.OPEN_DEVTOOLS_ON_START === "1") {
    controlWindow.webContents.openDevTools({ mode: "detach" });
  }
  controlWindow.on("close", (e) => {
    if (allowQuitWithoutConfirm) return;
    e.preventDefault();
    app.quit();
  });
  controlWindow.on("closed", () => {
    controlWindow = null;
  });

  void buildMenu();
}

function psSingleQuoteEscape(p: string): string {
  return p.replace(/'/g, "''");
}

type VenueBackupResult = {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  filePath?: string;
  /** Bestanden waarnaar de club verwijst maar die niet in de back-up zitten. */
  skipped?: BackupManifest["skipped"];
};

/** Melding voor het bedieningspaneel na een herstart waarbij een back-up is teruggezet. */
type RestoreNotice =
  | { kind: "restored"; backupCreatedAt: string | null; restoredFiles: number }
  | { kind: "failed"; error: string };

let restoreNotice: RestoreNotice | null = null;
/** Eén back-up of herstel tegelijk: beide lezen en schrijven dezelfde mappen. */
let backupBusy = false;

async function menuTexts(): Promise<(key: string) => string> {
  let locale = normalizeMenuLocale("nl");
  try {
    if (runtime?.getUiLocale) locale = normalizeMenuLocale(await runtime.getUiLocale());
  } catch {
    /* keep nl */
  }
  return (key) => menuLabel(locale, key);
}

/** Voert een hulpprogramma uit zonder de app te blokkeren: het stadionscherm blijft lopen. */
function runTool(command: string, args: string[], cwd?: string): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve) => {
    let output = "";
    const keep = (chunk: unknown) => {
      output = (output + String(chunk)).slice(-4000);
    };
    try {
      const child = spawn(command, args, { cwd, windowsHide: true });
      child.stdout?.on("data", keep);
      child.stderr?.on("data", keep);
      child.on("error", (err) => resolve({ status: -1, output: String(err) }));
      child.on("close", (status) => resolve({ status, output }));
    } catch (err) {
      resolve({ status: -1, output: String(err) });
    }
  });
}

function zipFolder(parentDir: string, folderName: string, zipTarget: string) {
  if (process.platform === "win32") {
    const cmd =
      `$ProgressPreference='SilentlyContinue'; Compress-Archive -LiteralPath '${psSingleQuoteEscape(path.join(parentDir, folderName))}' ` +
      `-DestinationPath '${psSingleQuoteEscape(zipTarget)}' -Force`;
    return runTool("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd]);
  }
  fs.rmSync(zipTarget, { force: true });
  return runTool("zip", ["-r", "-q", zipTarget, folderName], parentDir);
}

function unzipTo(zipFile: string, destDir: string) {
  if (process.platform === "win32") {
    const cmd =
      `$ProgressPreference='SilentlyContinue'; Expand-Archive -LiteralPath '${psSingleQuoteEscape(zipFile)}' ` +
      `-DestinationPath '${psSingleQuoteEscape(destDir)}' -Force`;
    return runTool("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd]);
  }
  return runTool("unzip", ["-q", "-o", zipFile, "-d", destDir]);
}

/**
 * ZIP met alles wat een club nodig heeft om op een andere pc verder te gaan: database, uploads,
 * de media die elders op deze pc staat, en de indeling van het Live-tabblad.
 */
async function runVenueBackupExport(parent: BrowserWindow | null): Promise<VenueBackupResult> {
  const ctx = desktopContext;
  if (!ctx) return { ok: false, error: "Desktop context ontbreekt." };
  const m = await menuTexts();
  if (backupBusy) return { ok: false, error: m("backupBusy") };
  const dbSrc = path.join(ctx.userDataDir, "data", "stadium.db");
  if (!fs.existsSync(dbSrc)) {
    return { ok: false, error: `Database niet gevonden: ${dbSrc}` };
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const win = parent ?? controlWindow;
  const dialogOpts = {
    title: "Venue-backup opslaan",
    defaultPath: path.join(app.getPath("documents"), `Stadium-venue-backup-${stamp}.zip`),
    filters: [{ name: "ZIP", extensions: ["zip"] }],
  };
  const save = win
    ? await dialog.showSaveDialog(win, dialogOpts)
    : await dialog.showSaveDialog(dialogOpts);
  if (save.canceled || !save.filePath) return { ok: false, canceled: true };

  backupBusy = true;
  win?.setProgressBar(2);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stadium-bk-"));
  const staging = path.join(tmpRoot, BACKUP_ROOT_DIR);
  try {
    fs.mkdirSync(path.join(staging, "data"), { recursive: true });
    // WAL-modus: recente commits staan in stadium.db-wal. Eerst checkpointen, anders is de kopie onvolledig.
    try {
      await runtime?.checkpointDatabaseForBackup();
    } catch (err) {
      bootLog(`[backup] wal_checkpoint mislukt: ${String(err)} — kopie bevat ook -wal/-shm als vangnet`);
    }
    fs.copyFileSync(dbSrc, path.join(staging, "data", "stadium.db"));
    for (const suffix of ["-wal", "-shm"]) {
      const side = `${dbSrc}${suffix}`;
      if (fs.existsSync(side) && fs.statSync(side).size > 0) {
        fs.copyFileSync(side, path.join(staging, "data", `stadium.db${suffix}`));
      }
    }
    const skipped: BackupManifest["skipped"] = [];
    if (fs.existsSync(ctx.uploadsDir)) {
      stageDirectory(ctx.uploadsDir, path.join(staging, "uploads"), skipped);
    } else {
      fs.mkdirSync(path.join(staging, "uploads"), { recursive: true });
    }
    // Video's, logo's en foto's staan meestal op een eigen plek op de pc: die moeten mee.
    let references: string[] = [];
    try {
      references = (await runtime?.listExternalFilesForBackup()) ?? [];
    } catch (err) {
      bootLog(`[backup] externe bestanden opzoeken mislukt: ${String(err)}`);
    }
    const external = stageExternalFiles(staging, references);
    skipped.push(...external.skipped);
    stageConfigFiles(staging, ctx.userDataDir);
    writeManifest(staging, {
      format: 2,
      app: "arenacue-scoreboard",
      appVersion: app.getVersion(),
      createdAt: new Date().toISOString(),
      files: external.files,
      skipped,
    });
    const zipTarget = save.filePath.toLowerCase().endsWith(".zip") ? save.filePath : `${save.filePath}.zip`;

    const r = await zipFolder(tmpRoot, BACKUP_ROOT_DIR, zipTarget);
    if (r.status !== 0) {
      bootLog(`[backup] zip mislukt: ${r.output || "onbekend"}`);
      return {
        ok: false,
        error:
          process.platform === "win32"
            ? r.output.trim().split(/\r?\n/)[0] || "ZIP-export mislukt (PowerShell)."
            : "ZIP-export mislukt (installeer het `zip`-commando, of voer backup uit op Windows).",
      };
    }

    bootLog(
      `[backup] venue export OK: ${zipTarget} (${external.files.length} externe bestanden, ${skipped.length} overgeslagen)`,
    );
    return { ok: true, filePath: zipTarget, skipped };
  } catch (err) {
    bootLog(`[backup] export mislukt: ${String(err)}`);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    backupBusy = false;
    try {
      if (win && !win.isDestroyed()) win.setProgressBar(-1);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** Regels voor het bericht na een export: wat niet mee kon. */
function skippedSummary(skipped: BackupManifest["skipped"] | undefined, intro: string): string {
  if (!skipped || skipped.length === 0) return "";
  const lines = skipped.slice(0, 12).map((item) => `• ${item.path}`);
  if (skipped.length > lines.length) lines.push(`… +${skipped.length - lines.length}`);
  return `\n\n${intro}\n${lines.join("\n")}`;
}

/**
 * Leest een venue-back-up in. De ZIP wordt uitgepakt en nagekeken; pas na bevestiging herstart de app
 * en wisselt `applyPendingRestore` de gegevens om, vóór de database open gaat.
 */
async function runVenueBackupRestore(parent: BrowserWindow | null): Promise<VenueBackupResult> {
  const ctx = desktopContext;
  if (!ctx) return { ok: false, error: "Desktop context ontbreekt." };
  const m = await menuTexts();
  if (backupBusy) return { ok: false, error: m("backupBusy") };
  const win = parent ?? controlWindow;

  let inPlay = false;
  try {
    inPlay = (await runtime?.isMatchInPlayNow()) ?? false;
  } catch {
    /* zonder runtime is er ook geen wedstrijd bezig */
  }
  if (inPlay) return { ok: false, error: m("restoreNotDuringMatch") };

  const openOpts = {
    title: m("restoreTitle"),
    filters: [{ name: "ZIP", extensions: ["zip"] }],
    properties: ["openFile" as const],
  };
  const open = win ? await dialog.showOpenDialog(win, openOpts) : await dialog.showOpenDialog(openOpts);
  const zipFile = open.filePaths[0];
  if (open.canceled || !zipFile) return { ok: false, canceled: true };

  backupBusy = true;
  win?.setProgressBar(2);
  const pending = path.join(ctx.userDataDir, RESTORE_PENDING_DIR);
  const discard = () => fs.rmSync(pending, { recursive: true, force: true });
  try {
    discard();
    fs.mkdirSync(pending, { recursive: true });
    const unzip = await unzipTo(zipFile, pending);
    if (unzip.status !== 0) {
      bootLog(`[restore] uitpakken mislukt: ${unzip.output || "onbekend"}`);
      discard();
      return { ok: false, error: m("restoreUnpackFailed") };
    }
    const inspection = inspectBackupDir(pending, app.getVersion());
    if (!inspection.ok) {
      discard();
      return {
        ok: false,
        error:
          inspection.reason === "newer_version"
            ? m("restoreNewerVersion").replace("{{version}}", inspection.backupVersion ?? "?")
            : m("restoreNoDatabase"),
      };
    }

    const madeAt = inspection.manifest?.createdAt ? new Date(inspection.manifest.createdAt) : fs.statSync(zipFile).mtime;
    const confirmOpts = {
      type: "warning" as const,
      buttons: [m("restoreConfirmOk"), m("quitConfirmCancel")],
      defaultId: 1,
      cancelId: 1,
      title: m("restoreTitle"),
      message: m("restoreConfirmMessage"),
      detail: m("restoreConfirmDetail").replace("{{date}}", madeAt.toLocaleString()),
    };
    const confirm = win
      ? await dialog.showMessageBox(win, confirmOpts)
      : await dialog.showMessageBox(confirmOpts);
    if (confirm.response !== 0) {
      discard();
      return { ok: false, canceled: true };
    }

    // Vanaf hier wisselt de volgende start de gegevens om.
    fs.writeFileSync(path.join(pending, RESTORE_READY_MARKER), JSON.stringify({ at: new Date().toISOString() }), "utf8");
    try {
      await runtime?.checkpointDatabaseForBackup();
    } catch {
      /* de -wal/-shm-bestanden gaan mee naar de veiligheidskopie */
    }
    bootLog(`[restore] back-up klaargezet uit ${zipFile}; app herstart`);
    flushBootLogSync();
    allowQuitWithoutConfirm = true;
    // In een testomgeving start de test de app zelf opnieuw.
    if (app.isPackaged || process.env.ARENACUE_NO_RELAUNCH !== "1") app.relaunch();
    setTimeout(() => app.exit(0), 150);
    return { ok: true };
  } catch (err) {
    bootLog(`[restore] voorbereiden mislukt: ${String(err)}`);
    discard();
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    backupBusy = false;
    try {
      if (win && !win.isDestroyed()) win.setProgressBar(-1);
    } catch {
      /* ignore */
    }
  }
}

/** Na een herstart met teruggezette back-up: paden naar teruggezette media in de database zetten. */
async function finishRestoreAfterStart() {
  const followup = takeRestoreFollowup(app.getPath("userData"));
  if (!followup) return;
  try {
    const changed = (await runtime?.remapRestoredFilePaths(followup.remap)) ?? 0;
    bootLog(`[restore] ${Object.keys(followup.remap).length} mediabestanden uit de back-up, ${changed} verwijzingen bijgewerkt`);
  } catch (err) {
    bootLog(`[restore] verwijzingen bijwerken mislukt: ${String(err)}`);
  }
  restoreNotice = {
    kind: "restored",
    backupCreatedAt: followup.backupCreatedAt,
    restoredFiles: Object.keys(followup.remap).length,
  };
}
async function buildMenu() {
  const uploadsDir = desktopContext?.uploadsDir ?? path.join(app.getPath("userData"), "uploads");
  let locale = normalizeMenuLocale("nl");
  try {
    if (runtime?.getUiLocale) {
      locale = normalizeMenuLocale(await runtime.getUiLocale());
    }
  } catch {
    /* keep nl */
  }
  const m = (key: Parameters<typeof menuLabel>[1]) => menuLabel(locale, key);
  const menu = Menu.buildFromTemplate([
    {
      label: m("file"),
      submenu: [
        {
          label: m("exportVenueBackup"),
          click: async () => {
            const r = await runVenueBackupExport(controlWindow);
            if (r.canceled) return;
            if (!r.ok) {
              await dialog.showMessageBox({
                type: "error",
                title: m("backupTitle"),
                message: m("backupFailed"),
                detail: r.error ?? m("unknownError"),
              });
              return;
            }
            await dialog.showMessageBox({
              type: "info",
              title: m("backupTitle"),
              message: m("backupSaved"),
              detail: `${r.filePath ?? ""}${skippedSummary(r.skipped, m("backupSkippedIntro"))}`,
            });
          },
        },
        {
          label: m("restoreVenueBackup"),
          click: async () => {
            const r = await runVenueBackupRestore(controlWindow);
            if (r.ok || r.canceled) return;
            await dialog.showMessageBox({
              type: "error",
              title: m("restoreTitle"),
              message: m("restoreFailed"),
              detail: r.error ?? m("unknownError"),
            });
          },
        },
        { type: "separator" },
        {
          label: m("hideDisplay"),
          click: () => displayWindow?.hide(),
        },
        {
          label: m("showDisplay"),
          click: () => {
            const w = ensureDisplayWindow();
            if (!w) return;
            applyDisplayFullscreen(w);
            w.show();
            w.focus();
          },
        },
        {
          label: m("toggleFullscreen"),
          accelerator: "F11",
          click: () => displayWindow?.setFullScreen(!displayWindow?.isFullScreen()),
        },
        { type: "separator" },
        {
          label: m("openLogs"),
          click: () => shell.openPath(app.getPath("userData")),
        },
        {
          label: m("openUploads"),
          click: () => shell.openPath(uploadsDir),
        },
        { type: "separator" },
        { role: "quit", label: m("quit") },
      ],
    },
    {
      label: m("view"),
      submenu: [
        { role: "reload", label: m("reload") },
        {
          label: m("reloadControl"),
          click: () => {
            const w = controlWindow;
            if (w && !w.isDestroyed()) w.webContents.reloadIgnoringCache();
          },
        },
        {
          label: m("reloadDisplay"),
          click: () => {
            const w = ensureDisplayWindow();
            if (w && !w.isDestroyed()) w.webContents.reloadIgnoringCache();
          },
        },
        { type: "separator" },
        { role: "toggleDevTools", label: m("devtoolsControl") },
        {
          label: m("devtoolsDisplay"),
          click: () => displayWindow?.webContents.openDevTools(),
        },
      ],
    },
    {
      label: m("help"),
      submenu: [
        {
          label: m("licenses"),
          click: () => {
            void openLegalBundleFolder();
          },
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

/** Juridisch: Chromium/npm-attributie (`extraResources` → resources/legal bij packaged build). */
function legalBundleDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "legal");
  }
  return path.join(appRoot(), "legal-dist");
}

async function openLegalBundleFolder() {
  const dir = legalBundleDir();
  try {
    if (!fs.existsSync(dir)) {
      await dialog.showMessageBox({
        type: "info",
        title: "Licenties",
        message: "Licentiemap niet gevonden.",
        detail:
          "Voer lokaal `npm run legal:desktop` uit (genereert legal-dist/), of bouw de installatie opnieuw met `npm run electron:build`.",
      });
      return;
    }
    const err = await shell.openPath(dir);
    if (err) {
      await dialog.showMessageBox({
        type: "warning",
        title: "Licenties",
        message: "Kon de licentiemap niet openen.",
        detail: err,
      });
    }
  } catch (e) {
    bootLog(`openLegalBundleFolder failed ${String(e)}`);
    await dialog.showMessageBox({
      type: "error",
      title: "Licenties",
      message: "Kon de licentiemap niet openen.",
      detail: String(e),
    });
  }
}

function registerIpc() {
  const music = new MusicLibraryStore(desktopContext!.uploadsDir);
  const assertMusicOperator = (event: Electron.IpcMainInvokeEvent) => {
    if (!controlWindow || event.sender !== controlWindow.webContents || event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Music is only available from the control window");
    }
  };
  ipcMain.handle("music:load", (event) => {
    assertMusicOperator(event);
    return music.load();
  });
  ipcMain.handle("music:save", (event, update: MusicLibraryUpdate) => {
    assertMusicOperator(event);
    return music.save(update);
  });
  ipcMain.handle("music:import", async (event) => {
    assertMusicOperator(event);
    const result = await dialog.showOpenDialog(controlWindow!, {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Audio", extensions: MUSIC_EXTENSIONS }],
    });
    if (result.canceled) return { library: await music.load(), failed: [] };
    return music.importFiles(result.filePaths);
  });
  ipcMain.handle("desktop:getCaptureSources", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      fetchWindowIcons: true,
      thumbnailSize: { width: 400, height: 225 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnailDataUrl: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
    }));
  });

  if (!livestream) {
    livestream = createLivestreamController({
      getDisplayWindow: () => displayWindow,
      getControlWindow: () => controlWindow,
      ensureStreamWindow,
      closeStreamWindow: destroyStreamWindow,
      getStreamWindow: () => streamWindow,
      ensureBrowserWindow: ensureBrowserSourceWindow,
      closeBrowserWindow: destroyBrowserSourceWindow,
      getBrowserWindow: () => browserSourceWindow,
      ensureMediaWindow: ensureMediaSourceWindow,
      closeMediaWindow: destroyMediaSourceWindow,
      getMediaWindow: () => mediaSourceWindow,
      userDataDir: () => app.getPath("userData"),
      recordDir: () => path.join(app.getPath("videos"), "ArenaCue"),
      appRoot,
      resourcesPath: () => process.resourcesPath,
      log: bootLog,
    });
  }
  ipcMain.handle("livestream:getSettings", () => livestream!.getSettings());
  ipcMain.handle("livestream:saveSettings", (_e, partial: Partial<LivestreamSettings>) =>
    livestream!.saveSettings(partial ?? {}),
  );
  ipcMain.handle("livestream:getStatus", () => livestream!.getStatus());
  ipcMain.handle("livestream:listCameras", () => livestream!.listCameras());
  ipcMain.handle("livestream:listAudioDevices", () => livestream!.listAudioDevices());
  ipcMain.handle("livestream:listAudioOutputs", () => livestream!.listAudioOutputs());
  ipcMain.handle("livestream:start", () => livestream!.start());
  ipcMain.handle("livestream:stop", () => livestream!.stop());
  ipcMain.handle("livestream:startRecord", () => livestream!.startRecord());
  ipcMain.handle("livestream:stopRecord", () => livestream!.stopRecord());
  ipcMain.handle("livestream:openBrowserInteract", (_e, url: string) => openBrowserSourceInteract(url));
  if (!streamDeck && livestream && runtime) {
    streamDeck = startStreamDeck({
      livestream,
      runCommand: (command) => runtime!.runCommand(command as any),
      getSnapshot: () => runtime!.getDisplaySnapshot(),
      log: bootLog,
    });
  }
  ipcMain.handle("streamdeck:getInfo", () => streamDeck?.info() ?? null);
  ipcMain.on("livestream:programReady", (event) => {
    if (streamWindow && !streamWindow.isDestroyed() && event.sender === streamWindow.webContents) {
      livestream?.notifyProgramReady();
    }
  });

  ipcMain.on("app:getContext", (event) => {
    event.returnValue = desktopContext;
  });

  const matchTabLayoutPath = () => path.join(app.getPath("userData"), "control-match-tab-layout.json");

  ipcMain.on("control:getMatchTabLayoutSnapshot", (event) => {
    try {
      const p = matchTabLayoutPath();
      if (fs.existsSync(p)) {
        const text = fs.readFileSync(p, "utf8");
        if (text.trim()) {
          event.returnValue = text;
          return;
        }
      }
    } catch (e) {
      bootLog(`control:getMatchTabLayoutSnapshot ${String(e)}`);
    }
    event.returnValue = null;
  });

  ipcMain.on("control:persistMatchTabLayout", (event, json: unknown) => {
    try {
      if (typeof json !== "string" || json.length > 600_000) {
        event.returnValue = { ok: false };
        return;
      }
      fs.mkdirSync(app.getPath("userData"), { recursive: true });
      fs.writeFileSync(matchTabLayoutPath(), json, "utf8");
      event.returnValue = { ok: true };
    } catch (e) {
      bootLog(`control:persistMatchTabLayout ${String(e)}`);
      event.returnValue = { ok: false };
    }
  });

  ipcMain.on("display:playbackContext", (_event, raw: unknown) => {
    setLastDisplayPlaybackFromIpc(raw);
  });

  ipcMain.on("display:mediaDiagnostic", (_event, raw: unknown) => {
    bootLog(`[display-media] ${sanitizeMediaDiagnostic(raw)}`);
  });

  ipcMain.handle("app:getVersion", () => app.getVersion());

  ipcMain.handle("app:getResourceMetrics", () => getAppResourceMetrics());

  ipcMain.handle("mobile:getBridgeInfo", () => ({
    enabled: mobileBridge != null,
    port: mobileBridge?.port ?? null,
    pairingCode: mobileBridge?.pairingCode ?? null,
    operatorPin: mobileBridge?.operatorPin ?? null,
    bridgeUrls: mobileBridge ? localNetworkUrls(mobileBridge.port) : [],
    pairCodes: mobileBridge ? mobileLocalPairCodesViewer(mobileBridge) : [],
    pairCodesOperator: mobileBridge ? mobileLocalPairCodesOperator(mobileBridge) : [],
    operatorPinConfigured: !!mobileBridge?.operatorPin,
    cloud: {
      enabled: cloudAgent != null,
      baseUrl: cloudAgent?.baseUrl ?? null,
      venueId: cloudAgent?.venueId ?? null,
      pairCode: cloudAgent?.customerPairCode ?? null,
    },
  }));

  ipcMain.handle("backup:exportVenue", async () => {
    return runVenueBackupExport(BrowserWindow.getFocusedWindow() ?? controlWindow);
  });

  ipcMain.handle("backup:restoreVenue", async () => {
    return runVenueBackupRestore(BrowserWindow.getFocusedWindow() ?? controlWindow);
  });

  // Eén keer tonen na de herstart: daarna is de melding weg.
  ipcMain.handle("backup:takeRestoreNotice", async () => {
    const notice = restoreNotice;
    restoreNotice = null;
    return notice;
  });

  ipcMain.handle("display:listScreens", async () => stadiumScreensPayload());

  ipcMain.handle("display:setStadiumScreen", async (_, id: unknown) => {
    if (id === null || id === undefined) {
      writeStadiumScreenChoice(null);
      bootLog("[display] monitor: automatisch");
    } else {
      const picked = connectedScreens().find((row) => row.id === Number(id));
      if (!picked) return { ok: false, ...stadiumScreensPayload() };
      writeStadiumScreenChoice(choiceFromScreen(picked));
      bootLog(`[display] monitor gekozen: ${picked.label || picked.id} ${picked.width}x${picked.height}`);
    }
    if (displayWindowAlive()) applyDisplayFullscreen(displayWindow);
    return { ok: true, ...stadiumScreensPayload() };
  });

  ipcMain.handle("display:identifyScreens", async () => {
    identifyScreens();
    return { ok: true };
  });

  ipcMain.handle("shell:openExternal", async (_, url: unknown) => {
    if (typeof url !== "string" || !/^https:\/\//i.test(url.trim())) {
      return { ok: false };
    }
    try {
      await shell.openExternal(url.trim());
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle(
    "dialog:openFile",
    async (
      _,
      opts: {
        title?: string;
        filters?: Electron.FileFilter[];
        multiSelections?: boolean;
      },
    ) => {
      const win = BrowserWindow.getFocusedWindow() ?? controlWindow;
      const options = {
        title: opts.title,
        filters: opts.filters ?? [],
        properties: [
          "openFile" as const,
          ...(opts.multiSelections ? (["multiSelections"] as const) : []),
        ],
      };
      return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
    },
  );

  ipcMain.handle(
    "dialog:openFolder",
    async (
      _,
      opts: { title?: string; extensions?: string[] },
    ) => {
      const win = BrowserWindow.getFocusedWindow() ?? controlWindow;
      const options = {
        title: opts.title,
        properties: ["openDirectory" as const],
      };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true, folderPath: null, files: [] as Array<{ name: string; path: string }> };
      }
      const folderPath = result.filePaths[0];
      const extSet = opts.extensions
        ? new Set(opts.extensions.map((ext) => ext.toLowerCase().replace(/^\./, "")))
        : null;
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile())
        .map((e) => ({ name: e.name, path: path.join(folderPath, e.name) }))
        .filter((f) => {
          if (!extSet) return true;
          const ext = path.extname(f.name).slice(1).toLowerCase();
          return extSet.has(ext);
        })
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      return { canceled: false, folderPath, files };
    },
  );

  ipcMain.handle("api:request", async (_, req: DesktopApiRequest) => {
    if (!runtime) throw new Error("Runtime not initialized");
    bootLog(`[api] ${req.method} ${req.path}${req.search ?? ""}`);
    const response = await runtime.apiRequest(req);
    bootLog(`[api] ${req.method} ${req.path} -> ${response.status}`);
    return response;
  });

  ipcMain.handle("display:command", async (_, cmd) => {
    if (!runtime) throw new Error("Runtime not initialized");
    if (
      desktopContext &&
      cmd?.type === "display:setMode" &&
      cmd?.mode === "SPONSOR_ROTATION" &&
      licenseSvc.readStoredLicense(desktopContext.userDataDir)?.features?.automatic_sponsor_rotation === false
    ) {
      const payload = { message: "licenseNoAutoSponsors", code: "licenseNoAutoSponsors" };
      if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send("display:error", payload);
      }
      return { ok: false, error: "licenseNoAutoSponsors", code: "licenseNoAutoSponsors" };
    }
    return runtime.runCommand(cmd);
  });

  ipcMain.on("control:setDisplayPreviewCapture", (event, enabled: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !controlWindow || win.id !== controlWindow.id) return;
    setDisplayPreviewCaptureEnabled(Boolean(enabled));
  });

  ipcMain.handle("display:getPreviewCaptureIds", (event) => {
    if (!controlWindow || event.sender !== controlWindow.webContents) return null;
    if (!displayWindowAlive() || !displayWindow) return null;
    let tabId: string | null = null;
    let windowId: string | null = null;
    try {
      tabId = displayWindow.webContents.getMediaSourceId(event.sender);
    } catch {
      tabId = null;
    }
    try {
      windowId = displayWindow.getMediaSourceId();
    } catch {
      windowId = null;
    }
    if (!tabId && !windowId) return null;
    return { tabId, windowId };
  });

  ipcMain.handle("display:getSnapshot", async () => {
    if (!runtime) throw new Error("Runtime not initialized");
    return runtime.getDisplaySnapshot();
  });

  ipcMain.handle("display:getSponsorLedger", async () => {
    if (!runtime) throw new Error("Runtime not initialized");
    return runtime.getSponsorLedgerSnapshot();
  });

  /**
   * Alleen het stadionscherm mag sponsor-telemetrie schrijven. De control-preview rendert
   * dezelfde DisplayPage in een eigen renderer-proces; zonder deze check schreven beide
   * vensters in dezelfde ledger en dreef de preview weg van wat er echt op het LED-scherm
   * stond (andere clip in de HUD, verkeerde proof-of-play).
   */
  function isDisplayRenderer(event: Electron.IpcMainInvokeEvent): boolean {
    const win = BrowserWindow.fromWebContents(event.sender);
    return !!win && !!displayWindow && win.id === displayWindow.id;
  }

  ipcMain.handle("display:sponsorClipStart", async (event, payload) => {
    if (!runtime) throw new Error("Runtime not initialized");
    if (!isDisplayRenderer(event)) return { ok: false, ignored: "not-display-window" };
    runtime.sponsorTelemetryClipStart(payload);
    return { ok: true };
  });

  ipcMain.handle("display:sponsorClipEnd", async (event, payload) => {
    if (!runtime) throw new Error("Runtime not initialized");
    if (!isDisplayRenderer(event)) return { ok: false, ignored: "not-display-window" };
    runtime.sponsorTelemetryClipEnd(payload);
    return { ok: true };
  });

  ipcMain.handle("display:sponsorClipProgress", async (event, payload) => {
    if (!runtime) throw new Error("Runtime not initialized");
    if (!isDisplayRenderer(event)) return { ok: false, ignored: "not-display-window" };
    runtime.sponsorTelemetryClipProgress(payload);
    return { ok: true };
  });

  ipcMain.handle("window:focusDisplay", async () => {
    const w = ensureDisplayWindow();
    if (!w) return;
    applyDisplayFullscreen(w);
    w.show();
    w.focus();
    setImmediate(() => applyDisplayFullscreen(w));
  });

  ipcMain.handle("window:reloadDisplay", async () => {
    const w = ensureDisplayWindow();
    if (!w) return { ok: false };
    try {
      w.webContents.reloadIgnoringCache();
      setImmediate(() => applyDisplayFullscreen(w));
      return { ok: true };
    } catch (err) {
      console.error("[main] reload display failed", err);
      return { ok: false };
    }
  });

  ipcMain.handle(
    "sponsorPlays:saveExport",
    async (
      _,
      payload: { base64: string; defaultFileName: string; format: "pdf" | "xlsx" },
    ) => {
      const storedLicense = desktopContext
        ? licenseSvc.readStoredLicense(desktopContext.userDataDir)
        : null;
      if (storedLicense?.features?.proof_of_play_export === false) {
        return { canceled: true, error: "Proof-of-play export is niet beschikbaar in dit licentieplan." };
      }
      const ext = payload.format === "pdf" ? "pdf" : "xlsx";
      let defaultPath = payload.defaultFileName.trim() || `proof-of-play.${ext}`;
      if (!defaultPath.toLowerCase().endsWith(`.${ext}`)) {
        defaultPath = `${defaultPath.replace(/\.(pdf|xlsx)$/i, "")}.${ext}`;
      }
      const win = BrowserWindow.getFocusedWindow() ?? controlWindow;
      const options = {
        defaultPath,
        filters: [
          payload.format === "pdf"
            ? { name: "PDF", extensions: ["pdf"] }
            : { name: "Excel", extensions: ["xlsx"] },
        ],
      };
      const saveResult = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (saveResult.canceled || !saveResult.filePath) {
        return { canceled: true };
      }
      try {
        const buf = Buffer.from(payload.base64, "base64");
        fs.writeFileSync(saveResult.filePath, buf);
      } catch (err) {
        console.error("[main] sponsorPlays:saveExport write failed", err);
        return { canceled: true };
      }
      await shell.showItemInFolder(saveResult.filePath);
      return { canceled: false, filePath: saveResult.filePath };
    },
  );

  ipcMain.handle(
    "match:export",
    async (_, payload: { matchId: string; format: ExportFormat }) => {
      if (!runtime) throw new Error("Runtime not initialized");
      const exportData = await runtime.buildMatchExport(payload.matchId, payload.format);
      const win = BrowserWindow.getFocusedWindow() ?? controlWindow;
      const options = {
        defaultPath: exportData.suggestedName,
        filters: [
          payload.format === "html"
            ? { name: "HTML", extensions: ["html"] }
            : { name: "JSON", extensions: ["json"] },
        ],
      };
      const saveResult = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (saveResult.canceled || !saveResult.filePath) {
        return { canceled: true };
      }
      fs.writeFileSync(saveResult.filePath, exportData.content, "utf8");
      if (payload.format === "html") {
        await shell.openPath(saveResult.filePath);
      }
      return { canceled: false, filePath: saveResult.filePath };
    },
  );

  ipcMain.handle("license:getStatus", async () => {
    if (licenseSvc.skipLicenseGateFromEnv()) {
      allowStadiumDisplay("skip-env");
      return { gate: false, organizationLabel: null, features: { automatic_sponsor_rotation: true, proof_of_play_export: true } };
    }
    if (!desktopContext) {
      return { gate: true, machinePreview: "—", message: "Desktop niet geïnitialiseerd." };
    }
    const dir = desktopContext.userDataDir;
    const mid = licenseSvc.getOrCreateMachineId(dir);
    const preview = licenseSvc.machinePreview(mid);
    const base = licenseSvc.getLicenseApiBase();
    const prev = licenseSvc.readStoredLicense(dir);
    if (!prev) {
      return { gate: true, machinePreview: preview, prefillLicenseKey: null };
    }
    const r = await licenseSvc.remoteLicenseCheck(base, prev.licenseKey, mid);
    if (r.kind === "network") {
      if (licenseSvc.withinGrace(prev.lastVerifiedAt)) {
        allowStadiumDisplay("license-offline-grace");
        return {
          gate: false,
          organizationLabel: prev.organizationLabel ?? null,
          offlineGrace: true,
          ...(prev.plan !== undefined ? { plan: prev.plan } : {}),
          ...(prev.planLabel !== undefined ? { planLabel: prev.planLabel } : {}),
          ...(prev.features !== undefined ? { features: prev.features } : {}),
        };
      }
      return {
        gate: true,
        machinePreview: preview,
        message:
          "Geen verbinding met de licentie-server. Controleer internet of probeer later. (Offline: max. 7 dagen na laatste geslaagde online check.)",
        prefillLicenseKey: prev.licenseKey,
      };
    }
    if (r.kind === "error") {
      return {
        gate: true,
        machinePreview: preview,
        message: r.message,
        prefillLicenseKey: prev.licenseKey,
      };
    }
    if (!r.activated) {
      return {
        gate: true,
        machinePreview: preview,
        message:
          "Deze pc is nog niet gekoppeld aan je licentie. Voer je sleutel in en klik op Activeren op deze pc.",
        prefillLicenseKey: prev.licenseKey,
      };
    }
    const prevLicense = licenseSvc.readStoredLicense(dir);
    licenseSvc.writeStoredLicense(dir, {
      licenseKey: prev.licenseKey,
      lastVerifiedAt: new Date().toISOString(),
      organizationLabel: r.organizationLabel,
      ...(r.plan !== undefined ? { plan: r.plan } : {}),
      ...(r.planLabel !== undefined ? { planLabel: r.planLabel } : {}),
      ...(r.features !== undefined ? { features: r.features } : {}),
      ...(r.controlCloudBaseUrl !== undefined
        ? { controlCloudBaseUrl: r.controlCloudBaseUrl }
        : prevLicense?.controlCloudBaseUrl !== undefined
          ? { controlCloudBaseUrl: prevLicense.controlCloudBaseUrl }
          : {}),
      ...(r.controlDesktopKey !== undefined
        ? { controlDesktopKey: r.controlDesktopKey }
        : prevLicense?.controlDesktopKey !== undefined
          ? { controlDesktopKey: prevLicense.controlDesktopKey }
          : {}),
      ...(r.controlVenueId !== undefined
        ? { controlVenueId: r.controlVenueId }
        : prevLicense?.controlVenueId !== undefined
          ? { controlVenueId: prevLicense.controlVenueId }
          : {}),
      ...(r.controlOperatorPairToken !== undefined
        ? { controlOperatorPairToken: r.controlOperatorPairToken }
        : prevLicense?.controlOperatorPairToken !== undefined
          ? { controlOperatorPairToken: prevLicense.controlOperatorPairToken }
          : {}),
    });
    allowStadiumDisplay("license-ok");
    return {
      gate: false,
      organizationLabel: r.organizationLabel,
      ...(r.plan !== undefined ? { plan: r.plan } : {}),
      ...(r.planLabel !== undefined ? { planLabel: r.planLabel } : {}),
      ...(r.features !== undefined ? { features: r.features } : {}),
    };
  });

  ipcMain.handle("license:activate", async (_, opts: { licenseKey?: string }) => {
    if (!desktopContext) {
      return { ok: false, message: "Desktop niet geïnitialiseerd." };
    }
    const raw = typeof opts?.licenseKey === "string" ? opts.licenseKey : "";
    const key = raw.trim().toUpperCase();
    if (key.length < 8) {
      return { ok: false, message: "Voer een geldige licentiesleutel in." };
    }
    const dir = desktopContext.userDataDir;
    const mid = licenseSvc.getOrCreateMachineId(dir);
    const label = licenseSvc.defaultDeviceLabel();
    const base = licenseSvc.getLicenseApiBase();
    const r = await licenseSvc.remoteLicenseActivate(base, key, mid, label);
    if (r.kind === "network") {
      return { ok: false, message: "Netwerkfout. Controleer internet." };
    }
    if (r.kind === "error") {
      return { ok: false, message: r.message, reason: r.reason };
    }
    licenseSvc.writeStoredLicense(dir, {
      licenseKey: key,
      lastVerifiedAt: new Date().toISOString(),
      organizationLabel: r.organizationLabel,
      ...(r.plan !== undefined ? { plan: r.plan } : {}),
      ...(r.planLabel !== undefined ? { planLabel: r.planLabel } : {}),
      ...(r.features !== undefined ? { features: r.features } : {}),
      ...(r.controlCloudBaseUrl !== undefined ? { controlCloudBaseUrl: r.controlCloudBaseUrl } : {}),
      ...(r.controlDesktopKey !== undefined ? { controlDesktopKey: r.controlDesktopKey } : {}),
      ...(r.controlVenueId !== undefined ? { controlVenueId: r.controlVenueId } : {}),
      ...(r.controlOperatorPairToken !== undefined ? { controlOperatorPairToken: r.controlOperatorPairToken } : {}),
    });
    allowStadiumDisplay("license-activate");
    return {
      ok: true,
      organizationLabel: r.organizationLabel,
      status: r.status,
      ...(r.plan !== undefined ? { plan: r.plan } : {}),
      ...(r.planLabel !== undefined ? { planLabel: r.planLabel } : {}),
      ...(r.features !== undefined ? { features: r.features } : {}),
    };
  });

  ipcMain.handle("feature:submit", async (_, raw: unknown): Promise<FeatureRequestResult> => {
    const input = normalizeFeatureRequestInput(raw);
    if (!input) {
      return { ok: false, reason: "invalid" };
    }
    if (!desktopContext) {
      return { ok: false, reason: "server" };
    }
    const dir = desktopContext.userDataDir;
    const stored = licenseSvc.readStoredLicense(dir);
    if (!stored) {
      return { ok: false, reason: "license" };
    }
    const result = await licenseSvc.remoteFeatureRequest(licenseSvc.getLicenseApiBase(), {
      ...input,
      licenseKey: stored.licenseKey,
      machineId: licenseSvc.getOrCreateMachineId(dir),
      appVersion: app.getVersion(),
    });
    bootLog(`[feature-request] ${result.ok ? "sent" : `failed: ${result.reason}`}`);
    return result;
  });
}

async function confirmAppQuit(parent: BrowserWindow | null): Promise<boolean> {
  let locale = normalizeMenuLocale("nl");
  try {
    if (runtime?.getUiLocale) {
      locale = normalizeMenuLocale(await runtime.getUiLocale());
    }
  } catch {
    /* keep nl */
  }
  const m = (key: Parameters<typeof menuLabel>[1]) => menuLabel(locale, key);
  const opts = {
    type: "warning" as const,
    buttons: [m("quitConfirmCancel"), m("quitConfirmOk")],
    defaultId: 0,
    cancelId: 0,
    title: m("quitConfirmTitle"),
    message: m("quitConfirmMessage"),
    noLink: true,
  };
  const result =
    parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, opts)
      : await dialog.showMessageBox(opts);
  return result.response === 1;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  allowQuitWithoutConfirm = true;
  app.quit();
} else {
  app.on("second-instance", () => {
    if (controlWindow) {
      if (controlWindow.isMinimized()) controlWindow.restore();
      controlWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    bootLog("=== Stadium Scoreboard start ===");

    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      if (permission === "media" || permission === "display-capture" || permission === "speaker-selection") {
        callback(true);
      } else {
        callback(false);
      }
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      const name: string = permission;
      return name === "media" || name === "speaker-selection";
    });

    createSplashWindow();

    try {
      await loadRuntime();
      registerIpc();
      createWindows();
      wireDisplayMonitorTracking();
      wireSplashUntilControlReady();
      if (licenseSvc.skipLicenseGateFromEnv()) {
        allowStadiumDisplay("skip-env");
      }

      app.on("child-process-gone", (_event, details) => {
        if (details.type !== "GPU") return;
        const recoverReasons = new Set([
          "crashed",
          "killed",
          "abnormal-exit",
          "oom",
          "launch-failed",
          "integrity-failure",
        ]);
        const byReason = recoverReasons.has(details.reason);
        const byExit =
          details.reason !== "clean-exit" &&
          typeof details.exitCode === "number" &&
          details.exitCode !== 0;
        if (!byReason && !byExit) return;
        const sponsorVideoContext =
          lastDisplayPlaybackSummary.includes("src=sponsor") ||
          lastDisplayPlaybackSummary.includes("mode=sponsor");
        if (sponsorVideoContext && !videoDecodeFallbackEnabled()) {
          const reason = `GPU ${details.reason} ${details.exitCode ?? ""}`.trim();
          enableVideoDecodeFallbackFlag(reason);
          const now = Date.now();
          gpuCrashStreak = now - lastGpuCrashAt < 120_000 ? gpuCrashStreak + 1 : 1;
          lastGpuCrashAt = now;
          if (gpuCrashStreak >= 2) {
            bootLog(
              `[app] GPU-crash tijdens sponsorvideo (herhaald) — herstart met software-decode${bootPlaybackContextSuffix()}`,
            );
            try {
              app.relaunch();
              app.exit(0);
            } catch (e) {
              bootLog(`[app] GPU fallback relaunch failed ${String(e)}`);
            }
            return;
          }
          bootLog(
            `[app] GPU-crash tijdens sponsorvideo — display herstellen, software-decode bij volgende start${bootPlaybackContextSuffix()}`,
          );
        }
        bootLog(
          `[app] child-process-gone GPU reason=${details.reason} exitCode=${details.exitCode} (byReason=${byReason} byExit=${byExit}) — herladen beide vensters${bootPlaybackContextSuffix()}`,
        );
        try {
          const c = controlWindow;
          if (c && !c.isDestroyed()) c.webContents.reloadIgnoringCache();
          const d = ensureDisplayWindow();
          if (d && !d.isDestroyed()) d.webContents.reloadIgnoringCache();
        } catch (e) {
          bootLog(`[app] child-process-gone GPU reload failed ${String(e)}`);
        }
      });

      if (process.platform === "win32") {
        bootLog("[gpu] Direct Composition video-overlays uit (scorebord + video)");
      }
      if (videoDecodeFallbackEnabled()) {
        bootLog("[gpu-fallback] hardware video decode uitgeschakeld voor deze sessie");
      }
      startDisplayPowerSaveBlocker();
      bootLog("Desktop runtime OK — open vensters.");
      startBootMetricsLogging();
    } catch (err) {
      closeSplashWindow();
      const message = err instanceof Error ? err.message : String(err);
      bootLog(`FATAL: ${message}`);
      flushBootLogSync();
      dialog.showErrorBox(
        "Stadium Scoreboard — opstartfout",
        `De desktop-app kon niet initialiseren.\n\n${message}\n\nLogbestand:\n${bootLogPath()}`,
      );
      allowQuitWithoutConfirm = true;
      app.quit();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (e) => {
  if (!allowQuitWithoutConfirm) {
    e.preventDefault();
    void (async () => {
      const ok = await confirmAppQuit(controlWindow);
      if (!ok) return;
      allowQuitWithoutConfirm = true;
      app.quit();
    })();
    return;
  }
  closeSplashWindow();
  stopDisplayPowerSaveBlocker();
  if (mobileBridge) {
    void mobileBridge.stop();
    mobileBridge = null;
  }
  if (cloudAgent) {
    cloudAgent.stop();
    cloudAgent = null;
  }
  if (streamDeck) {
    void streamDeck.stop();
    streamDeck = null;
  }
  if (livestream) {
    void livestream.stop();
  }
  if (streamWindow && !streamWindow.isDestroyed()) {
    streamWindow.destroy();
    streamWindow = null;
  }
  runtime?.disposeDesktopRuntime();
});
