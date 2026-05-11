import { spawnSync } from "child_process";
import { app, BrowserWindow, desktopCapturer, ipcMain, dialog, Menu, screen, session, shell } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import type { DesktopApiRequest, ElectronBridge, ExportFormat } from "../lib/desktop-bridge";
import * as licenseSvc from "./license-service";
import { startMobileBridge, type MobileBridgeHandle } from "./mobile-bridge";
import { startCloudControlAgent, type CloudAgentHandle } from "./cloud-control";
import { getAppResourceMetrics, getMemoryBreakdownForBootLog } from "./resource-metrics";

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
 * Workaround bij sommige Windows GPU-drivers: hardware-videodecode rendert een zwarte
 * laag terwijl de rest van de UI (score) wel zichtbaar blijft. Zet vóór app-start:
 * `STADIUM_DISABLE_ACCELERATED_VIDEO_DECODE=1` — dan valt decode terug op software
 * (meer CPU; HEVC kan in de browser ontbreken — liever clips als H.264).
 */
if (videoDecodeFallbackEnabled()) {
  app.commandLine.appendSwitch("disable-accelerated-video-decode");
  // bootLog not yet on disk path until configure — console is enough for early startup.
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
let splashWindow: BrowserWindow | null = null;

function bootLogPath(): string {
  return path.join(app.getPath("userData"), "boot.log");
}

function bootLog(line: string) {
  const lineWithNl = `[${new Date().toISOString()}] ${line}\n`;
  try {
    const logFile = bootLogPath();
    try {
      const st = fs.statSync(logFile);
      const maxBytes = 5 * 1024 * 1024;
      if (st.size > maxBytes) {
        const keep = fs.readFileSync(logFile, "utf8").slice(-Math.floor(maxBytes / 2));
        fs.writeFileSync(logFile, keep, "utf8");
      }
    } catch {
      /* ignore */
    }
    fs.appendFileSync(bootLogPath(), lineWithNl, "utf8");
  } catch {
    /* ignore */
  }
  console.log(line);
}

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  bootLog(`[process] unhandledRejection ${msg}`);
});

process.on("uncaughtException", (error) => {
  bootLog(`[process] uncaughtException ${error.name}: ${error.message}`);
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

function prismaDatabaseUrl(dbPath: string): string {
  return `file:${dbPath.replace(/\\/g, "/")}`;
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

  bootLog(`appRoot=${root} packaged=${app.isPackaged}`);
  bootLog(
    `userDataDir=${userDataDir} portableEnv=${Boolean(process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE)}`,
  );
  bootLog(`DATABASE_URL=${process.env.DATABASE_URL}`);

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
    log: bootLog,
  });
  mobileBridge = await startMobileBridge({
    runtime: {
      apiRequest: (req) => runtime!.apiRequest(req),
      getDisplaySnapshot: () => runtime!.getDisplaySnapshot(),
      getSponsorLedgerSnapshot: () => runtime!.getSponsorLedgerSnapshot(),
      runCommand: (command) => runtime!.runCommand(command as any),
    },
    log: bootLog,
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

function loadView(win: BrowserWindow, view: "control" | "display") {
  return win.loadFile(rendererEntryPath(), {
    query: { view },
  });
}

/**
 * Monitor voor het stadionscherm: bij twee schermen de niet-primaire (meestal HDMI → processor → muur),
 * anders de primaire. Zo blijft de taakbalk op de bedieningsmonitor staan.
 */
function stadiumDisplay() {
  const primary = screen.getPrimaryDisplay();
  const external = screen.getAllDisplays().find((d) => d.id !== primary.id);
  return external ?? primary;
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
    const { x, y, width, height } = stadiumDisplay().bounds;
    win.setBounds({ x, y, width, height });
    if (!win.isFullScreen()) win.setFullScreen(true);
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
    bootLog(`[control] renderer unresponsive -> reload${bootPlaybackContextSuffix()}`);
    const win = controlWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.reloadIgnoringCache();
    }
  });
  if (IS_DEV && process.env.OPEN_DEVTOOLS_ON_START === "1") {
    controlWindow.webContents.openDevTools({ mode: "detach" });
  }
  controlWindow.on("closed", () => {
    controlWindow = null;
  });

  displayWindow = new BrowserWindow({
    title: "Stadium Scoreboard — Display",
    backgroundColor: "#000000",
    frame: false,
    show: false,
    fullscreenable: true,
    ...(winIcon ? { icon: winIcon } : {}),
    /** Windows: resize-rand i.p.v. alleen `maximize()` bij frameless. */
    thickFrame: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  void loadView(displayWindow, "display");
  /** Navigatie/renderer-fouten op het stadionscherm (los van video-element). */
  displayWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    bootLog(
      `[display] did-fail-load code=${errorCode} ${errorDescription} url=${String(validatedURL ?? "").slice(0, 200)}${bootPlaybackContextSuffix()}`,
    );
  });
  /** Bounds op stadionscherm, dan fullscreen — geen taakbalk op die monitor. */
  displayWindow.once("ready-to-show", () => {
    applyDisplayFullscreen(displayWindow);
    displayWindow?.show();
    setImmediate(() => applyDisplayFullscreen(displayWindow));
  });
  displayWindow.webContents.on("did-finish-load", () => {
    void runtime?.broadcastDisplayState();
  });
  displayWindow.webContents.on("render-process-gone", (_event, details) => {
    bootLog(
      `[display] render-process-gone reason=${details.reason} exitCode=${details.exitCode}${bootPlaybackContextSuffix()}`,
    );
    const win = displayWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.reloadIgnoringCache();
    }
  });
  displayWindow.webContents.on("unresponsive", () => {
    bootLog(`[display] renderer unresponsive -> reload${bootPlaybackContextSuffix()}`);
    const win = displayWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.reloadIgnoringCache();
    }
  });
  displayWindow.on("closed", () => {
    displayWindow = null;
  });

  buildMenu();
}

