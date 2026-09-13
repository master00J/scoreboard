import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Writable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import { screen, type BrowserWindow } from "electron";
import {
  clampBitrateKbps,
  DEFAULT_LIVESTREAM_HEALTH,
  DEFAULT_LIVESTREAM_SETTINGS,
  buildRtmpDestinations,
  ffmpegOutputArgs,
  isRtmpDestination,
  maskRtmpDestination,
  mergeLivestreamSettings,
  resolveActiveVideoInput,
  resolvePreviewVideoInput,
  videoInputPreviewKey,
  parseDshowAudioDevices,
  parseDshowVideoDevices,
  mergeLivestreamAudioDevices,
  audioDeviceDisplayName,
  isWasapiAudioDevice,
  isMediaAudioDevice,
  browserAudioDeviceId,
  browserAudioInputId,
  mediaAudioInputId,
  sourceAudioDevices,
  wasapiLoopbackPipeName,
  armedAudioChannels,
  audioDeviceFingerprint,
  audioGainCommands,
  audioMonitorGains,
  audioMonitorProcessKey,
  buildAudioMixPlan,
  LIVESTREAM_AZMQ_PORT,
  silentAudioMixPlan,
  resolutionSize,
  sixteenByNineScaleFilter,
  ffmpegProgressHasEncodedFrame,
  parseFfmpegProgressFields,
  looksLikePacketLoss,
  stripFfmpegProgressLines,
  appendFfmpegProgressBuffer,
  looksLikeEncoderFail,
  looksLikeDestinationFail,
  looksLikeNonEncoderFail,
  STREAM_AUDIO_BITRATE_K,
  STREAM_AUDIO_SAMPLE_RATE,
  type LivestreamAudioDevice,
  type LivestreamCameraDevice,
  type LivestreamAudioMeterMap,
  type LivestreamEncoder,
  type LivestreamHealth,
  type LivestreamSettings,
  type LivestreamStatus,
} from "../lib/livestream";
import { sendZmqReq } from "./zmq-req";
import { createBrowserAudioTap, type BrowserAudioTap } from "./browser-source-audio";

export type StreamWindowRequest = {
  camera: string;
  overlay: boolean;
  width: number;
  height: number;
  fps: number;
};

export type BrowserSourceRequest = {
  url: string;
  width: number;
  height: number;
  fps: number;
};

export type MediaSourceRequest = {
  path: string;
  loop: boolean;
  width: number;
  height: number;
  fps: number;
};

export type LivestreamController = {
  getSettings: () => LivestreamSettings;
  saveSettings: (partial: Partial<LivestreamSettings>) => LivestreamSettings;
  listCameras: () => Promise<LivestreamCameraDevice[]>;
  listAudioDevices: () => Promise<LivestreamAudioDevice[]>;
  listAudioOutputs: () => Promise<LivestreamAudioDevice[]>;
  getStatus: () => LivestreamStatus;
  start: () => Promise<LivestreamStatus>;
  stop: () => Promise<LivestreamStatus>;
  startRecord: () => Promise<LivestreamStatus>;
  stopRecord: () => Promise<LivestreamStatus>;
  notifyProgramReady: () => void;
};

type Deps = {
  getDisplayWindow: () => BrowserWindow | null;
  getControlWindow: () => BrowserWindow | null;
  getStreamWindow: () => BrowserWindow | null;
  ensureStreamWindow: (req: StreamWindowRequest) => Promise<{ win: BrowserWindow; reloaded: boolean }>;
  closeStreamWindow: () => Promise<void>;
  getBrowserWindow: () => BrowserWindow | null;
  ensureBrowserWindow: (req: BrowserSourceRequest) => Promise<{ win: BrowserWindow; reloaded: boolean }>;
  closeBrowserWindow: () => Promise<void>;
  getMediaWindow: () => BrowserWindow | null;
  ensureMediaWindow: (req: MediaSourceRequest) => Promise<{ win: BrowserWindow; reloaded: boolean }>;
  closeMediaWindow: () => Promise<void>;
  userDataDir: () => string;
  recordDir: () => string;
  appRoot: () => string;
  resourcesPath: () => string;
  log: (line: string) => void;
};

function settingsPath(userDataDir: string) {
  return path.join(userDataDir, "livestream-settings.json");
}

function readSettings(file: string): LivestreamSettings {
  try {
    if (!fs.existsSync(file)) return { ...DEFAULT_LIVESTREAM_SETTINGS };
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<LivestreamSettings>;
    return mergeLivestreamSettings(raw);
  } catch {
    return { ...DEFAULT_LIVESTREAM_SETTINGS };
  }
}

function writeSettings(file: string, settings: LivestreamSettings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), "utf8");
}

let cachedFfmpegPath: string | null | undefined;

function resolveFfmpegPath(deps: Deps, force = false): string | null {
  if (!force && cachedFfmpegPath !== undefined) return cachedFfmpegPath;
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates = [
    path.join(deps.resourcesPath(), "ffmpeg", exe),
    path.join(deps.appRoot(), "vendor", "ffmpeg", exe),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      cachedFfmpegPath = candidate;
      return candidate;
    }
  }
  cachedFfmpegPath = process.platform === "win32" ? null : "ffmpeg";
  return cachedFfmpegPath;
}

function streamOverlayChanged(prev: LivestreamSettings, next: LivestreamSettings): boolean {
  return (
    prev.source !== next.source ||
    prev.cameraDevice !== next.cameraDevice ||
    prev.overlay !== next.overlay ||
    prev.layoutMode !== next.layoutMode ||
    prev.manualPhaseSplit !== next.manualPhaseSplit ||
    prev.sponsors !== next.sponsors ||
    prev.sponsorStyle !== next.sponsorStyle ||
    prev.sponsorScope !== next.sponsorScope ||
    prev.sponsorPosition !== next.sponsorPosition ||
    prev.scorePosition !== next.scorePosition ||
    JSON.stringify(prev.scoreWidget) !== JSON.stringify(next.scoreWidget) ||
    JSON.stringify(prev.manualLayout) !== JSON.stringify(next.manualLayout) ||
    JSON.stringify(prev.manualPlayLayout) !== JSON.stringify(next.manualPlayLayout) ||
    JSON.stringify(prev.manualBreakLayout) !== JSON.stringify(next.manualBreakLayout)
  );
}

function even(n: number): number {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v + 1;
}

type CapturePlan = {
  label: string;
  inputArgs: string[];
  videoFilter: string[];
  pipeWidth: number;
  pipeHeight: number;
};

function windowIsOffscreen(win: BrowserWindow): boolean {
  try {
    const prefs = (
      win.webContents as Electron.WebContents & {
        getLastWebPreferences?: () => { offscreen?: boolean };
      }
    ).getLastWebPreferences?.();
    if (prefs) return Boolean(prefs.offscreen);
  } catch {
    /* oudere Electron */
  }
  return false;
}

async function probeWindowFrameSize(win: BrowserWindow): Promise<{ width: number; height: number }> {
  try {
    const image = await win.webContents.capturePage();
    if (!image.isEmpty()) {
      const size = image.getSize();
      if (size.width >= 2 && size.height >= 2) {
        return { width: even(size.width), height: even(size.height) };
      }
    }
  } catch {
    /* fallback op DIP × scaleFactor */
  }
  const [w, h] = win.getContentSize();
  const factor = screen.getDisplayMatching(win.getBounds()).scaleFactor || 1;
  return { width: even(Math.round(w * factor)), height: even(Math.round(h * factor)) };
}

