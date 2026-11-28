import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { needsDisplayCopy, type DisplayCopyHeight } from "../lib/display-copy";
import { resolveStoredMediaPath } from "../lib/media-file-path";
import {
  classifyDecodeRun,
  decodeTimeoutMs,
  isAnimatedWebp,
  isValidTranscodeOutput,
  mediaFileVersionKey,
  type DecodeRun,
  type MediaCheckRecord,
  type MediaKind,
} from "../lib/media-health";
import {
  isCurrentStadiumCompatPath,
  isDisplayPlaybackRisk,
  parseFfmpegInputProbe,
  stadiumTranscodeReason,
  STADIUM_COMPAT_PROFILE,
  type StadiumTranscodeReason,
} from "../lib/media-playback-compat";

const execFileAsync = promisify(execFile);

export type MediaInspectResult = {
  reason: StadiumTranscodeReason;
  fps?: number;
  codec?: string;
  profile?: string;
  durationSec?: number;
};

export type MediaPrepareResult = MediaInspectResult & {
  path: string;
  transcoded: boolean;
  /** Volledige decode van de omgezette kopie; alleen als `transcoded`. */
  check?: MediaCheckRecord;
  /** De omzetting liep, maar de kopie decodeerde niet volledig: het origineel blijft staan. */
  validationFailed?: string;
};

/**
 * Het bestand achter een opgeslagen pad, zoals het scherm het afspeelt: "/uploads/…" ligt in de
 * uploads-map (ook na het terugzetten van een back-up), al het andere is een volledig pad.
 */
export function resolveMediaFile(stored: string | null | undefined): string | null {
  return resolveStoredMediaPath(stored, process.env.STADIUM_UPLOADS_DIR ?? null);
}

function resolveFfmpegPath(): string | null {
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const appRoot = process.env.STADIUM_APP_ROOT?.trim();
  const candidates = [
    process.env.STADIUM_FFMPEG_PATH,
    process.resourcesPath ? path.join(process.resourcesPath, "ffmpeg", exe) : null,
    appRoot ? path.join(appRoot, "vendor", "ffmpeg", exe) : null,
    path.join(process.cwd(), "vendor", "ffmpeg", exe),
  ].filter((p): p is string => Boolean(p));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return process.platform === "win32" ? null : "ffmpeg";
}

function compatDir(): string {
  const uploads = process.env.STADIUM_UPLOADS_DIR?.trim();
  const root = uploads && fs.existsSync(uploads) ? uploads : path.join(process.cwd(), "uploads");
  const dir = path.join(root, "compat");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function destPathFor(src: string): string {
  const st = fs.statSync(src);
  const hash = createHash("sha1")
    .update(path.resolve(src))
    .update(String(st.size))
    .update(String(Math.floor(st.mtimeMs)))
    .digest("hex")
    .slice(0, 10);
  const base = path
    .basename(src, path.extname(src))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return path.join(compatDir(), `${base || "clip"}-${hash}-${STADIUM_COMPAT_PROFILE}.mp4`);
}

async function probeWithFfmpeg(ffmpeg: string, src: string) {
  try {
    await execFileAsync(ffmpeg, ["-hide_banner", "-i", src], {
      timeout: 20_000,
      windowsHide: true,
    });
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string };
    return parseFfmpegInputProbe(`${e.stderr ?? ""}\n${e.stdout ?? ""}`);
  }
  return null;
}

export async function inspectVideoForDisplay(src: string): Promise<MediaInspectResult> {
  const file = resolveMediaFile(src);
  if (!file || !fs.existsSync(file)) {
    return { reason: "probe_failed" };
  }
  if (isCurrentStadiumCompatPath(src)) {
    return { reason: "ok" };
  }
  if (/[\\/]compat[\\/]/i.test(src)) {
    /** Oude compat-kopie (B-frames, lange GOP) — opnieuw omzetten. */
    return { reason: "playback_fault" };
  }
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) return { reason: "ffmpeg_missing" };
  const info = await probeWithFfmpeg(ffmpeg, file);
  if (!info) return { reason: "probe_failed" };
  return {
    reason: stadiumTranscodeReason(info),
    fps: info.fps || undefined,
    codec: info.codec,
    profile: info.profile ?? undefined,
    durationSec: info.durationSec ?? undefined,
  };
}

