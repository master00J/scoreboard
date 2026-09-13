import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  parseFfmpegInputProbe,
  stadiumTranscodeReason,
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
};

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
  return path.join(compatDir(), `${base || "clip"}-${hash}.mp4`);
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
  if (!src || !fs.existsSync(src)) {
    return { reason: "probe_failed" };
  }
  if (/[\\/]compat[\\/]/.test(src)) {
    return { reason: "ok" };
  }
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) return { reason: "ffmpeg_missing" };
  const info = await probeWithFfmpeg(ffmpeg, src);
  if (!info) return { reason: "probe_failed" };
  return {
    reason: stadiumTranscodeReason(info),
    fps: info.fps || undefined,
    codec: info.codec,
    profile: info.profile ?? undefined,
    durationSec: info.durationSec ?? undefined,
  };
}

export async function prepareVideoForDisplay(src: string): Promise<MediaPrepareResult> {
  const inspected = await inspectVideoForDisplay(src);
  if (inspected.reason === "ok" || inspected.reason === "ffmpeg_missing" || inspected.reason === "probe_failed") {
    return { ...inspected, path: src, transcoded: false };
  }

  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) return { ...inspected, path: src, transcoded: false, reason: "ffmpeg_missing" };

  const dest = destPathFor(src);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) {
    return { ...inspected, path: dest, transcoded: true };
  }

  /** Zelfde resolutie en fps; alleen Chromium-vriendelijk Main-profiel. Geen 60→30. */
  const args = [
    "-y",
    "-hide_banner",
    "-i",
    src,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-profile:v",
    "main",
    "-level",
    "4.2",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "medium",
    "-crf",
    "16",
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
    dest,
  ];

  try {
    await execFileAsync(ffmpeg, args, { timeout: 180_000, windowsHide: true });
  } catch {
    try {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
    return { ...inspected, path: src, transcoded: false };
  }
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 1024) {
    return { ...inspected, path: src, transcoded: false };
  }
  return { ...inspected, path: dest, transcoded: true };
}