function programCapturePlan(
  width: number,
  height: number,
  fps: number,
  outWidth = width,
  outHeight = height,
): CapturePlan {
  const needScale = outWidth !== width || outHeight !== height;
  const scale = needScale ? `${sixteenByNineScaleFilter(outWidth, outHeight).replace(/,format=yuv420p$/, "")},` : "";
  return {
    label: needScale
      ? `display-window ${width}x${height} → ${outWidth}x${outHeight}@${fps}`
      : `camera+overlay offscreen ${width}x${height}@${fps}`,
    inputArgs: [
      "-f",
      "rawvideo",
      "-pix_fmt",
      "bgra",
      "-s",
      `${width}x${height}`,
      "-i",
      "pipe:0",
    ],
    videoFilter: ["-vf", `setpts=(RTCTIME-RTCSTART)/1000000/TB,${scale}fps=${fps},format=yuv420p`],
    pipeWidth: width,
    pipeHeight: height,
  };
}

type AudioPlan = ReturnType<typeof buildAudioMixPlan>;

function listDshowDevices(ffmpegPath: string): Promise<{ video: LivestreamCameraDevice[]; audio: LivestreamAudioDevice[] }> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"], {
      windowsHide: true,
    });
    let out = "";
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      resolve({
        video: parseDshowVideoDevices(out),
        audio: parseDshowAudioDevices(out),
      });
    };
    const bumpIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
      }, 12_000);
    };
    const onChunk = (buf: Buffer) => {
      out += buf.toString("utf8");
      bumpIdle();
    };
    proc.stderr.on("data", onChunk);
    proc.stdout.on("data", onChunk);
    proc.on("close", () => finish());
    proc.on("error", () => finish());
    bumpIdle();
    setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }, 25_000);
  });
}

const WINDOWS_ENDPOINTS_TTL_MS = 30_000;
let windowsEndpointsCache: { at: number; devices: LivestreamAudioDevice[] } | null = null;

/** Windows-opname-eindpunten (GoXLR/RodeCaster) als FFmpeg-dshow te vroeg stopt. */
function listWindowsCaptureEndpoints(): Promise<LivestreamAudioDevice[]> {
  if (process.platform !== "win32") return Promise.resolve([]);
  if (windowsEndpointsCache && Date.now() - windowsEndpointsCache.at < WINDOWS_ENDPOINTS_TTL_MS) {
    return Promise.resolve(windowsEndpointsCache.devices);
  }
  return new Promise((resolve) => {
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "function Device-Name($props) {",
      "  $short = $props.'{a45c254e-df1c-4efd-8020-67d146a850e0},2'",
      "  $iface = $props.'{b3f8fa53-0004-438e-9003-51a46e139bfc},6'",
      "  if ($short -and $iface) { return \"$short ($iface)\" }",
      "  if ($short) { return [string]$short }",
      "  return $null",
      "}",
      "$capture = @{}",
      "Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Capture' | ForEach-Object {",
      "  $n = Device-Name (Get-ItemProperty (Join-Path $_.PSPath 'Properties'))",
      "  if ($n) { $capture[$n] = $true; $n }",
      "}",
      "Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Render' | ForEach-Object {",
      "  $n = Device-Name (Get-ItemProperty (Join-Path $_.PSPath 'Properties'))",
      "  if (-not $n) { return }",
      "  if ($n -notmatch 'GoXLR|TC-Helicon') { return }",
      "  if ($capture.ContainsKey($n)) { return }",
      "  \"wasapi:$n\"",
      "}",
    ].join("\n");
    const proc = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
    );
    let out = "";
    let settled = false;
    const finish = (devices: LivestreamAudioDevice[]) => {
      if (settled) return;
      settled = true;
      windowsEndpointsCache = { at: Date.now(), devices };
      resolve(devices);
    };
    proc.stdout.on("data", (buf: Buffer) => {
      out += buf.toString("utf8");
    });
    proc.on("close", () => {
      const devices = out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((name) => name.length > 0 && name.length <= 200)
        .map((name) => ({ name }));
      finish(devices);
    });
    proc.on("error", () => finish([]));
    setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      finish(
        out
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((name) => name.length > 0 && name.length <= 200)
          .map((name) => ({ name })),
      );
    }, 8000);
  });
}

function listDshowVideoDevices(ffmpegPath: string): Promise<LivestreamCameraDevice[]> {
  return listDshowDevices(ffmpegPath).then((d) => d.video);
}

function wasapiLoopbackSourcePath(): string {
  const fromCwd = path.join(process.cwd(), "electron", "wasapi-loopback-capture.cs");
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.join(__dirname, "wasapi-loopback-capture.cs");
}

function naudioDllPath(): string {
  const fromCwd = path.join(process.cwd(), "vendor", "naudio", "NAudio.dll");
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.join(__dirname, "..", "vendor", "naudio", "NAudio.dll");
}

function ensureWasapiLoopbackExe(userDataDir: string): Promise<string | null> {
  const src = wasapiLoopbackSourcePath();
  const dllSrc = naudioDllPath();
  const exe = path.join(userDataDir, "wasapi-loopback-capture.exe");
  const dllDest = path.join(userDataDir, "NAudio.dll");
  if (!fs.existsSync(dllSrc)) return Promise.resolve(null);
  if (!fs.existsSync(dllDest) || fs.statSync(dllDest).mtimeMs < fs.statSync(dllSrc).mtimeMs) {
    fs.copyFileSync(dllSrc, dllDest);
  }
  if (!fs.existsSync(src)) return Promise.resolve(fs.existsSync(exe) ? exe : null);
  if (fs.existsSync(exe) && fs.statSync(exe).mtimeMs >= fs.statSync(src).mtimeMs) {
    return Promise.resolve(exe);
  }
  const csc = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  if (!fs.existsSync(csc)) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      csc,
      ["/nologo", "/target:exe", "/platform:x64", `/r:${dllDest}`, `/out:${exe}`, src],
      { windowsHide: true },
      (err) => {
        resolve(err ? null : exe);
      },
    );
  });
}

function encoderArgs(encoder: LivestreamEncoder, bitrateKbps: number, fps: number): string[] {
  const maxrate = Math.round(bitrateKbps * 1.1);
  const bufsize = bitrateKbps * 2;
  const common = [
    "-pix_fmt",
    "yuv420p",
    "-g",
    String(Math.max(30, fps * 2)),
    "-r",
    String(fps),
    "-fps_mode",
    "cfr",
    "-b:v",
    `${bitrateKbps}k`,
    "-maxrate",
    `${maxrate}k`,
    "-bufsize",
    `${bufsize}k`,
  ];
  if (encoder === "h264_nvenc") {
    return [
      "-c:v",
      "h264_nvenc",
      "-preset",
      "p5",
      "-tune",
      "hq",
      "-rc",
      "cbr",
      "-profile:v",
      "high",
      "-spatial-aq",
      "1",
      "-aq-strength",
      "8",
      /** B-frames + lookahead: merkbaar scherpere randen bij gelijke bitrate. */
      "-bf",
      "2",
      "-b_ref_mode",
      "middle",
      "-rc-lookahead",
      "20",
      ...common,
    ];
  }
  return [
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-tune",
    "film",
    "-profile:v",
    "high",
    /** Scorebord = harde randen op zwart; extra referenties helpen tegen ringing. */
    "-bf",
    "2",
    "-refs",
    "3",
    ...common,
  ];
}