export async function prepareVideoForDisplay(
  src: string,
  opts?: { force?: boolean },
): Promise<MediaPrepareResult> {
  if (isCurrentStadiumCompatPath(src)) {
    return { reason: "ok", path: src, transcoded: false };
  }
  const inspected = await inspectVideoForDisplay(src);
  if (inspected.reason === "ffmpeg_missing" || inspected.reason === "probe_failed") {
    return { ...inspected, path: src, transcoded: false };
  }
  if (!opts?.force && inspected.reason === "ok") {
    return { ...inspected, path: src, transcoded: false };
  }
  if (!opts?.force && !isDisplayPlaybackRisk(inspected.reason)) {
    return { ...inspected, path: src, transcoded: false };
  }
  if (opts?.force && inspected.reason === "ok") {
    inspected.reason = "playback_fault";
  }

  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) return { ...inspected, path: src, transcoded: false, reason: "ffmpeg_missing" };

  const file = resolveMediaFile(src);
  if (!file) return { ...inspected, path: src, transcoded: false, reason: "probe_failed" };
  const dest = destPathFor(file);
  const expectedSec = inspected.durationSec ?? null;

  // Een kopie van een eerdere omzetting telt alleen als ze volledig decodeert: een afgebroken
  // omzetting of een half gekopieerd bestand mag nooit als "klaar" op het scherm komen.
  if (fs.existsSync(dest)) {
    const check = await decodeCheckFile(dest, "VIDEO", expectedSec);
    if (check && isValidTranscodeOutput(check)) {
      return { ...inspected, path: dest, transcoded: true, check: checkRecordFor(dest, check) };
    }
    removeQuietly(dest);
  }

  const tmp = `${dest.replace(/\.mp4$/i, "")}.partial`;
  /**
   * Zelfde resolutie en fps. Baseline + geen B-frames + GOP 1s: Chromium blijft
   * anders `waiting` geven midden in een ogenschijnlijk “gewone” libx264-Main-clip.
   */
  const args = stadiumEncodeArgs(file, tmp);

  // FFmpeg schrijft naar een tijdelijk bestand. Pas na een volledige, foutloze decode krijgt het
  // de echte naam; een omzetting die halverwege stopt, laat zo nooit een bruikbaar ogende kopie na.
  removeQuietly(tmp);
  try {
    await execFileAsync(ffmpeg, args, { timeout: 180_000, windowsHide: true });
  } catch {
    removeQuietly(tmp);
    return { ...inspected, path: src, transcoded: false };
  }
  const check = fs.existsSync(tmp) ? await decodeCheckFile(tmp, "VIDEO", expectedSec) : null;
  if (!check || !isValidTranscodeOutput(check)) {
    removeQuietly(tmp);
    return {
      ...inspected,
      path: src,
      transcoded: false,
      validationFailed: check?.reason ?? "unreadable",
    };
  }
  try {
    fs.renameSync(tmp, dest);
  } catch {
    removeQuietly(tmp);
    return { ...inspected, path: src, transcoded: false };
  }
  return { ...inspected, path: dest, transcoded: true, check: checkRecordFor(dest, check) };
}

/**
 * FFmpeg-argumenten voor een kopie die het stadionscherm vlot afspeelt: zelfde fps, baseline H.264 zonder
 * B-frames en een GOP van 1 s. Met `scaleHeight` wordt het beeld verkleind tot die hoogte (lanczos).
 */
function stadiumEncodeArgs(input: string, output: string, scaleHeight?: number): string[] {
  return [
    "-y",
    "-hide_banner",
    "-i",
    input,
    "-map_metadata",
    "-1",
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    ...(scaleHeight ? ["-vf", `scale=-2:${scaleHeight}:flags=lanczos`] : []),
    "-fps_mode",
    "cfr",
    "-c:v",
    "libx264",
    "-profile:v",
    "baseline",
    "-level",
    "4.0",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-tune",
    "fastdecode",
    "-crf",
    "18",
    "-g",
    "30",
    "-keyint_min",
    "30",
    "-sc_threshold",
    "0",
    "-bf",
    "0",
    "-refs",
    "1",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    output,
  ];
}

