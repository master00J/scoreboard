/** Chromium/Electron speelt dit betrouwbaar af op een stadion-pc. */
const CHROME_SAFE_CODECS = new Set(["h264", "avc1", "vp8", "vp9", "av1"]);

export type VideoProbeInfo = {
  codec: string;
  profile: string | null;
  pixFmt: string | null;
  width: number;
  height: number;
  fps: number;
  durationSec: number | null;
};

export type StadiumTranscodeReason =
  | "ok"
  | "unsupported_codec"
  | "pixel_format"
  | "high_fps"
  | "probe_failed"
  | "ffmpeg_missing";

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
  return {
    codec,
    profile,
    pixFmt: pixMatch?.[1]?.toLowerCase() ?? null,
    width: dimMatch ? Number(dimMatch[1]) : 0,
    height: dimMatch ? Number(dimMatch[2]) : 0,
    fps: fpsMatch ? Number(fpsMatch[1]) : 0,
    durationSec,
  };
}

export function stadiumTranscodeReason(info: VideoProbeInfo): StadiumTranscodeReason {
  if (!CHROME_SAFE_CODECS.has(info.codec)) return "unsupported_codec";
  const pix = info.pixFmt ?? "";
  if (pix && !/^yuvj?420p$/.test(pix)) return "pixel_format";
  const prof = (info.profile ?? "").toLowerCase();
  if (prof.includes("10") || prof.includes("4:2:2") || prof.includes("4:4:4")) {
    return "pixel_format";
  }
  /**
   * 50/60 fps is prima — Chromium hangt op High-profile / Mainconcept, niet op de
   * framerate zelf. Main @ 60 blijft dus staan; alleen High+hoge fps moet naar Main.
   */
  if (info.fps > 30.5 && prof.includes("high")) return "high_fps";
  return "ok";
}

export function needsStadiumTranscode(info: VideoProbeInfo): boolean {
  return stadiumTranscodeReason(info) !== "ok";
}

export function isDisplayPlaybackRisk(reason: StadiumTranscodeReason | string | null | undefined): boolean {
  return reason === "unsupported_codec" || reason === "pixel_format" || reason === "high_fps";
}