function psSingleQuoteEscape(p: string): string {
  return p.replace(/'/g, "''");
}

async function runVenueBackupExport(parent: BrowserWindow | null): Promise<{
  ok: boolean;
  canceled?: boolean;
  error?: string;
  filePath?: string;
}> {
  const ctx = desktopContext;
  if (!ctx) return { ok: false, error: "Desktop context ontbreekt." };
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

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stadium-bk-"));
  const staging = path.join(tmpRoot, "stadium-backup");
  try {
    fs.mkdirSync(path.join(staging, "data"), { recursive: true });
    fs.mkdirSync(path.join(staging, "uploads"), { recursive: true });
    fs.copyFileSync(dbSrc, path.join(staging, "data", "stadium.db"));
    if (fs.existsSync(ctx.uploadsDir)) {
      fs.cpSync(ctx.uploadsDir, path.join(staging, "uploads"), { recursive: true });
    }
    const zipTarget = save.filePath.toLowerCase().endsWith(".zip") ? save.filePath : `${save.filePath}.zip`;

    if (process.platform === "win32") {
      const cmd = `Compress-Archive -LiteralPath '${psSingleQuoteEscape(staging)}' -DestinationPath '${psSingleQuoteEscape(zipTarget)}' -Force`;
      const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], {
        encoding: "utf8",
      });
      if (r.status !== 0) {
        bootLog(`[backup] powershell failed: ${r.stderr ?? r.stdout ?? "unknown"}`);
        return { ok: false, error: r.stderr || r.stdout || "ZIP-export mislukt (PowerShell)." };
      }
    } else {
      const r = spawnSync("zip", ["-r", "-q", zipTarget, "stadium-backup"], {
        cwd: tmpRoot,
        encoding: "utf8",
      });
      if (r.status !== 0) {
        bootLog(`[backup] zip failed: ${r.stderr ?? ""}`);
        return {
          ok: false,
          error: "ZIP-export mislukt (installeer het `zip`-commando, of voer backup uit op Windows).",
        };
      }
    }

    bootLog(`[backup] venue export OK: ${zipTarget}`);
    return { ok: true, filePath: zipTarget };
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function buildMenu() {
  const uploadsDir = desktopContext?.uploadsDir ?? path.join(app.getPath("userData"), "uploads");
  const menu = Menu.buildFromTemplate([
    {
      label: "Bestand",
      submenu: [
        {
          label: "Exporteer venue-backup (ZIP)…",
          click: async () => {
            const r = await runVenueBackupExport(controlWindow);
            if (r.canceled) return;
            if (!r.ok) {
              await dialog.showMessageBox({
                type: "error",
                title: "Venue-backup",
                message: "Exporteren mislukt.",
                detail: r.error ?? "Onbekende fout",
              });
              return;
            }
            await dialog.showMessageBox({
              type: "info",
              title: "Venue-backup",
              message: "Backup opgeslagen.",
              detail: r.filePath ?? "",
            });
          },
        },
        { type: "separator" },
        {
          label: "Verberg display-venster",
          click: () => displayWindow?.hide(),
        },
        {
          label: "Toon display-venster",
          click: () => {
            displayWindow?.show();
            displayWindow?.focus();
          },
        },
        {
          label: "Display fullscreen aan/uit",
          accelerator: "F11",
          click: () => displayWindow?.setFullScreen(!displayWindow?.isFullScreen()),
        },
        { type: "separator" },
        {
          label: "Open log-map (foutopsporing)",
          click: () => shell.openPath(app.getPath("userData")),
        },
        {
          label: "Open uploads-map",
          click: () => shell.openPath(uploadsDir),
        },
        { type: "separator" },
        { role: "quit", label: "Afsluiten" },
      ],
    },
    {
      label: "Weergave",
      submenu: [
        { role: "reload", label: "Herladen (actief venster)" },
        {
          label: "Herlaad bedieningspaneel",
          click: () => {
            const w = controlWindow;
            if (w && !w.isDestroyed()) w.webContents.reloadIgnoringCache();
          },
        },
        {
          label: "Herlaad stadionbeeld",
          click: () => {
            const w = displayWindow;
            if (w && !w.isDestroyed()) w.webContents.reloadIgnoringCache();
          },
        },
        { type: "separator" },
        { role: "toggleDevTools", label: "DevTools (control)" },
        {
          label: "DevTools (display)",
          click: () => displayWindow?.webContents.openDevTools(),
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Licenties en open source…",
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
      return { ok: false, error: "Automatische sponsorrotatie is niet beschikbaar in dit licentieplan." };
    }
    return runtime.runCommand(cmd);
  });

  ipcMain.handle("display:getSnapshot", async () => {
    if (!runtime) throw new Error("Runtime not initialized");
    return runtime.getDisplaySnapshot();
  });

  ipcMain.handle("display:getSponsorLedger", async () => {
    if (!runtime) throw new Error("Runtime not initialized");
    return runtime.getSponsorLedgerSnapshot();
  });

  ipcMain.handle("display:sponsorClipStart", async (_, payload) => {
    if (!runtime) throw new Error("Runtime not initialized");
    runtime.sponsorTelemetryClipStart(payload);
    return { ok: true };
  });

  ipcMain.handle("display:sponsorClipEnd", async (_, payload) => {
    if (!runtime) throw new Error("Runtime not initialized");
    runtime.sponsorTelemetryClipEnd(payload);
    return { ok: true };
  });

  ipcMain.handle("window:focusDisplay", async () => {
    if (!displayWindow) return;
    applyDisplayFullscreen(displayWindow);
    displayWindow.show();
    displayWindow.focus();
    setImmediate(() => applyDisplayFullscreen(displayWindow));
  });

  ipcMain.handle("window:reloadDisplay", async () => {
    if (!displayWindow) return { ok: false };
    try {
      displayWindow.webContents.reloadIgnoringCache();
      setImmediate(() => {
        if (displayWindow) applyDisplayFullscreen(displayWindow);
      });
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
    return {
      ok: true,
      organizationLabel: r.organizationLabel,
      status: r.status,
      ...(r.plan !== undefined ? { plan: r.plan } : {}),
      ...(r.planLabel !== undefined ? { planLabel: r.planLabel } : {}),
      ...(r.features !== undefined ? { features: r.features } : {}),
    };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
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
      if (permission === "media" || permission === "display-capture") {
        callback(true);
      } else {
        callback(false);
      }
    });

    createSplashWindow();

    try {
      await loadRuntime();
      registerIpc();
      createWindows();
      wireSplashUntilControlReady();

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
          bootLog(
            `[app] GPU-crash tijdens sponsorvideo — schakel hardware video decode uit en herstart${bootPlaybackContextSuffix()}`,
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
          `[app] child-process-gone GPU reason=${details.reason} exitCode=${details.exitCode} (byReason=${byReason} byExit=${byExit}) — herladen beide vensters${bootPlaybackContextSuffix()}`,
        );
        try {
          const c = controlWindow;
          if (c && !c.isDestroyed()) c.webContents.reloadIgnoringCache();
          const d = displayWindow;
          if (d && !d.isDestroyed()) d.webContents.reloadIgnoringCache();
        } catch (e) {
          bootLog(`[app] child-process-gone GPU reload failed ${String(e)}`);
        }
      });

      if (videoDecodeFallbackEnabled()) {
        bootLog("[gpu-fallback] hardware video decode uitgeschakeld voor deze sessie");
      }
      bootLog("Desktop runtime OK — open vensters.");
      startBootMetricsLogging();
    } catch (err) {
      closeSplashWindow();
      const message = err instanceof Error ? err.message : String(err);
      bootLog(`FATAL: ${message}`);
      dialog.showErrorBox(
        "Stadium Scoreboard — opstartfout",
        `De desktop-app kon niet initialiseren.\n\n${message}\n\nLogbestand:\n${bootLogPath()}`,
      );
      app.quit();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  closeSplashWindow();
  if (mobileBridge) {
    void mobileBridge.stop();
    mobileBridge = null;
  }
  if (cloudAgent) {
    cloudAgent.stop();
    cloudAgent = null;
  }
  runtime?.disposeDesktopRuntime();
});
