import {
  audioDeviceDisplayName,
  type LivestreamAudioChannel,
  type LivestreamAudioFollowAction,
  type LivestreamVideoInput,
} from "./livestream";

/**
 * Samenvattingen voor de studio-UI.
 *
 * De audio-follow-tabel groeide met elk kanaal: negen dropdowns per bron die
 * bijna allemaal "ongewijzigd" zeggen. Eén regel tekst vertelt hetzelfde, en de
 * tabel zit achter een uitklapper.
 */

export type AudioFollowSummary = {
  /** Kanalen die aangaan als deze bron program wordt. */
  unmute: string[];
  /** Kanalen die uitgaan als deze bron program wordt. */
  mute: string[];
  /** True als er niets is ingesteld. */
  empty: boolean;
};

/** Alleen kanalen met een gekozen apparaat zijn zinvol om te tonen. */
export function armedFollowChannels(
  channels: LivestreamAudioChannel[],
): LivestreamAudioChannel[] {
  return channels.filter((channel) => channel.device.trim().length > 0);
}

export function channelLabel(
  channel: LivestreamAudioChannel,
  index: number,
  fallback: (n: number) => string,
): string {
  const name = audioDeviceDisplayName(channel.device).trim();
  return name || fallback(index + 1);
}

export function summarizeAudioFollow(
  input: Pick<LivestreamVideoInput, "audioFollow">,
  channels: LivestreamAudioChannel[],
  fallback: (n: number) => string,
): AudioFollowSummary {
  const unmute: string[] = [];
  const mute: string[] = [];
  channels.forEach((channel, index) => {
    const action: LivestreamAudioFollowAction = input.audioFollow[channel.id] ?? "leave";
    if (action === "unmute") unmute.push(channelLabel(channel, index, fallback));
    if (action === "mute") mute.push(channelLabel(channel, index, fallback));
  });
  return { unmute, mute, empty: unmute.length === 0 && mute.length === 0 };
}

/** Korte naam voor een bron, met terugval op het type. */
export function videoInputLabel(
  input: Pick<LivestreamVideoInput, "name" | "kind">,
  labels: { camera: string; display: string; browser?: string; media?: string },
): string {
  if (input.name.trim()) return input.name.trim();
  if (input.kind === "display") return labels.display;
  if (input.kind === "browser") return labels.browser ?? "Browser";
  if (input.kind === "media") return labels.media ?? "Media";
  return labels.camera;
}

/** `1080p · 30 fps · 8000 kbps · NVENC` voor de encoder-kop. */
export function encoderSummary(settings: {
  resolution: string;
  fps: number;
  bitrateKbps: number;
  encoder: string;
}): string {
  const res = settings.resolution === "1280x720" ? "720p" : "1080p";
  const enc =
    settings.encoder === "h264_nvenc" ? "NVENC" : settings.encoder === "libx264" ? "x264" : "auto";
  return `${res} · ${settings.fps} fps · ${settings.bitrateKbps} kbps · ${enc}`;
}