function sanitizeLogLine(line: string): string {
  return line
    .replace(/rtmps?:\/\/\S+/gi, (url) => maskRtmpDestination(url))
    .replace(/[A-Za-z0-9_-]{20,}/g, "***")
    .trim();
}

function writeWithBackpressure(stdin: Writable, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = stdin.write(buf, (err) => {
      if (err) reject(err);
    });
    if (ok) resolve();
    else stdin.once("drain", () => resolve());
  });
}

type LiveSession = {
  ffmpegPath: string;
  dests: string[];
  encoder: LivestreamEncoder;
  plan: CapturePlan;
  audioPlan: AudioPlan;
  programWindow: BrowserWindow | null;
  width: number;
  height: number;
  fps: number;
};

const HEALTH_WAIT_MS = 15_000;
const PROGRAM_READY_TIMEOUT_MS = 8_000;
const RECONNECT_MAX_DELAY_MS = 15_000;

export function createLivestreamController(deps: Deps): LivestreamController {
  let settings = readSettings(settingsPath(deps.userDataDir()));
  let child: ChildProcessWithoutNullStreams | null = null;
  const loopbackChildren: ChildProcessWithoutNullStreams[] = [];
  const browserAudioTaps = new Map<string, BrowserAudioTap>();
  const meterChildren = new Map<string, ChildProcessWithoutNullStreams>();
  const meterLevels: LivestreamAudioMeterMap = {};
  let lastMeterEmit = 0;
  let monitorChild: ChildProcessWithoutNullStreams | null = null;
  let monitorKey = "";
  let startedAt: string | null = null;
  let encoder: LivestreamEncoder | null = null;
  let error: string | null = null;
  let lastLogLine: string | null = null;
  let attemptStderr = "";
  let pumpAbort = false;
  let pumpGeneration = 0;
  let paintCleanup: (() => void) | null = null;
  let sourcePreviewCleanup: (() => void) | null = null;
  let sourcePreviewGen = 0;
  let liveDestinations: string[] = [];
  let userWantsLive = false;
  let userWantsRecord = false;
  let recordFile: string | null = null;
  let sessionArmed = false;
  let lastSession: LiveSession | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let programIsReady = false;
  const programReadyWaiters: Array<() => void> = [];
  let health: LivestreamHealth = { ...DEFAULT_LIVESTREAM_HEALTH };
  let lastProgressAt = 0;
  let lastPreviewAt = 0;
  let lastHealthEmit = 0;
  let switchingSource = false;
  let captureEpoch = 0;

  const encoding = () => userWantsLive || userWantsRecord;
  const isLiveIntent = () => encoding() && sessionArmed;

  const buildEncodeDests = () => {
    const dests: string[] = [];
    if (userWantsLive) dests.push(...buildRtmpDestinations(settings));
    if (userWantsRecord && recordFile) dests.push(recordFile);
    if (dests.length === 0) throw new Error("Geen bestemming (stream of opname).");
    return dests;
  };

  const newRecordFile = () => {
    const dir = settings.recordDir.trim() || deps.recordDir();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return path.join(dir, `arenacue-${stamp}.mp4`);
  };

  const emitSettings = () => {
    const win = deps.getStreamWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("livestream:settings", settings);
    }
  };

  const requestProgramReady = () => {
    const win = deps.getStreamWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("livestream:requestReady");
    }
  };

  const emit = () => {
    const win = deps.getControlWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("livestream:status", getStatus());
    }
  };

  let pumpedPreviewInputId: string | null = null;

  const emitPreview = (image: Electron.NativeImage) => {
    if (!settings.studioPreview) return;
    const now = performance.now();
    if (now - lastPreviewAt < 66) return;
    lastPreviewAt = now;
    const win = deps.getControlWindow();
    if (!win || win.isDestroyed() || image.isEmpty()) return;
    try {
      const size = image.getSize();
      const scale = Math.min(960 / Math.max(1, size.width), 540 / Math.max(1, size.height), 1);
      const width = Math.max(2, even(Math.round(size.width * scale)));
      const height = Math.max(2, even(Math.round(size.height * scale)));
      const small =
        size.width === width && size.height === height
          ? image
          : image.resize({ width, height, quality: "good" });
      win.webContents.send("livestream:preview", {
        jpeg: small.toJPEG(72).toString("base64"),
        inputId: pumpedPreviewInputId ?? settings.activeVideoInputId,
      });
    } catch {
      /* preview is best-effort */
    }
  };

  const notifyProgramReady = () => {
    programIsReady = true;
    while (programReadyWaiters.length > 0) {
      programReadyWaiters.shift()?.();
    }
  };

  const waitForProgramReady = (ms: number) => {
    if (programIsReady) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        const idx = programReadyWaiters.indexOf(done);
        if (idx >= 0) programReadyWaiters.splice(idx, 1);
        resolve();
      }, ms);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      programReadyWaiters.push(done);
    });
  };

  const waitForBrowserLoad = (win: BrowserWindow, ms: number) =>
    new Promise<void>((resolve) => {
      if (win.isDestroyed()) {
        resolve();
        return;
      }
      if (!win.webContents.isLoading() && /^(https?|file):/i.test(win.webContents.getURL())) {
        resolve();
        return;
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timer = setTimeout(done, ms);
      win.webContents.once("did-finish-load", () => {
        clearTimeout(timer);
        done();
      });
      win.webContents.once("did-fail-load", () => {
        clearTimeout(timer);
        done();
      });
    });

  let browserPreviewGen = 0;

  const stopSourcePreviewPump = () => {
    sourcePreviewGen += 1;
    sourcePreviewCleanup?.();
    sourcePreviewCleanup = null;
  };

  const webPreviewTarget = (input: ReturnType<typeof resolveActiveVideoInput> | null | undefined) => {
    if (!input) return null;
    if (input.kind === "browser" && input.browserUrl.trim()) {
      return { kind: "browser" as const, url: input.browserUrl.trim(), inputId: input.id };
    }
    if (input.kind === "media" && input.mediaPath.trim()) {
      return {
        kind: "media" as const,
        path: input.mediaPath.trim(),
        loop: input.mediaLoop,
        inputId: input.id,
      };
    }
    return null;
  };

  const syncBrowserPreview = async () => {
    const gen = ++browserPreviewGen;
    const active = resolveActiveVideoInput(settings);
    const preview = resolvePreviewVideoInput(settings);
    const programOwnsWindow = encoding() && (settings.source === "browser" || settings.source === "media");
    const target = programOwnsWindow
      ? null
      : encoding()
        ? webPreviewTarget(preview && preview.id !== active.id ? preview : null)
        : webPreviewTarget(active) ?? webPreviewTarget(preview);

    if (!settings.studioPreview || !target) {
      if (programOwnsWindow) pumpedPreviewInputId = active.id;
      else pumpedPreviewInputId = null;
      stopSourcePreviewPump();
      if (!encoding()) {
        stopPump();
        await deps.closeBrowserWindow();
        await deps.closeMediaWindow();
      }
      return;
    }

    pumpedPreviewInputId = target.inputId;
    const outSize = resolutionSize(settings.resolution);
    if (target.kind === "media") {
      await deps.closeBrowserWindow();
      const ensured = await deps.ensureMediaWindow({
        path: target.path,
        loop: target.loop,
        width: outSize.width,
        height: outSize.height,
        fps: settings.fps,
      });
      if (gen !== browserPreviewGen) return;
      await waitForBrowserLoad(ensured.win, 8_000);
      if (gen !== browserPreviewGen || ensured.win.isDestroyed()) return;
      if (encoding()) startSourcePreviewPump(ensured.win);
      else {
        stopSourcePreviewPump();
        startPump(ensured.win, outSize.width, outSize.height, settings.fps);
      }
      return;
    }
    await deps.closeMediaWindow();
    const ensured = await deps.ensureBrowserWindow({
      url: target.url,
      width: outSize.width,
      height: outSize.height,
      fps: settings.fps,
    });
    if (gen !== browserPreviewGen) return;
    await waitForBrowserLoad(ensured.win, 8_000);
    if (gen !== browserPreviewGen || ensured.win.isDestroyed()) return;
    if (encoding()) startSourcePreviewPump(ensured.win);
    else {
      stopSourcePreviewPump();
      startPump(ensured.win, outSize.width, outSize.height, settings.fps);
    }
  };

  const openProgramCapture = async (
    outSize: { width: number; height: number },
  ): Promise<
    { ok: true; programWindow: BrowserWindow; plans: CapturePlan[] } | { ok: false; error: string }
  > => {
    if (settings.source === "camera") {
      await deps.closeBrowserWindow();
      await deps.closeMediaWindow();
      const device = settings.cameraDevice.trim();
      if (!device) return { ok: false, error: "Kies een camera of HDMI-ingang" };
      const ensured = await deps.ensureStreamWindow({
        camera: device,
        overlay: settings.overlay,
        width: outSize.width,
        height: outSize.height,
        fps: settings.fps,
      });
      programIsReady = false;
      emitSettings();
      requestProgramReady();
      await waitForProgramReady(PROGRAM_READY_TIMEOUT_MS);
      return {
        ok: true,
        programWindow: ensured.win,
        plans: [programCapturePlan(outSize.width, outSize.height, settings.fps)],
      };
    }
    if (settings.source === "browser") {
      await deps.closeStreamWindow();
      await deps.closeMediaWindow();
      const url = resolveActiveVideoInput(settings).browserUrl.trim();
      if (!url) return { ok: false, error: "Vul een website-URL in" };
      const ensured = await deps.ensureBrowserWindow({
        url,
        width: outSize.width,
        height: outSize.height,
        fps: settings.fps,
      });
      await waitForBrowserLoad(ensured.win, 8_000);
      return {
        ok: true,
        programWindow: ensured.win,
        plans: [programCapturePlan(outSize.width, outSize.height, settings.fps)],
      };
    }
    if (settings.source === "media") {
      await deps.closeStreamWindow();
      await deps.closeBrowserWindow();
      const filePath = resolveActiveVideoInput(settings).mediaPath.trim();
      if (!filePath) return { ok: false, error: "Kies een mediabestand" };
      const ensured = await deps.ensureMediaWindow({
        path: filePath,
        loop: resolveActiveVideoInput(settings).mediaLoop,
        width: outSize.width,
        height: outSize.height,
        fps: settings.fps,
      });
      await waitForBrowserLoad(ensured.win, 8_000);
      return {
        ok: true,
        programWindow: ensured.win,
        plans: [programCapturePlan(outSize.width, outSize.height, settings.fps)],
      };
    }
    await deps.closeStreamWindow();
    await deps.closeBrowserWindow();
    await deps.closeMediaWindow();
    const display = deps.getDisplayWindow();
    if (!display || display.isDestroyed()) {
      return { ok: false, error: "Display-venster is niet beschikbaar" };
    }
    if (!display.isVisible()) display.show();
    const src = await probeWindowFrameSize(display);
    return {
      ok: true,
      programWindow: display,
      plans: [programCapturePlan(src.width, src.height, settings.fps, outSize.width, outSize.height)],
    };
  };

  const stopPump = () => {
    pumpGeneration += 1;
    pumpAbort = true;
    paintCleanup?.();
    paintCleanup = null;
  };

  const startPump = (win: BrowserWindow, width: number, height: number, fps: number) => {
    stopPump();
    const gen = pumpGeneration;
    pumpAbort = false;
    if (win.isDestroyed()) return;
    const offscreen = windowIsOffscreen(win);
    try {
      win.webContents.setFrameRate(fps);
      if (offscreen && typeof win.webContents.startPainting === "function" && !win.webContents.isPainting()) {
        win.webContents.startPainting();
      }
    } catch {
      /* oudere Electron zonder paint-API */
    }

    let writing = false;
    let paints = 0;
    let drops = 0;
    let lastPaintAt = 0;
    let lastDropLogAt = 0;
    let subscribed = false;
    const pumpStarted = performance.now();
    const frameMs = Math.max(8, Math.round(1000 / fps));
    const staleMs = frameMs * 2.5;
    const live = () => gen === pumpGeneration && !pumpAbort;

    const pushFrame = (image: Electron.NativeImage) => {
      if (!live() || image.isEmpty()) return;
      lastPaintAt = performance.now();
      emitPreview(image);
      if (writing) {
        drops += 1;
        health = { ...health, paintDrops: drops };
        const now = performance.now();
        if (drops === 1 || now - lastDropLogAt >= 10_000) {
          lastDropLogAt = now;
          deps.log(
            `[livestream] paint drop ${drops} (backpressure) na ${((now - pumpStarted) / 1000).toFixed(1)}s`,
          );
        }
        return;
      }
      const proc = child;
      if (!proc || proc.killed || !proc.stdin.writable || win.isDestroyed()) return;
      paints += 1;
      if (paints === 1 || paints === fps * 10 || paints === fps * 60) {
        deps.log(
          `[livestream] paint ${paints} frames in ${((performance.now() - pumpStarted) / 1000).toFixed(1)}s drops=${drops}`,
        );
      }
      writing = true;
      void (async () => {
        try {
          let frame = image;
          const size = frame.getSize();
          if (size.width !== width || size.height !== height) {
            frame = frame.resize({ width, height, quality: "best" });
          }
          const buf = frame.toBitmap();
          if (live() && proc.stdin.writable && buf.length > 0) {
            await writeWithBackpressure(proc.stdin, buf);
          }
        } catch {
          /* write kan falen tijdens stop of reconnect */
        } finally {
          writing = false;
        }
      })();
    };

    const onPaint = (_event: unknown, _dirty: unknown, image: Electron.NativeImage) => {
      pushFrame(image);
    };

    if (offscreen) {
      win.webContents.on("paint", onPaint);
    } else {
      try {
        win.webContents.beginFrameSubscription(false, (image) => {
          pushFrame(image);
        });
        subscribed = true;
      } catch {
        subscribed = false;
      }
    }

    const tick = setInterval(() => {
      if (!live() || win.isDestroyed()) return;
      if (lastPaintAt > 0 && performance.now() - lastPaintAt < staleMs) {
        return;
      }
      try {
        win.webContents.invalidate();
      } catch {
        /* ignore */
      }
      if (!offscreen) {
        void win.webContents
          .capturePage()
          .then((image) => pushFrame(image))
          .catch(() => undefined);
      }
    }, frameMs);

    try {
      win.webContents.invalidate();
    } catch {
      /* ignore */
    }
    if (!offscreen) {
      void win.webContents
        .capturePage()
        .then((image) => pushFrame(image))
        .catch(() => undefined);
    }
    paintCleanup = () => {
      clearInterval(tick);
      if (!win.isDestroyed()) {
        win.webContents.removeListener("paint", onPaint);
        if (subscribed) {
          try {
            win.webContents.endFrameSubscription();
          } catch {
            /* ignore */
          }
        }
      }
    };
  };

  const startSourcePreviewPump = (win: BrowserWindow) => {
    stopSourcePreviewPump();
    const gen = sourcePreviewGen;
    if (win.isDestroyed()) return;
    const offscreen = windowIsOffscreen(win);
    const onPaint = (_event: unknown, _dirty: unknown, image: Electron.NativeImage) => {
      if (gen !== sourcePreviewGen) return;
      emitPreview(image);
    };
    if (offscreen) {
      win.webContents.on("paint", onPaint);
    }
    const tick = setInterval(() => {
      if (gen !== sourcePreviewGen || win.isDestroyed()) return;
      void win.webContents
        .capturePage()
        .then((image) => {
          if (gen === sourcePreviewGen) emitPreview(image);
        })
        .catch(() => undefined);
    }, 120);
    try {
      win.webContents.invalidate();
    } catch {
      /* ignore */
    }
    sourcePreviewCleanup = () => {
      clearInterval(tick);
      if (!win.isDestroyed()) {
        win.webContents.removeListener("paint", onPaint);
      }
    };
  };

  const ffmpegAlive = () => Boolean(child && !child.killed);

  const getStatus = (): LivestreamStatus => ({
    running: Boolean(userWantsLive && (ffmpegAlive() || sessionArmed)),
    recording: Boolean(userWantsRecord && (ffmpegAlive() || sessionArmed)),
    recordPath: userWantsRecord ? recordFile : null,
    reconnecting: Boolean(isLiveIntent() && !ffmpegAlive()),
    platform: ffmpegAlive() || isLiveIntent() ? settings.platform : null,
    destinations: ffmpegAlive() || isLiveIntent()
      ? liveDestinations.map((url) => (isRtmpDestination(url) ? maskRtmpDestination(url) : path.basename(url)))
      : [],
    startedAt,
    encoder,
    error,
    lastLogLine,
    ffmpegFound: Boolean(resolveFfmpegPath(deps)),
    health: {
      ...health,
      targetFps: settings.fps,
      stale: Boolean(encoding() && lastProgressAt > 0 && Date.now() - lastProgressAt > 2500),
    },
  });

  const clearReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const stopBrowserAudioTaps = () => {
    for (const tap of browserAudioTaps.values()) tap.stop();
    browserAudioTaps.clear();
  };

  const syncBrowserAudioTaps = () => {
    const want = new Set(sourceAudioDevices(settings.videoInputs).map((item) => item.name));
    for (const [device, tap] of browserAudioTaps) {
      if (want.has(device)) continue;
      tap.stop();
      browserAudioTaps.delete(device);
      delete meterLevels[device];
    }
    for (const device of want) {
      if (browserAudioTaps.has(device)) continue;
      const tap = createBrowserAudioTap({
        device,
        pipePath: wasapiLoopbackPipeName(device),
        getWindow: () => {
          const active = resolveActiveVideoInput(settings);
          if (isMediaAudioDevice(device)) {
            if (settings.source !== "media" || active.id !== mediaAudioInputId(device)) return null;
            return deps.getMediaWindow();
          }
          if (settings.source !== "browser" || active.id !== browserAudioInputId(device)) return null;
          return deps.getBrowserWindow();
        },
        onPeak: (peak) => {
          meterLevels[device] = { peak, rms: peak * 0.65 };
          emitAudioMeters();
        },
        log: deps.log,
      });
      browserAudioTaps.set(device, tap);
    }
  };

  const stopWasapiLoopbacks = () => {
    while (loopbackChildren.length > 0) {
      const proc = loopbackChildren.pop();
      if (!proc) continue;
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }
  };

  const emitAudioMeters = () => {
    const now = Date.now();
    if (now - lastMeterEmit < 40) return;
    lastMeterEmit = now;
    const win = deps.getControlWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("livestream:audioMeters", { ...meterLevels });
    }
  };

  const stopWasapiMeters = () => {
    for (const proc of meterChildren.values()) {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }
    meterChildren.clear();
    for (const key of Object.keys(meterLevels)) delete meterLevels[key];
    emitAudioMeters();
  };

  const startMeterProcess = (device: string, exe: string) => {
    const proc = spawn(exe, ["--meter", audioDeviceDisplayName(device)], {
      windowsHide: true,
      cwd: path.dirname(exe),
    });
    let buf = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const peak = Number(line);
        if (!Number.isFinite(peak)) continue;
        const clamped = Math.min(1, Math.max(0, peak));
        meterLevels[device] = { peak: clamped, rms: clamped * 0.65 };
      }
      emitAudioMeters();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) deps.log(`[livestream] wasapi-meter ${audioDeviceDisplayName(device)}: ${text}`);
    });
    proc.on("exit", (code) => {
      if (meterChildren.get(device) === proc) meterChildren.delete(device);
      if (code && code !== 0) {
        deps.log(`[livestream] wasapi-meter ${audioDeviceDisplayName(device)} gestopt (${code})`);
      }
    });
    meterChildren.set(device, proc);
  };

  const syncWasapiMeters = async () => {
    const needed = settings.audioChannels
      .map((channel) => channel.device)
      .filter((device): device is string => Boolean(device) && isWasapiAudioDevice(device));
    const want = new Set(needed);
    for (const [device, proc] of meterChildren) {
      if (want.has(device)) continue;
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      meterChildren.delete(device);
      delete meterLevels[device];
    }
    const missing = needed.filter((device) => !meterChildren.has(device));
    if (missing.length === 0) {
      emitAudioMeters();
      return;
    }
    const exe = await ensureWasapiLoopbackExe(deps.userDataDir());
    if (!exe) {
      deps.log("[livestream] GoXLR-meter: NAudio-helper ontbreekt");
      return;
    }
    for (const device of missing) {
      if (meterChildren.has(device)) continue;
      startMeterProcess(device, exe);
    }
  };

  const startWasapiLoopbacks = async () => {
    syncBrowserAudioTaps();
    stopWasapiLoopbacks();
    const needed = armedAudioChannels(settings.audioChannels).filter((channel) =>
      isWasapiAudioDevice(channel.device),
    );
    if (needed.length === 0) return;
    const exe = await ensureWasapiLoopbackExe(deps.userDataDir());
    if (!exe) {
      throw new Error("GoXLR-kanalen (Game/Music/System) kunnen niet worden opgenomen");
    }
    for (const channel of needed) {
      const proc = spawn(
        exe,
        [wasapiLoopbackPipeName(channel.device), audioDeviceDisplayName(channel.device)],
        { windowsHide: true, cwd: path.dirname(exe) },
      );
      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8").trim();
        if (text) deps.log(`[livestream] wasapi ${audioDeviceDisplayName(channel.device)}: ${text}`);
      });
      loopbackChildren.push(proc);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const dead = loopbackChildren.find((proc) => proc.exitCode != null);
    if (dead) {
      throw new Error("GoXLR-kanaal kon niet worden opgenomen (Music/Game/System)");
    }
  };

  const writeMonitorGains = () => {
    if (!monitorChild?.stdin.writable) return;
    try {
      monitorChild.stdin.write(`${audioMonitorGains(settings).join(",")}\n`);
    } catch {
      /* ignore */
    }
  };

  const stopMonitor = () => {
    const proc = monitorChild;
    monitorChild = null;
    monitorKey = "";
    if (!proc) return;
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  };

  const syncMonitor = async () => {
    const key = audioMonitorProcessKey(settings);
    if (!key) {
      stopMonitor();
      return;
    }
    if (key === monitorKey && monitorChild && monitorChild.exitCode == null) {
      writeMonitorGains();
      return;
    }
    stopMonitor();
    const exe = await ensureWasapiLoopbackExe(deps.userDataDir());
    if (!exe) {
      deps.log("[livestream] monitor: helper ontbreekt");
      return;
    }
    const armed = armedAudioChannels(settings.audioChannels);
    const output = settings.audioMonitorDevice.trim() || ".";
    const proc = spawn(exe, ["--monitor", output, ...armed.map((channel) => channel.device)], {
      windowsHide: true,
      cwd: path.dirname(exe),
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) deps.log(`[livestream] monitor: ${text}`);
    });
    proc.on("exit", (code) => {
      if (monitorChild === proc) {
        monitorChild = null;
        monitorKey = "";
        if (code && code !== 0) deps.log(`[livestream] monitor gestopt (${code})`);
      }
    });
    monitorChild = proc;
    monitorKey = key;
    writeMonitorGains();
  };

  const killChild = async () => {
    stopWasapiLoopbacks();
    const proc = child;
    child = null;
    if (!proc) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      proc.once("close", () => done());
      try {
        proc.stdin.end();
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        if (!proc.killed) {
          try {
            proc.kill("SIGTERM");
          } catch {
            /* ignore */
          }
        }
      }, 800);
      setTimeout(() => {
        if (!proc.killed) {
          try {
            proc.kill();
          } catch {
            /* ignore */
          }
        }
      }, 2000);
      setTimeout(done, 4000);
    });
  };

  const spawnFfmpeg = (
    ffmpegPath: string,
    dests: string[],
    useEncoder: LivestreamEncoder,
    plan: CapturePlan,
    audioPlan: AudioPlan,
  ) => {
    const bitrate = clampBitrateKbps(settings.bitrateKbps);
    const args = [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-nostats",
      "-progress",
      "pipe:2",
      ...plan.inputArgs,
      ...audioPlan.inputArgs,
      ...(audioPlan.filterComplex ? ["-filter_complex", audioPlan.filterComplex] : []),
      "-map",
      "0:v:0",
      "-map",
      audioPlan.audioMap,
      ...plan.videoFilter,
      ...encoderArgs(useEncoder, bitrate, settings.fps),
      "-c:a",
      "aac",
      "-b:a",
      `${STREAM_AUDIO_BITRATE_K}k`,
      "-ar",
      String(STREAM_AUDIO_SAMPLE_RATE),
      "-ac",
      "2",
      ...(audioPlan.filterComplex ? [] : ["-af", "aresample=async=1:first_pts=0"]),
      ...ffmpegOutputArgs(dests),
    ];

    liveDestinations = dests;
    deps.log(
      `[livestream] start ${dests.map((url) => maskRtmpDestination(url)).join(" + ")} encoder=${useEncoder} bitrate=${bitrate} capture=${plan.label} audio=${audioPlan.label}`,
    );
    const proc = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child = proc;
    encoder = useEncoder;
    attemptStderr = "";

    const onData = (buf: Buffer) => {
      const text = buf.toString("utf8");
      attemptStderr = appendFfmpegProgressBuffer(attemptStderr, text, 16_000);
      const parsed = parseFfmpegProgressFields(text);
      if (Object.keys(parsed).length > 0) {
        health = { ...health, ...parsed, targetFps: settings.fps };
        lastProgressAt = Date.now();
        if (Date.now() - lastHealthEmit > 500) {
          lastHealthEmit = Date.now();
          emit();
        }
      }
      const line = sanitizeLogLine(stripFfmpegProgressLines(text));
      if (line) lastLogLine = line.slice(0, 240);
      if (looksLikePacketLoss(text)) {
        health = { ...health, packetLossHints: health.packetLossHints + 1 };
      }
      if (looksLikeEncoderFail(text) && useEncoder === "h264_nvenc") {
        error = "nvenc-fallback";
      }
    };
    proc.stderr.on("data", onData);
    proc.stdout.on("data", onData);
    proc.on("error", (err) => {
      error = err.message;
      attemptStderr = appendFfmpegProgressBuffer(attemptStderr, err.message, 16_000);
      deps.log(`[livestream] spawn error ${err.message}`);
      if (child === proc) child = null;
      emit();
    });
    proc.on("close", (code) => {
      const unexpected = child === proc;
      if (unexpected) child = null;
      if (!unexpected) {
        emit();
        return;
      }
      if (sessionArmed && encoding()) {
        error = lastLogLine || `Verbinding verloren (code ${code ?? "?"}) — opnieuw verbinden…`;
        deps.log(`[livestream] ffmpeg exit ${code} — reconnect`);
        emit();
        scheduleReconnect();
        return;
      }
      if (code !== 0 && code != null) {
        error = lastLogLine || `FFmpeg stopte (code ${code})`;
        deps.log(`[livestream] ffmpeg exit ${code}`);
      }
      if (!child) {
        startedAt = null;
        encoder = null;
      }
      emit();
    });
    emit();
    return proc;
  };

  const waitForHealthyOrFail = (proc: ChildProcessWithoutNullStreams, ms: number) =>
    new Promise<"ok" | "fail">((resolve) => {
      let settled = false;
      const finish = (value: "ok" | "fail") => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        proc.stderr.off("data", onData);
        proc.stdout.off("data", onData);
        resolve(value);
      };
      let acc = "";
      const onData = (buf: Buffer) => {
        acc = appendFfmpegProgressBuffer(acc, buf.toString("utf8"));
        if (ffmpegProgressHasEncodedFrame(acc)) finish("ok");
      };
      const timer = setTimeout(() => finish("fail"), ms);
      proc.stderr.on("data", onData);
      proc.stdout.on("data", onData);
      proc.once("close", () => finish("fail"));
    });

  const attachPumpIfNeeded = (session: LiveSession) => {
    if (session.programWindow && !session.programWindow.isDestroyed()) {
      pumpedPreviewInputId = settings.activeVideoInputId;
      startPump(session.programWindow, session.width, session.height, session.fps);
    }
    void syncBrowserPreview();
  };

  const restoreProgramWindow = async (session: LiveSession): Promise<LiveSession> => {
    if (session.programWindow && !session.programWindow.isDestroyed()) return session;
    const outSize = resolutionSize(settings.resolution);
    const opened = await openProgramCapture(outSize);
    if (!opened.ok) return session;
    return { ...session, programWindow: opened.programWindow };
  };

  const spawnSession = async (session: LiveSession) => {
    await startWasapiLoopbacks();
    spawnFfmpeg(session.ffmpegPath, session.dests, session.encoder, session.plan, session.audioPlan);
    const proc = child;
    if (!proc) return "fail" as const;
    attachPumpIfNeeded(session);
    return waitForHealthyOrFail(proc, HEALTH_WAIT_MS);
  };

  const scheduleReconnect = () => {
    if (!encoding() || !lastSession || reconnectTimer) return;
    const delay = Math.min(RECONNECT_MAX_DELAY_MS, 1000 * 2 ** Math.min(reconnectAttempt, 4));
    reconnectAttempt += 1;
    deps.log(`[livestream] reconnect over ${delay}ms (poging ${reconnectAttempt})`);
    error = `Verbinding verloren — opnieuw verbinden (${reconnectAttempt})…`;
    emit();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void (async () => {
        if (!encoding() || !lastSession) return;
        lastSession = await restoreProgramWindow(lastSession);
        const result = await spawnSession(lastSession);
        if (result === "ok") {
          reconnectAttempt = 0;
          error = null;
          if (!startedAt) startedAt = new Date().toISOString();
          deps.log("[livestream] reconnect geslaagd");
          emit();
          return;
        }
        deps.log("[livestream] reconnect mislukt");
        await killChild();
        scheduleReconnect();
      })();
    }, delay);
  };

  const restartLiveCapture = async () => {
    if (!encoding()) return;
    const epoch = ++captureEpoch;
    switchingSource = true;
    lastLogLine = "Beeld opnieuw starten…";
    emit();
    let startedSource = settings.source;
    let startedCamera = settings.cameraDevice;
    try {
      clearReconnect();
      await killChild();
      if (epoch !== captureEpoch || !encoding()) return;
      stopPump();
      health = { ...DEFAULT_LIVESTREAM_HEALTH, targetFps: settings.fps };
      lastProgressAt = 0;
      startedSource = settings.source;
      startedCamera = settings.cameraDevice;
      const ffmpegPath = resolveFfmpegPath(deps);
      if (!ffmpegPath) {
        error = "FFmpeg ontbreekt";
        emit();
        return;
      }
      let dests: string[];
      try {
        dests = buildEncodeDests();
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        emit();
        return;
      }
      const outSize = resolutionSize(settings.resolution);
      const audioPlans: AudioPlan[] = settings.audioEnabled
        ? [buildAudioMixPlan(settings.audioChannels, settings.audioMasterVolume), silentAudioMixPlan()]
        : [silentAudioMixPlan()];
      const opened = await openProgramCapture(outSize);
      if (!opened.ok) {
        error = opened.error;
        emit();
        return;
      }
      const programWindow = opened.programWindow;
      const plans = opened.plans;
      const preferred = encoder ?? lastSession?.encoder ?? "libx264";
      const encoders: LivestreamEncoder[] =
        settings.encoder === "auto"
          ? preferred === "h264_nvenc"
            ? ["h264_nvenc", "libx264"]
            : ["libx264", "h264_nvenc"]
          : [settings.encoder];
      let ok = false;
      outer: for (const plan of plans) {
        if (!encoding()) break;
        for (const audioPlan of audioPlans) {
          if (!encoding()) break;
          for (const useEncoder of encoders) {
            if (!encoding()) break;
            const session: LiveSession = {
              ffmpegPath,
              dests,
              encoder: useEncoder,
              plan,
              audioPlan,
              programWindow,
              width: plan.pipeWidth,
              height: plan.pipeHeight,
              fps: settings.fps,
            };
            lastLogLine = `Bronwissel: ${plan.label} / ${useEncoder}`;
            emit();
            const result = await spawnSession(session);
            if (epoch !== captureEpoch) return;
            if (result === "ok") {
              lastSession = session;
              sessionArmed = true;
              reconnectAttempt = 0;
              error = null;
              ok = true;
              break outer;
            }
            await killChild();
          }
        }
      }
      if (!ok) {
        error = lastLogLine || "Bronwissel mislukt — opnieuw verbinden…";
        emit();
        scheduleReconnect();
        return;
      }
      deps.log("[livestream] bron gewisseld");
      emit();
    } finally {
      if (epoch === captureEpoch) switchingSource = false;
    }
    if (
      encoding() &&
      (settings.source !== startedSource || settings.cameraDevice !== startedCamera)
    ) {
      void restartLiveCapture();
    }
  };

  const applyLiveGains = async (next: LivestreamSettings) => {
    if (!encoding() || !ffmpegAlive()) return;
    for (const cmd of audioGainCommands(next)) {
      try {
        await sendZmqReq("127.0.0.1", LIVESTREAM_AZMQ_PORT, `${cmd.target} volume ${cmd.gain.toFixed(4)}`);
      } catch {
        deps.log(`[livestream] live-volume ${cmd.target} niet gezet`);
      }
    }
  };

  void syncWasapiMeters();
  void syncMonitor();
  void syncBrowserPreview();
  syncBrowserAudioTaps();

  return {
    getSettings: () => ({ ...settings }),
    saveSettings: (partial) => {
      const prev = settings;
      settings = mergeLivestreamSettings({ ...settings, ...partial });
      writeSettings(settingsPath(deps.userDataDir()), settings);
      const sourceChanged =
        prev.source !== settings.source ||
        prev.cameraDevice !== settings.cameraDevice ||
        resolveActiveVideoInput(prev).browserUrl !== resolveActiveVideoInput(settings).browserUrl ||
        resolveActiveVideoInput(prev).mediaPath !== resolveActiveVideoInput(settings).mediaPath ||
        resolveActiveVideoInput(prev).mediaLoop !== resolveActiveVideoInput(settings).mediaLoop ||
        videoInputPreviewKey(resolvePreviewVideoInput(prev)) !==
          videoInputPreviewKey(resolvePreviewVideoInput(settings));
      if (
        streamOverlayChanged(prev, settings) ||
        sourceChanged ||
        prev.activeVideoInputId !== settings.activeVideoInputId ||
        prev.previewVideoInputId !== settings.previewVideoInputId ||
        JSON.stringify(prev.streamDeckSlots) !== JSON.stringify(settings.streamDeckSlots)
      ) {
        emitSettings();
      }
      const devicesChanged = audioDeviceFingerprint(prev) !== audioDeviceFingerprint(settings);
      const gainsChanged =
        JSON.stringify(audioGainCommands(prev)) !== JSON.stringify(audioGainCommands(settings));
      if (devicesChanged) void syncWasapiMeters();
      const monitorChanged =
        audioMonitorProcessKey(prev) !== audioMonitorProcessKey(settings) ||
        JSON.stringify(audioMonitorGains(prev)) !== JSON.stringify(audioMonitorGains(settings));
      if (monitorChanged) void syncMonitor();
      if (encoding() && (sourceChanged || devicesChanged) && !switchingSource) {
        void restartLiveCapture();
      } else if (encoding() && gainsChanged) {
        void applyLiveGains(settings);
      } else if (!encoding()) {
        void syncBrowserPreview();
      }
      syncBrowserAudioTaps();
      return settings;
    },
    notifyProgramReady,
    listCameras: async () => {
      const ffmpegPath = resolveFfmpegPath(deps);
      if (!ffmpegPath) return [];
      return listDshowVideoDevices(ffmpegPath);
    },
    listAudioDevices: async () => {
      const ffmpegPath = resolveFfmpegPath(deps, cachedFfmpegPath == null);
      const [dshow, windows] = await Promise.all([
        ffmpegPath ? listDshowDevices(ffmpegPath).then((d) => d.audio).catch(() => []) : Promise.resolve([]),
        listWindowsCaptureEndpoints().catch(() => []),
      ]);
      return mergeLivestreamAudioDevices(dshow, windows, sourceAudioDevices(settings.videoInputs));
    },
    listAudioOutputs: async () => {
      const exe = await ensureWasapiLoopbackExe(deps.userDataDir());
      if (!exe) return [];
      return new Promise((resolve) => {
        execFile(exe, ["--list"], { windowsHide: true, cwd: path.dirname(exe) }, (err, stdout) => {
          if (err) {
            resolve([]);
            return;
          }
          resolve(
            stdout
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((name) => name.length > 0 && name.length <= 200)
              .map((name) => ({ name })),
          );
        });
      });
    },
    getStatus,
    start: async () => {
      if (userWantsLive && child) return getStatus();
      userWantsLive = true;
      if (child) {
        await restartLiveCapture();
        return getStatus();
      }
      const ffmpegPath = resolveFfmpegPath(deps, cachedFfmpegPath == null);
      if (!ffmpegPath) {
        userWantsLive = false;
        error = "FFmpeg ontbreekt. Run npm run livestream:ensure-ffmpeg";
        emit();
        return getStatus();
      }
      let dests: string[];
      try {
        dests = buildEncodeDests();
      } catch (e) {
        userWantsLive = false;
        error = e instanceof Error ? e.message : String(e);
        emit();
        return getStatus();
      }

      error = null;
      browserPreviewGen += 1;
      health = { ...DEFAULT_LIVESTREAM_HEALTH, targetFps: settings.fps };
      lastProgressAt = 0;
      const plans: CapturePlan[] = [];
      const audioPlans: AudioPlan[] = [];
      if (settings.audioEnabled) {
        const armed = armedAudioChannels(settings.audioChannels);
        if (armed.length === 0) {
          userWantsLive = false;
          error = "Kies minstens één audio-bron";
          emit();
          return getStatus();
        }
        audioPlans.push(buildAudioMixPlan(settings.audioChannels, settings.audioMasterVolume), silentAudioMixPlan());
      } else {
        audioPlans.push(silentAudioMixPlan());
      }

      const outSize = resolutionSize(settings.resolution);
      const opened = await openProgramCapture(outSize);
      if (!opened.ok) {
        userWantsLive = false;
        error = opened.error;
        emit();
        return getStatus();
      }
      const programWindow = opened.programWindow;
      plans.push(...opened.plans);

      if (!encoding()) return getStatus();

      const encoders: LivestreamEncoder[] =
        settings.encoder === "auto" ? ["h264_nvenc", "libx264"] : [settings.encoder];
      outer: for (const plan of plans) {
        if (!encoding()) break outer;
        for (const audioPlan of audioPlans) {
          if (!encoding()) break outer;
          for (const useEncoder of encoders) {
            if (!encoding()) break outer;
            const session: LiveSession = {
              ffmpegPath,
              dests,
              encoder: useEncoder,
              plan,
              audioPlan,
              programWindow,
              width: plan.pipeWidth,
              height: plan.pipeHeight,
              fps: settings.fps,
            };
            lastLogLine = `Startpoging: ${plan.label} / ${audioPlan.label} / ${useEncoder}`;
            emit();
            const result = await spawnSession(session);
            if (result === "ok") {
              lastSession = session;
              sessionArmed = true;
              reconnectAttempt = 0;
              error = null;
              if (!startedAt) startedAt = new Date().toISOString();
              break outer;
            }
            const failText = attemptStderr || lastLogLine || "";
            deps.log(`[livestream] poging mislukt (${plan.label}/${audioPlan.label}/${useEncoder}) — volgende`);
            await killChild();
            if (looksLikeDestinationFail(failText)) {
              deps.log("[livestream] bestemming onbereikbaar — stop fallback");
              break outer;
            }
            if (looksLikeNonEncoderFail(failText)) {
              deps.log("[livestream] audio/input-fout — volgende bron (of stil), rest encoders overgeslagen");
              break;
            }
          }
        }
      }
      if (!child) {
        userWantsLive = false;
        if (!userWantsRecord) {
          sessionArmed = false;
          lastSession = null;
        }
        error = lastLogLine || "FFmpeg kon de stream niet starten";
        emit();
      }
      return getStatus();
    },
    startRecord: async () => {
      if (userWantsRecord && child) return getStatus();
      recordFile = newRecordFile();
      userWantsRecord = true;
      error = null;
      deps.log(`[livestream] opname ${recordFile}`);
      emit();
      await restartLiveCapture();
      if (userWantsRecord && !child) {
        userWantsRecord = false;
        recordFile = null;
        if (!userWantsLive) {
          sessionArmed = false;
          lastSession = null;
        }
        error = lastLogLine || "Opname starten mislukt";
        emit();
      }
      return getStatus();
    },
    stopRecord: async () => {
      captureEpoch += 1;
      userWantsRecord = false;
      const finished = recordFile;
      recordFile = null;
      error = null;
      emit();
      if (userWantsLive) {
        switchingSource = false;
        await restartLiveCapture();
        deps.log(`[livestream] opname gestopt ${finished ?? ""}`);
        return getStatus();
      }
      sessionArmed = false;
      lastSession = null;
      clearReconnect();
      stopPump();
      programIsReady = false;
      switchingSource = false;
      await killChild();
      void syncBrowserPreview();
      startedAt = null;
      encoder = null;
      liveDestinations = [];
      deps.log(`[livestream] opname gestopt ${finished ?? ""}`);
      emit();
      return getStatus();
    },
    stop: async () => {
      userWantsLive = false;
      if (userWantsRecord && child) {
        await restartLiveCapture();
        deps.log("[livestream] stream gestopt, opname loopt door");
        return getStatus();
      }
      sessionArmed = false;
      lastSession = null;
      clearReconnect();
      stopPump();
      programIsReady = false;
      await killChild();
      deps.log("[livestream] gestopt");
      void syncBrowserPreview();
      startedAt = null;
      encoder = null;
      liveDestinations = [];
      error = null;
      lastLogLine = null;
      health = { ...DEFAULT_LIVESTREAM_HEALTH };
      lastProgressAt = 0;
      emit();
      return getStatus();
    },
  };
}
