/** Chromium/Electron speelt dit betrouwbaar af op een stadion-pc. */
const CHROME_SAFE_CODECS = new Set(["h264", "avc1", "vp8", "vp9", "av1"]);

/** Al omgezet in `uploads/compat`. Alleen de huidige profiel-suffix is klaar; oudere kopieën mogen opnieuw. */
export const STADIUM_COMPAT_PATH = /[\\/]compat[\\/]/;

/**
 * Huidige stadion-kopie: Baseline, geen B-frames, korte GOP.
 * Oude `compat/*.mp4` zonder deze suffix hapert nog (wachten midden in de clip).
 */
export const STADIUM_COMPAT_PROFILE = "fd1";

export function isCurrentStadiumCompatPath(filePath: string | null | undefined): boolean {
  if (!filePath || !STADIUM_COMPAT_PATH.test(filePath)) return false;
  return new RegExp(`-${STADIUM_COMPAT_PROFILE}\\.mp4$`, "i").test(filePath);
}

export type VideoProbeInfo = {
  codec: string;
  profile: string | null;
  pixFmt: string | null;
  width: number;
  height: number;
  fps: number;
  durationSec: number | null;
  encoder?: string | null;
  handlerName?: string | null;
  interlaced?: boolean;
};

export type StadiumTranscodeReason =
  | "ok"
  | "unsupported_codec"
  | "pixel_format"
  | "high_fps"
  | "unsafe_encoder"
  | "playback_fault"
  | "probe_failed"
  | "ffmpeg_missing";

/**
 * HTML-video-events waarbij de clip op het stadionscherm vastloopt of niet start.
 * Dan forceren we een H.264-kopie, ook als de probe “ok” zei.
 */
const HANG_EVENTS = new Set([
  "watchdog_stuck_t0",
  "watchdog_never_playing",
  "watchdog_no_metadata_4s",
  "ended_never_started_fault",
  "error",
  "watchdog_dropped_frames",
]);

export function isStadiumPlaybackHangEvent(event: string | null | undefined): boolean {
  return typeof event === "string" && HANG_EVENTS.has(event);
}

/**
 * Leest de eerste videostream uit `ffmpeg -i` / `ffprobe` stderr/stdout.
 * Voorbeeld: `Video: h264 (High) (avc1 / 0x31637661), yuv420p(...), 1920x1080, 60 fps`
 */
export function parseFfmpegInputProbe(text: string): VideoProbeInfo | null {
  const line = text.split(/\r?\n/).find((row) => /Stream #.*Video:/.test(row));
  if (!line) return null;
  const codecMatch = line.match(/Video:\s+([A-Za-z0-9_]+)/);
  if (!codecMatch?.[1]) return null;
  const codec = codecMatch[1].toLowerCase();
  const profileMatch = line.match(/Video:\s+[A-Za-z0-9_]+\s+\(([^)]+)\)/);
  let profile = profileMatch?.[1]?.trim() ?? null;
  if (profile && /avc1|hev1|hvc1|vp09|0x/i.test(profile)) {
    profile = null;
  }
  const pixMatch = line.match(/,\s*(yuv[\w]+)/i);
  const dimMatch = line.match(/\b(\d{2,5})x(\d{2,5})\b/);
  const fpsMatch = line.match(/,\s*(\d+(?:\.\d+)?)\s*fps\b/)
    ?? line.match(/,\s*(\d+(?:\.\d+)?)\s*tbr\b/);
  const durationMatch = text.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
  let durationSec: number | null = null;
  if (durationMatch) {
    durationSec =
      Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
    if (!Number.isFinite(durationSec) || durationSec <= 0) durationSec = null;
  }
  const encoderMatch = text.match(/^\s+encoder\s*:\s*(.+)$/im);
  const handlerMatch = text.match(/handler_name\s*:\s*(.+)/i);
  return {
    codec,
    profile,
    pixFmt: pixMatch?.[1]?.toLowerCase() ?? null,
    width: dimMatch ? Number(dimMatch[1]) : 0,
    height: dimMatch ? Number(dimMatch[2]) : 0,
    fps: fpsMatch ? Number(fpsMatch[1]) : 0,
    durationSec,
    encoder: encoderMatch?.[1]?.trim() || null,
    handlerName: handlerMatch?.[1]?.trim() || null,
    interlaced: /interlaced|top first|bottom first|\bmbaff\b/i.test(line),
  };
}

/**
 * Sponsors leveren clips uit After Effects, Premiere, Media Encoder, Avid, …
 * Chromium hapert op die hardware-encoders, ook als het “gewoon H.264 Main 30” lijkt.
 */
function isUnsafeStadiumEncoder(info: VideoProbeInfo): boolean {
  if (/libx264|\blavc|libvpx|libaom/i.test(info.encoder ?? "")) return false;
  const blob = `${info.encoder ?? ""} ${info.handlerName ?? ""}`;
  if (/mainconcept|adobe media encoder|\bavid\b|core media video/i.test(blob)) return true;
  if (/^avc coding$/i.test((info.encoder ?? "").trim())) return true;
  return false;
}

export function stadiumTranscodeReason(info: VideoProbeInfo): StadiumTranscodeReason {
  if (!CHROME_SAFE_CODECS.has(info.codec)) return "unsupported_codec";
  const pix = info.pixFmt ?? "";
  if (pix && !/^yuvj?420p$/.test(pix)) return "pixel_format";
  const prof = (info.profile ?? "").toLowerCase();
  if (prof.includes("10") || prof.includes("4:2:2") || prof.includes("4:4:4")) {
    return "pixel_format";
  }
  if (info.interlaced) return "unsafe_encoder";
  if (isUnsafeStadiumEncoder(info)) return "unsafe_encoder";
  /**
   * 50/60 fps is prima in Main — Chromium hangt op High-profile / Mainconcept, niet op
   * de framerate zelf. Alleen High+hoge fps moet naar Main.
   */
  if (info.fps > 30.5 && prof.includes("high")) return "high_fps";
  return "ok";
}

export function needsStadiumTranscode(info: VideoProbeInfo): boolean {
  return stadiumTranscodeReason(info) !== "ok";
}

export function isDisplayPlaybackRisk(reason: StadiumTranscodeReason | string | null | undefined): boolean {
  return (
    reason === "unsupported_codec" ||
    reason === "pixel_format" ||
    reason === "high_fps" ||
    reason === "unsafe_encoder" ||
    reason === "playback_fault" ||
    reason === "ffmpeg_missing"
  );
}