function displayCopyDir(height: number): string {
  const uploads = process.env.STADIUM_UPLOADS_DIR?.trim();
  const root = uploads && fs.existsSync(uploads) ? uploads : path.join(process.cwd(), "uploads");
  const dir = path.join(root, `display-${height}p`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export type DisplayCopyResult =
  | { kind: "copy"; path: string; sourceKey: string }
  | { kind: "not_needed"; sourceKey: string }
  | { kind: "failed"; reason: string };

/** FFmpeg op lagere prioriteit, zodat het stadionscherm op dezelfde pc voorgaat. */
function runFfmpegLowPriority(ffmpeg: string, args: string[], timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    try {
      if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      /* geen rechten: dan op normale prioriteit */
    }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

/**
 * Maakt een kopie van een video op `height` lijnen voor het stadionscherm (lib/display-copy.ts). Een origineel
 * dat niet hoger is, krijgt geen kopie (`not_needed`). De kopie wordt volledig gedecodeerd voor ze telt;
 * één zware FFmpeg-taak tegelijk, op lagere prioriteit.
 */
export async function makeDisplayCopy(stored: string, height: DisplayCopyHeight): Promise<DisplayCopyResult> {
  const version = mediaFileVersion(stored);
  if (!version.exists || !version.file || !version.key) return { kind: "failed", reason: "missing_file" };
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) return { kind: "failed", reason: "ffmpeg_missing" };
  const info = await probeWithFfmpeg(ffmpeg, version.file);
  if (!info || !info.height) return { kind: "failed", reason: "probe_failed" };
  if (!needsDisplayCopy(info.height, height)) return { kind: "not_needed", sourceKey: version.key };

  const hash = createHash("sha1").update(version.key).digest("hex").slice(0, 12);
  const base = path
    .basename(version.file, path.extname(version.file))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const dest = path.join(displayCopyDir(height), `${base || "clip"}-${hash}-${height}p.mp4`);
  const expectedSec = info.durationSec ?? null;
  const sourceKey = version.key;
  const source = version.file;

  return runSerialized(async () => {
    // Binnen deze taak rechtstreeks decoderen: `decodeCheckFile` zou op deze zelfde rij wachten.
    const decodes = async (file: string) =>
      isValidTranscodeOutput(
        classifyDecodeRun({ kind: "VIDEO", expectedSec, run: await runFfmpegDecode(ffmpeg, file, decodeTimeoutMs("VIDEO", expectedSec)) }),
      );
    if (fs.existsSync(dest)) {
      if (await decodes(dest)) return { kind: "copy", path: dest, sourceKey } as const;
      removeQuietly(dest);
    }
    const tmp = `${dest.replace(/\.mp4$/i, "")}.partial`;
    removeQuietly(tmp);
    const ok = await runFfmpegLowPriority(ffmpeg, stadiumEncodeArgs(source, tmp, height), 15 * 60_000);
    if (!ok || !fs.existsSync(tmp)) {
      removeQuietly(tmp);
      return { kind: "failed", reason: "encode_failed" } as const;
    }
    if (!(await decodes(tmp))) {
      removeQuietly(tmp);
      return { kind: "failed", reason: "copy_not_decodable" } as const;
    }
    try {
      fs.renameSync(tmp, dest);
    } catch {
      removeQuietly(tmp);
      return { kind: "failed", reason: "rename_failed" } as const;
    }
    return { kind: "copy", path: dest, sourceKey } as const;
  });
}

function removeQuietly(file: string) {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
}

type DecodeResult = Omit<MediaCheckRecord, "v" | "key" | "checkedAt">;

function checkRecordFor(file: string, result: DecodeResult): MediaCheckRecord | undefined {
  try {
    const st = fs.statSync(file);
    return {
      v: 1,
      key: mediaFileVersionKey(file, st.size, st.mtimeMs),
      ...result,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

/** Eén decode tegelijk: de controle mag het stadionscherm op dezelfde pc niet laten haperen. */
let decodeChain: Promise<unknown> = Promise.resolve();

function runSerialized<T>(task: () => Promise<T>): Promise<T> {
  const next = decodeChain.then(task, task);
  decodeChain = next.catch(() => undefined);
  return next;
}

/** Bewaar niet meer stderr dan nodig: een kapot bestand kan duizenden foutregels geven. */
const MAX_STDERR = 64 * 1024;

function runFfmpegDecode(ffmpeg: string, file: string, timeoutMs: number): Promise<DecodeRun> {
  return new Promise((resolve) => {
    const args = [
      "-hide_banner",
      "-nostdin",
      "-nostats",
      "-v",
      "error",
      "-threads",
      "2",
      "-i",
      file,
      "-map",
      "0:v:0",
      "-f",
      "null",
      "-progress",
      "pipe:1",
      "-",
    ];
    let progress = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    try {
      if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      /* geen rechten: dan op normale prioriteit */
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      // Alleen het einde is nodig: de laatste frame=- en out_time_us=-regels.
      progress = (progress + chunk.toString("utf8")).slice(-8192);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR) stderr += chunk.toString("utf8");
    });
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, timedOut, progress, stderr });
    };
    child.on("error", () => finish(-1));
    child.on("close", (code) => finish(code));
  });
}

function readHead(file: string, bytes: number): Uint8Array {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Decodeert elk beeld van het bestand met de meegeleverde FFmpeg. Null als FFmpeg ontbreekt.
 * Een bewegende WebP slaat FFmpeg over: die kan hij niet lezen, Chromium wel.
 */
export async function decodeCheckFile(
  file: string,
  kind: MediaKind,
  expectedSec: number | null,
): Promise<DecodeResult | null> {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) return null;
  if (kind === "IMAGE" && /\.webp$/i.test(file)) {
    try {
      if (isAnimatedWebp(readHead(file, 32))) {
        return { status: "warning", reason: "not_decodable_here", expectedSec: null, decodedSec: null, detail: null };
      }
    } catch {
      /* lezen mislukt: de decode hieronder meldt het */
    }
  }
  const run = await runSerialized(() => runFfmpegDecode(ffmpeg, file, decodeTimeoutMs(kind, expectedSec)));
  return classifyDecodeRun({ kind, expectedSec, run });
}

export type MediaFileVersion = {
  /** Het echte bestand, of null als het opgeslagen pad nergens naartoe wijst. */
  file: string | null;
  exists: boolean;
  /** Sleutel van de huidige bestandsversie; null als het bestand ontbreekt. */
  key: string | null;
};

/** Waar staat het bestand en welke versie is het: om te zien of een bewaarde controle nog geldt. */
export function mediaFileVersion(stored: string | null | undefined): MediaFileVersion {
  const file = resolveMediaFile(stored);
  if (!file) return { file: null, exists: false, key: null };
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return { file, exists: false, key: null };
    return { file, exists: true, key: mediaFileVersionKey(file, st.size, st.mtimeMs) };
  } catch {
    return { file, exists: false, key: null };
  }
}

/**
 * Volledige controle van een mediabestand. Hergebruikt `previous` als die bij dezelfde
 * bestandsversie hoort; dan wordt er niets gedecodeerd.
 */
export async function checkMediaFile(
  stored: string,
  kind: MediaKind,
  opts: { fallbackDurationSec?: number | null; previous?: MediaCheckRecord | null } = {},
): Promise<{ version: MediaFileVersion; record: MediaCheckRecord | null; ffmpegMissing: boolean }> {
  const version = mediaFileVersion(stored);
  if (!version.exists || !version.file || !version.key) {
    return { version, record: null, ffmpegMissing: false };
  }
  if (opts.previous && opts.previous.key === version.key) {
    return { version, record: opts.previous, ffmpegMissing: false };
  }
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) return { version, record: null, ffmpegMissing: true };
  let expectedSec: number | null = null;
  if (kind === "VIDEO") {
    const info = await probeWithFfmpeg(ffmpeg, version.file);
    expectedSec = info?.durationSec ?? null;
    if (expectedSec == null && opts.fallbackDurationSec && opts.fallbackDurationSec > 0) {
      expectedSec = opts.fallbackDurationSec;
    }
  }
  const result = await decodeCheckFile(version.file, kind, expectedSec);
  if (!result) return { version, record: null, ffmpegMissing: true };
  return {
    version,
    record: { v: 1, key: version.key, ...result, checkedAt: new Date().toISOString() },
    ffmpegMissing: false,
  };
}
