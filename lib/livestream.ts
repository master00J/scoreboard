import {
  DEFAULT_STREAM_SCORE_WIDGET,
  mergeScoreWidgetDesigns,
  mergeStreamScoreWidget,
  type StreamScoreWidgetDesign,
  type StreamScoreWidgetSettings,
} from "./stream-score-widget";
import { defaultStreamDeckSlots, mergeStreamDeckSlots, type StreamDeckSlot } from "./stream-deck";

export type { StreamScoreWidgetDesign, StreamScoreWidgetSettings };
export { mergeStreamScoreWidget, sixteenByNineScaleFilter } from "./stream-score-widget";

export type LivestreamPlatform = "youtube" | "twitch" | "custom";

export type LivestreamSource = "camera" | "display" | "browser" | "media";

export type LivestreamEncoder = "h264_nvenc" | "libx264";

export type LivestreamEncoderPref = "auto" | LivestreamEncoder;

export type LivestreamResolution = "1920x1080" | "1280x720";

export type LivestreamScorePosition = "top" | "bottom";

export type LivestreamSponsorStyle = "logos" | "lowerthird" | "break";

export type LivestreamSponsorScope = "all" | "phase";

export type LivestreamSponsorPosition = "auto" | "top" | "bottom";

export type LivestreamLayoutMode = "auto" | "manual";

export type LivestreamCameraDevice = {
  name: string;
};

export type LivestreamAudioDevice = {
  name: string;
};

/** Weergave-kanaal (GoXLR Game/Music/…) dat we via WASAPI-loopback opnemen. */
export const WASAPI_DEVICE_PREFIX = "wasapi:";
/** Audio van een browserbron (`browser:<videoInputId>`). */
export const BROWSER_AUDIO_PREFIX = "browser:";
/** Audio van een lokale mediabron (`media:<videoInputId>`). */
export const MEDIA_AUDIO_PREFIX = "media:";

export function isWasapiAudioDevice(device: string): boolean {
  return device.startsWith(WASAPI_DEVICE_PREFIX);
}

export function isBrowserAudioDevice(device: string): boolean {
  return device.startsWith(BROWSER_AUDIO_PREFIX);
}

export function isMediaAudioDevice(device: string): boolean {
  return device.startsWith(MEDIA_AUDIO_PREFIX);
}

export function isSourceAudioDevice(device: string): boolean {
  return isBrowserAudioDevice(device) || isMediaAudioDevice(device);
}

export function isPipeAudioDevice(device: string): boolean {
  return isWasapiAudioDevice(device) || isSourceAudioDevice(device);
}

export function browserAudioDeviceId(inputId: string): string {
  return `${BROWSER_AUDIO_PREFIX}${inputId}`;
}

export function browserAudioInputId(device: string): string {
  return isBrowserAudioDevice(device) ? device.slice(BROWSER_AUDIO_PREFIX.length) : "";
}

export function mediaAudioDeviceId(inputId: string): string {
  return `${MEDIA_AUDIO_PREFIX}${inputId}`;
}

export function mediaAudioInputId(device: string): string {
  return isMediaAudioDevice(device) ? device.slice(MEDIA_AUDIO_PREFIX.length) : "";
}

export function audioDeviceDisplayName(device: string): string {
  if (isWasapiAudioDevice(device)) return device.slice(WASAPI_DEVICE_PREFIX.length);
  if (isBrowserAudioDevice(device)) return device.slice(BROWSER_AUDIO_PREFIX.length);
  if (isMediaAudioDevice(device)) return device.slice(MEDIA_AUDIO_PREFIX.length);
  return device;
}

export type LivestreamAudioMeterMap = Record<string, { peak: number; rms: number }>;

export function wasapiLoopbackPipeName(device: string): string {
  const name = isSourceAudioDevice(device) ? device : audioDeviceDisplayName(device);
  let hash = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `\\\\.\\pipe\\acwasapi${(hash >>> 0).toString(16)}`;
}

export type LivestreamAudioChannel = {
  id: string;
  device: string;
  volume: number;
  muted: boolean;
};

/** Wat er met een audiokanaal gebeurt als deze beeldbron program wordt. */
export type LivestreamAudioFollowAction = "leave" | "mute" | "unmute";

export type LivestreamVideoInput = {
  id: string;
  name: string;
  kind: LivestreamSource;
  cameraDevice: string;
  /** Alleen `kind === "browser"`: http(s)-pagina zoals een OBS browser source. */
  browserUrl: string;
  /** Alleen `kind === "media"`: lokaal pad of `/uploads/…`. */
  mediaPath: string;
  mediaLoop: boolean;
  audioFollow: Record<string, LivestreamAudioFollowAction>;
};

export function audioDeviceLabel(
  device: string,
  inputs: LivestreamVideoInput[],
  fallback: string,
): string {
  if (isBrowserAudioDevice(device) || isMediaAudioDevice(device)) {
    const id = isMediaAudioDevice(device) ? mediaAudioInputId(device) : browserAudioInputId(device);
    const input = inputs.find((item) => item.id === id);
    const name = input?.name.trim();
    return name || fallback;
  }
  return audioDeviceDisplayName(device);
}

export function browserAudioDevices(inputs: LivestreamVideoInput[]): LivestreamAudioDevice[] {
  return inputs
    .filter((input) => input.kind === "browser")
    .map((input) => ({ name: browserAudioDeviceId(input.id) }));
}

export function mediaAudioDevices(inputs: LivestreamVideoInput[]): LivestreamAudioDevice[] {
  return inputs
    .filter((input) => input.kind === "media")
    .map((input) => ({ name: mediaAudioDeviceId(input.id) }));
}

export function sourceAudioDevices(inputs: LivestreamVideoInput[]): LivestreamAudioDevice[] {
  return [...browserAudioDevices(inputs), ...mediaAudioDevices(inputs)];
}

export function mediaPathFileName(filePath: string): string {
  return filePath.replace(/^.*[/\\]/, "").trim().slice(0, 40);
}

export const DEFAULT_AUDIO_VOLUME = 100;
export const DEFAULT_AUDIO_CHANNEL: LivestreamAudioChannel = {
  id: "a1",
  device: "",
  volume: DEFAULT_AUDIO_VOLUME,
  muted: false,
};

/** Score + sponsors per streamfase (wedstrijd of pauze). */
export type StreamLayerLayout = {
  score: boolean;
  scorePosition: LivestreamScorePosition;
  sponsors: boolean;
  sponsorStyle: LivestreamSponsorStyle;
  sponsorScope: LivestreamSponsorScope;
  sponsorPosition: LivestreamSponsorPosition;
};

export type LivestreamSettings = {
  platform: LivestreamPlatform;
  source: LivestreamSource;
  cameraDevice: string;
  videoInputs: LivestreamVideoInput[];
  activeVideoInputId: string;
  previewVideoInputId: string;
  overlay: boolean;
  layoutMode: LivestreamLayoutMode;
  manualPhaseSplit: boolean;
  manualLayout: StreamLayerLayout;
  manualPlayLayout: StreamLayerLayout;
  manualBreakLayout: StreamLayerLayout;
  scorePosition: LivestreamScorePosition;
  sponsors: boolean;
  sponsorStyle: LivestreamSponsorStyle;
  sponsorScope: LivestreamSponsorScope;
  sponsorPosition: LivestreamSponsorPosition;
  customUrl: string;
  streamKey: string;
  dualEnabled: boolean;
  platform2: LivestreamPlatform;
  customUrl2: string;
  streamKey2: string;
  bitrateKbps: number;
  encoder: LivestreamEncoderPref;
  resolution: LivestreamResolution;
  fps: number;
  audioEnabled: boolean;
  audioDevice: string;
  audioMasterVolume: number;
  audioChannels: LivestreamAudioChannel[];
  /** Weergave-apparaat voor koptelefoon-PFL (leeg = Windows-standaard). */
  audioMonitorDevice: string;
  /** Kanaal-id's + `master` die je beluistert. */
  audioMonitorCueIds: string[];
  scoreWidget: StreamScoreWidgetSettings;
  scoreWidgetDesigns: StreamScoreWidgetDesign[];
  /** Studio-monitor in de control-app. Uit = minder CPU/GPU. */
  studioPreview: boolean;
  /** Eigen Stream Deck-knoppen (volgorde = F13… en /key/1…). */
  streamDeckSlots: StreamDeckSlot[];
  /** Map voor opnames. Leeg = Videos/ArenaCue. */
  recordDir: string;
};

export type LivestreamHealth = {
  fps: number | null;
  targetFps: number;
  bitrateKbps: number | null;
  dropFrames: number;
  dupFrames: number;
  paintDrops: number;
  speed: number | null;
  frames: number;
  stale: boolean;
  packetLossHints: number;
};

export const DEFAULT_LIVESTREAM_HEALTH: LivestreamHealth = {
  fps: null,
  targetFps: 30,
  bitrateKbps: null,
  dropFrames: 0,
  dupFrames: 0,
  paintDrops: 0,
  speed: null,
  frames: 0,
  stale: false,
  packetLossHints: 0,
};

export type LivestreamStatus = {
  running: boolean;
  recording: boolean;
  recordPath: string | null;
  /** FFmpeg is weg, supervisor probeert opnieuw. Badge moet amber, niet LIVE. */
  reconnecting: boolean;
  platform: LivestreamPlatform | null;
  destinations: string[];
  startedAt: string | null;
  encoder: LivestreamEncoder | null;
  error: string | null;
  lastLogLine: string | null;
  ffmpegFound: boolean;
  health: LivestreamHealth;
};

export const DEFAULT_LIVESTREAM_STATUS: LivestreamStatus = {
  running: false,
  recording: false,
  recordPath: null,
  reconnecting: false,
  platform: null,
  destinations: [],
  startedAt: null,
  encoder: null,
  error: null,
  lastLogLine: null,
  ffmpegFound: false,
  health: { ...DEFAULT_LIVESTREAM_HEALTH },
};

export const YOUTUBE_RTMP_BASE = "rtmp://a.rtmp.youtube.com/live2";
export const TWITCH_RTMP_BASE = "rtmp://live.twitch.tv/app";

export const DEFAULT_STREAM_PLAY_LAYOUT: StreamLayerLayout = {
  score: true,
  scorePosition: "bottom",
  sponsors: false,
  sponsorStyle: "logos",
  sponsorScope: "phase",
  sponsorPosition: "auto",
};

export const DEFAULT_STREAM_BREAK_LAYOUT: StreamLayerLayout = {
  score: false,
  scorePosition: "bottom",
  sponsors: true,
  sponsorStyle: "break",
  sponsorScope: "phase",
  sponsorPosition: "auto",
};

export const DEFAULT_STREAM_MANUAL_LAYOUT: StreamLayerLayout = {
  score: true,
  scorePosition: "bottom",
  sponsors: true,
  sponsorStyle: "logos",
  sponsorScope: "all",
  sponsorPosition: "auto",
};

export const DEFAULT_LIVESTREAM_SETTINGS: LivestreamSettings = {
  platform: "youtube",
  source: "camera",
  cameraDevice: "",
  videoInputs: [
    {
      id: "v1",
      name: "Camera 1",
      kind: "camera",
      cameraDevice: "",
      browserUrl: "",
      mediaPath: "",
      mediaLoop: true,
      audioFollow: {},
    },
    {
      id: "v-led",
      name: "LED",
      kind: "display",
      cameraDevice: "",
      browserUrl: "",
      mediaPath: "",
      mediaLoop: true,
      audioFollow: {},
    },
  ],
  activeVideoInputId: "v1",
  previewVideoInputId: "v-led",
  overlay: true,
  layoutMode: "auto",
  manualPhaseSplit: false,
  manualLayout: DEFAULT_STREAM_MANUAL_LAYOUT,
  manualPlayLayout: DEFAULT_STREAM_PLAY_LAYOUT,
  manualBreakLayout: DEFAULT_STREAM_BREAK_LAYOUT,
  scorePosition: "bottom",
  sponsors: true,
  sponsorStyle: "logos",
  sponsorScope: "all",
  sponsorPosition: "auto",
  customUrl: "",
  streamKey: "",
  dualEnabled: false,
  platform2: "youtube",
  customUrl2: "",
  streamKey2: "",
  bitrateKbps: 6000,
  encoder: "auto",
  resolution: "1920x1080",
  fps: 30,
  audioEnabled: true,
  audioDevice: "",
  audioMasterVolume: DEFAULT_AUDIO_VOLUME,
  audioChannels: [{ ...DEFAULT_AUDIO_CHANNEL }],
  audioMonitorDevice: "",
  audioMonitorCueIds: [],
  scoreWidget: DEFAULT_STREAM_SCORE_WIDGET,
  scoreWidgetDesigns: [],
  studioPreview: true,
  streamDeckSlots: defaultStreamDeckSlots(),
  recordDir: "",
};

export function clampFps(value: number): number {
  if (value >= 50) return 60;
  if (value >= 24) return 30;
  return 15;
}

export function parseResolution(value: string | undefined): LivestreamResolution {
  return value === "1280x720" ? "1280x720" : "1920x1080";
}

export function resolutionSize(value: LivestreamResolution): { width: number; height: number } {
  return value === "1280x720" ? { width: 1280, height: 720 } : { width: 1920, height: 1080 };
}

export function parseEncoderPref(value: unknown): LivestreamEncoderPref {
  if (value === "h264_nvenc" || value === "libx264" || value === "auto") return value;
  return "auto";
}

export function parsePlatform(value: unknown): LivestreamPlatform {
  if (value === "twitch" || value === "custom" || value === "youtube") return value;
  return "youtube";
}

export function parseScorePosition(value: unknown): LivestreamScorePosition {
  return value === "top" ? "top" : "bottom";
}

export function parseSponsorStyle(value: unknown): LivestreamSponsorStyle {
  if (value === "lowerthird" || value === "break") return value;
  return "logos";
}

export function parseSponsorScope(value: unknown): LivestreamSponsorScope {
  return value === "phase" ? "phase" : "all";
}

export function parseSponsorPosition(value: unknown): LivestreamSponsorPosition {
  if (value === "top" || value === "bottom") return value;
  return "auto";
}

export function parseLayoutMode(value: unknown): LivestreamLayoutMode {
  return value === "manual" ? "manual" : "auto";
}

function mergeStreamLayerLayout(
  raw: Partial<StreamLayerLayout> | null | undefined,
  fallback: StreamLayerLayout,
): StreamLayerLayout {
  const r = raw ?? {};
  return {
    score: typeof r.score === "boolean" ? r.score : fallback.score,
    scorePosition: parseScorePosition(r.scorePosition ?? fallback.scorePosition),
    sponsors: typeof r.sponsors === "boolean" ? r.sponsors : fallback.sponsors,
    sponsorStyle: parseSponsorStyle(r.sponsorStyle ?? fallback.sponsorStyle),
    sponsorScope: parseSponsorScope(r.sponsorScope ?? fallback.sponsorScope),
    sponsorPosition: parseSponsorPosition(r.sponsorPosition ?? fallback.sponsorPosition),
  };
}

export function parseAudioFollowAction(value: unknown): LivestreamAudioFollowAction {
  if (value === "mute" || value === "unmute" || value === "leave") return value;
  return "leave";
}

export function parseLivestreamSource(value: unknown): LivestreamSource {
  if (value === "display" || value === "browser" || value === "media" || value === "camera") return value;
  return "camera";
}

export const MEDIA_FILE_EXTENSIONS = ["mp4", "webm", "mov", "avi", "mkv", "m4v", "jpg", "jpeg", "png", "gif", "webp"] as const;

const MEDIA_PATH_RE = /\.(mp4|webm|mov|avi|mkv|m4v|jpg|jpeg|png|gif|webp)$/i;

/** Lokaal pad of `/uploads/…`. Geen http/javascript. */
/** Lokale map voor opnames. Leeg = app-standaard. */
export function sanitizeRecordDir(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 500 || /[\0\r\n]/.test(trimmed)) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !/^[a-zA-Z]:[\\/]/.test(trimmed)) return "";
  return trimmed;
}

export function sanitizeMediaPath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 1000 || /[\r\n"]/.test(trimmed)) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !/^[a-zA-Z]:[\\/]/.test(trimmed)) return "";
  if (!MEDIA_PATH_RE.test(trimmed)) return "";
  return trimmed;
}

export function isVideoMediaPath(filePath: string): boolean {
  return /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(filePath);
}

/** Alleen http(s). Host zonder schema wordt `https://`. */
export function sanitizeBrowserUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2000) return "";
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

export function createVideoInput(partial?: Partial<LivestreamVideoInput>): LivestreamVideoInput {
  const id =
    typeof partial?.id === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(partial.id)
      ? partial.id
      : `v${Math.random().toString(36).slice(2, 10)}`;
  const audioFollow: Record<string, LivestreamAudioFollowAction> = {};
  if (partial?.audioFollow && typeof partial.audioFollow === "object") {
    for (const [key, action] of Object.entries(partial.audioFollow)) {
      if (!/^[A-Za-z0-9_-]{1,24}$/.test(key)) continue;
      audioFollow[key] = parseAudioFollowAction(action);
    }
  }
  const name = typeof partial?.name === "string" ? partial.name.trim().slice(0, 40) : "";
  return {
    id,
    name,
    kind: parseLivestreamSource(partial?.kind),
    cameraDevice: typeof partial?.cameraDevice === "string" ? partial.cameraDevice : "",
    browserUrl: sanitizeBrowserUrl(partial?.browserUrl),
    mediaPath: sanitizeMediaPath(partial?.mediaPath),
    mediaLoop: partial?.mediaLoop !== false,
    audioFollow,
  };
}

export function applyAudioFollowToChannels(
  channels: LivestreamAudioChannel[],
  follow: Record<string, LivestreamAudioFollowAction> | undefined,
): LivestreamAudioChannel[] {
  if (!follow) return channels;
  return channels.map((channel) => {
    const action = follow[channel.id];
    if (action === "mute") return { ...channel, muted: true };
    if (action === "unmute") return { ...channel, muted: false };
    return channel;
  });
}

export function mergeVideoInputs(
  raw: unknown,
  fallbackCamera: string,
): LivestreamVideoInput[] {
  if (Array.isArray(raw) && raw.length > 0) {
    const seen = new Set<string>();
    const out: LivestreamVideoInput[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const input = createVideoInput(item as Partial<LivestreamVideoInput>);
      if (seen.has(input.id)) input.id = createVideoInput().id;
      seen.add(input.id);
      out.push(input);
      if (out.length >= 8) break;
    }
    if (out.length > 0) return out;
  }
  return [
    createVideoInput({
      id: "v1",
      name: "Camera 1",
      kind: "camera",
      cameraDevice: fallbackCamera,
    }),
    createVideoInput({
      id: "v-led",
      name: "LED",
      kind: "display",
    }),
  ];
}

export function resolveActiveVideoInput(settings: Pick<LivestreamSettings, "videoInputs" | "activeVideoInputId">): LivestreamVideoInput {
  return (
    settings.videoInputs.find((input) => input.id === settings.activeVideoInputId) ??
    settings.videoInputs[0] ??
    createVideoInput({ id: "v1", name: "Camera 1", kind: "camera" })
  );
}

export function resolvePreviewVideoInput(
  settings: Pick<LivestreamSettings, "videoInputs" | "activeVideoInputId" | "previewVideoInputId">,
): LivestreamVideoInput | null {
  return (
    settings.videoInputs.find((input) => input.id === settings.previewVideoInputId) ??
    settings.videoInputs.find((input) => input.id !== settings.activeVideoInputId) ??
    null
  );
}

export function videoInputPreviewKey(input: LivestreamVideoInput | null | undefined): string {
  if (!input) return "";
  return `${input.id}:${input.kind}:${input.browserUrl}:${input.mediaPath}:${input.mediaLoop ? 1 : 0}`;
}

export function applyVideoInputSelection(
  settings: LivestreamSettings,
  inputId: string,
): Partial<LivestreamSettings> {
  const input =
    settings.videoInputs.find((item) => item.id === inputId) ?? settings.videoInputs[0];
  if (!input) return {};
  return {
    activeVideoInputId: input.id,
    source: input.kind,
    cameraDevice: input.kind === "camera" ? input.cameraDevice : settings.cameraDevice,
    audioChannels: applyAudioFollowToChannels(settings.audioChannels, input.audioFollow),
  };
}

export function mergeLivestreamSettings(raw: Partial<LivestreamSettings> | null | undefined): LivestreamSettings {
  const d = DEFAULT_LIVESTREAM_SETTINGS;
  const r = raw ?? {};
  const legacyLayout = mergeStreamLayerLayout(
    {
      score: typeof r.overlay === "boolean" ? r.overlay : undefined,
      scorePosition: r.scorePosition,
      sponsors: typeof r.sponsors === "boolean" ? r.sponsors : undefined,
      sponsorStyle: r.sponsorStyle,
      sponsorScope: r.sponsorScope,
      sponsorPosition: r.sponsorPosition,
    },
    DEFAULT_STREAM_MANUAL_LAYOUT,
  );
  const manualLayout = mergeStreamLayerLayout(r.manualLayout, legacyLayout);
  const manualPlayLayout = mergeStreamLayerLayout(r.manualPlayLayout, DEFAULT_STREAM_PLAY_LAYOUT);
  const manualBreakLayout = mergeStreamLayerLayout(r.manualBreakLayout, DEFAULT_STREAM_BREAK_LAYOUT);
  const manualPhaseSplit = typeof r.manualPhaseSplit === "boolean" ? r.manualPhaseSplit : d.manualPhaseSplit;
  const flat = manualPhaseSplit ? legacyLayout : manualLayout;
  const audioChannels = mergeAudioChannels(
    r.audioChannels,
    typeof r.audioDevice === "string" ? r.audioDevice : d.audioDevice,
  );
  const legacySource = parseLivestreamSource(r.source ?? d.source);
  const legacyCamera = typeof r.cameraDevice === "string" ? r.cameraDevice : d.cameraDevice;
  const videoInputs = mergeVideoInputs(r.videoInputs, legacyCamera);
  const requestedActive =
    typeof r.activeVideoInputId === "string" ? r.activeVideoInputId : "";
  const activeFromLegacy =
    legacySource === "display"
      ? videoInputs.find((input) => input.kind === "display")?.id
      : legacySource === "browser"
        ? videoInputs.find((input) => input.kind === "browser")?.id
        : legacySource === "media"
          ? videoInputs.find((input) => input.kind === "media")?.id
          : videoInputs.find((input) => input.kind === "camera")?.id;
  const activeVideoInput =
    videoInputs.find((input) => input.id === requestedActive) ??
    videoInputs.find((input) => input.id === activeFromLegacy) ??
    videoInputs[0]!;
  const synced = syncBrowserAudioChannels(videoInputs, audioChannels, activeVideoInput.id);

  return {
    platform: parsePlatform(r.platform ?? d.platform),
    source: activeVideoInput.kind,
    cameraDevice:
      activeVideoInput.kind === "camera" ? activeVideoInput.cameraDevice : legacyCamera,
    videoInputs: synced.videoInputs,
    activeVideoInputId: activeVideoInput.id,
    previewVideoInputId:
      videoInputs.find((input) => input.id === (typeof r.previewVideoInputId === "string" ? r.previewVideoInputId : ""))
        ?.id ??
      videoInputs.find((input) => input.id !== activeVideoInput.id)?.id ??
      "",
    overlay: flat.score,
    layoutMode: parseLayoutMode(r.layoutMode ?? d.layoutMode),
    manualPhaseSplit,
    manualLayout,
    manualPlayLayout,
    manualBreakLayout,
    scorePosition: flat.scorePosition,
    sponsors: flat.sponsors,
    sponsorStyle: flat.sponsorStyle,
    sponsorScope: flat.sponsorScope,
    sponsorPosition: flat.sponsorPosition,
    customUrl: typeof r.customUrl === "string" ? r.customUrl : d.customUrl,
    streamKey: typeof r.streamKey === "string" ? sanitizeStreamKey(r.streamKey) : d.streamKey,
    dualEnabled: typeof r.dualEnabled === "boolean" ? r.dualEnabled : d.dualEnabled,
    platform2: parsePlatform(r.platform2 ?? d.platform2),
    customUrl2: typeof r.customUrl2 === "string" ? r.customUrl2 : d.customUrl2,
    streamKey2: typeof r.streamKey2 === "string" ? sanitizeStreamKey(r.streamKey2) : d.streamKey2,
    bitrateKbps: clampBitrateKbps(Number(r.bitrateKbps) || d.bitrateKbps),
    encoder: parseEncoderPref(r.encoder ?? d.encoder),
    resolution: parseResolution(typeof r.resolution === "string" ? r.resolution : d.resolution),
    fps: clampFps(Number(r.fps) || d.fps),
    audioEnabled: typeof r.audioEnabled === "boolean" ? r.audioEnabled : d.audioEnabled,
    audioDevice: synced.audioChannels[0]?.device ?? "",
    audioMasterVolume: clampAudioVolume(r.audioMasterVolume ?? d.audioMasterVolume),
    audioChannels: synced.audioChannels,
    audioMonitorDevice:
      typeof r.audioMonitorDevice === "string" && isSafeDshowDeviceName(r.audioMonitorDevice)
        ? r.audioMonitorDevice.trim()
        : d.audioMonitorDevice,
    audioMonitorCueIds: mergeAudioMonitorCueIds(r.audioMonitorCueIds),
    scoreWidget: mergeStreamScoreWidget(r.scoreWidget),
    scoreWidgetDesigns: mergeScoreWidgetDesigns(r.scoreWidgetDesigns),
    studioPreview: typeof r.studioPreview === "boolean" ? r.studioPreview : d.studioPreview,
    streamDeckSlots: Array.isArray(r.streamDeckSlots) ? mergeStreamDeckSlots(r.streamDeckSlots) : d.streamDeckSlots,
    recordDir: sanitizeRecordDir(r.recordDir ?? d.recordDir),
  };
}

export function escapeTeeUrl(url: string): string {
  return url.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/\|/g, "\\|");
}

export function isSafeDshowDeviceName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 200) return false;
  return !/["\r\n]/.test(trimmed);
}

function pushUniqueDevice<T extends { name: string }>(list: T[], name: string, extra: Omit<T, "name">): void {
  if (!isSafeDshowDeviceName(name)) return;
  if (list.some((item) => item.name === name)) return;
  list.push({ name, ...extra } as T);
}

export function mergeLivestreamAudioDevices(...lists: LivestreamAudioDevice[][]): LivestreamAudioDevice[] {
  const seen = new Set<string>();
  const out: LivestreamAudioDevice[] = [];
  for (const list of lists) {
    for (const device of list) {
      const name = device.name.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name });
    }
  }
  return sortLivestreamAudioDevices(out);
}

/** GoXLR/RodeCaster-mixen eerst, daarna overige mics. */
export function sortLivestreamAudioDevices(devices: LivestreamAudioDevice[]): LivestreamAudioDevice[] {
  const rank = (name: string) => {
    const n = name.toLowerCase();
    if (/broadcast stream mix|main stereo|stream mix/.test(n)) return 0;
    if (/goxlr|rodecaster|rode caster|tc-helicon/.test(n)) return 1;
    if (/hdmi|elgato|hd60|capture/.test(n)) return 2;
    return 3;
  };
  return [...devices].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** Parseert `ffmpeg -f dshow -list_devices true` (stderr). */
export function parseDshowVideoDevices(text: string): LivestreamCameraDevice[] {
  const names: LivestreamCameraDevice[] = [];
  let inVideo = false;
  for (const line of text.split(/\r?\n/)) {
    if (/DirectShow video devices/i.test(line)) {
      inVideo = true;
      continue;
    }
    if (/DirectShow audio devices/i.test(line)) {
      inVideo = false;
      continue;
    }
    if (/Alternative name/i.test(line)) continue;
    const tagged = line.match(/"([^"]+)"\s*\(video\)/i);
    if (tagged?.[1]) {
      pushUniqueDevice(names, tagged[1], {});
      continue;
    }
    if (!inVideo) continue;
    const match = line.match(/"([^"]+)"/);
    if (match?.[1]) pushUniqueDevice(names, match[1], {});
  }
  return names;
}

/** Parseert audio-apparaten uit dezelfde ffmpeg dshow-lijst. */
export function parseDshowAudioDevices(text: string): LivestreamAudioDevice[] {
  const names: LivestreamAudioDevice[] = [];
  let inAudio = false;
  for (const line of text.split(/\r?\n/)) {
    if (/DirectShow audio devices/i.test(line)) {
      inAudio = true;
      continue;
    }
    if (/DirectShow video devices/i.test(line)) {
      inAudio = false;
      continue;
    }
    if (/Alternative name/i.test(line)) continue;
    const tagged = line.match(/"([^"]+)"\s*\(audio\)/i);
    if (tagged?.[1]) {
      pushUniqueDevice(names, tagged[1], {});
      continue;
    }
    if (!inAudio) continue;
    const match = line.match(/"([^"]+)"/);
    if (match?.[1]) pushUniqueDevice(names, match[1], {});
  }
  return names;
}

/** YouTube/Twitch: 48 kHz stereo AAC. */
export const STREAM_AUDIO_SAMPLE_RATE = 48000;
export const STREAM_AUDIO_BITRATE_K = 160;
/** dshow USB-audio: 80–100 ms is stabieler dan 50 ms. */
export const DSHOW_AUDIO_BUFFER_MS = 80;

/** Eerste encoded frame in `-progress pipe:2` of `frame=`-stats. */
export function ffmpegProgressHasEncodedFrame(chunk: string): boolean {
  return /(?:^|\n|\r)frame=\s*[1-9]\d*/.test(chunk);
}

function parseProgressNumber(raw: string): number | null {
  const n = Number.parseFloat(raw.replace(/[^\d.+-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Leest fps, drops en bitrate uit `-progress pipe:2`. */
export function parseFfmpegProgressFields(chunk: string): Partial<LivestreamHealth> {
  const next: Partial<LivestreamHealth> = {};
  for (const line of chunk.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === "frame") {
      const n = parseProgressNumber(value);
      if (n != null) next.frames = Math.max(0, Math.round(n));
    } else if (key === "fps") {
      const n = parseProgressNumber(value);
      if (n != null) next.fps = n;
    } else if (key === "bitrate") {
      const n = parseProgressNumber(value);
      if (n != null) next.bitrateKbps = /mbit/i.test(value) ? n * 1000 : n;
    } else if (key === "drop_frames") {
      const n = parseProgressNumber(value);
      if (n != null) next.dropFrames = Math.max(0, Math.round(n));
    } else if (key === "dup_frames") {
      const n = parseProgressNumber(value);
      if (n != null) next.dupFrames = Math.max(0, Math.round(n));
    } else if (key === "speed") {
      const n = parseProgressNumber(value);
      if (n != null) next.speed = n;
    }
  }
  return next;
}

export function looksLikePacketLoss(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    (lower.includes("packet") && (lower.includes("loss") || lower.includes("corrupt") || lower.includes("too large"))) ||
    lower.includes("connection reset") ||
    lower.includes("broken pipe") ||
    lower.includes("error number -10054") ||
    lower.includes("error number -10053") ||
    lower.includes("failed to update header") ||
    (lower.includes("rtmp") && (lower.includes("i/o error") || lower.includes("end of file")))
  );
}

/** Haalt `-progress`-regels weg zodat echte warnings in lastLogLine blijven. */
export function stripFfmpegProgressLines(chunk: string): string {
  return chunk
    .replace(
      /^(?:frame|fps|stream_\S+|bitrate|total_size|out_time(?:_us|_ms)?|dup_frames|drop_frames|speed|progress)=.*$/gm,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Voorkomt dat `frame=` over chunk-grenzen wordt gemist. */
export function appendFfmpegProgressBuffer(prev: string, chunk: string, max = 8000): string {
  const next = prev + chunk;
  return next.length > max ? next.slice(-Math.floor(max / 2)) : next;
}

export function looksLikeEncoderFail(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("nvenc") ||
    lower.includes("cannot load") ||
    lower.includes("no capable devices") ||
    lower.includes("function not implemented")
  );
}

export function looksLikeDestinationFail(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("connection refused") ||
    lower.includes("cannot open connection") ||
    lower.includes("error number -10053") ||
    lower.includes("error number -10054") ||
    lower.includes("server returned 4") ||
    lower.includes("failed to connect") ||
    /error opening output .+rtmp/i.test(text)
  );
}

/** Input/apparaat-fout: andere encoder helpt niet, volgende audio-bron (of stil) wel. */
export function looksLikeNonEncoderFail(text: string): boolean {
  if (looksLikeEncoderFail(text) || looksLikeDestinationFail(text)) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes("error opening input") ||
    lower.includes("no such device") ||
    lower.includes("i/o error") ||
    lower.includes("failed to open") ||
    lower.includes("could not find") ||
    lower.includes("not found")
  );
}

/** FFmpeg dshow audio-input voor Windows (microfoon / capture-kaart). */
export function dshowAudioInputArgs(deviceName: string): string[] {
  if (!isSafeDshowDeviceName(deviceName)) {
    throw new Error("Ongeldig audio-apparaat");
  }
  return [
    "-f",
    "dshow",
    "-rtbufsize",
    "7020000",
    "-audio_buffer_size",
    String(DSHOW_AUDIO_BUFFER_MS),
    "-i",
    `audio=${deviceName}`,
  ];
}

export function wasapiLoopbackInputArgs(deviceName: string): string[] {
  const display = audioDeviceDisplayName(deviceName);
  if (!isSafeDshowDeviceName(display)) {
    throw new Error("Ongeldig audio-apparaat");
  }
  return [
    "-f",
    "s16le",
    "-ar",
    String(STREAM_AUDIO_SAMPLE_RATE),
    "-ac",
    "2",
    "-i",
    wasapiLoopbackPipeName(deviceName),
  ];
}

export function audioInputArgs(deviceName: string): string[] {
  return isPipeAudioDevice(deviceName)
    ? wasapiLoopbackInputArgs(deviceName)
    : dshowAudioInputArgs(deviceName);
}

export function silentAudioInputArgs(): string[] {
  return [
    "-f",
    "lavfi",
    "-i",
    `anullsrc=channel_layout=stereo:sample_rate=${STREAM_AUDIO_SAMPLE_RATE}`,
  ];
}

/** Koppelt capture-kaart audio aan cameranaam waar mogelijk. */
export function guessDshowAudioForCameraLabel(
  cameraLabel: string,
  audioDevices: LivestreamAudioDevice[],
): string | null {
  const label = cameraLabel.trim().toLowerCase();
  if (!label) return null;
  const exact = audioDevices.find((d) => d.name.toLowerCase() === label);
  if (exact) return exact.name;
  const partial = audioDevices.find((d) => {
    const n = d.name.toLowerCase();
    return n.includes(label) || label.includes(n);
  });
  return partial?.name ?? null;
}

export function sanitizeStreamKey(raw: string): string {
  return raw.trim();
}

export function isSafeStreamKey(key: string): boolean {
  if (!key) return false;
  if (key.length > 256) return false;
  return /^[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=\-]+$/.test(key);
}

export function isSafeRtmpUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "rtmp:" || parsed.protocol === "rtmps:";
  } catch {
    return false;
  }
}

export function buildRtmpDestinationFor(
  platform: LivestreamPlatform,
  streamKey: string,
  customUrl: string,
): string {
  const key = sanitizeStreamKey(streamKey);
  if (platform !== "custom" && !isSafeStreamKey(key)) {
    throw new Error("Ongeldige streamkey");
  }

  if (platform === "youtube") {
    return `${YOUTUBE_RTMP_BASE}/${key}`;
  }
  if (platform === "twitch") {
    return `${TWITCH_RTMP_BASE}/${key}`;
  }

  const base = customUrl.trim().replace(/\/+$/, "");
  if (!isSafeRtmpUrl(base)) {
    throw new Error("Ongeldige RTMP-URL (gebruik rtmp:// of rtmps://)");
  }
  if (key && !isSafeStreamKey(key)) {
    throw new Error("Ongeldige streamkey");
  }
  if (!key) return base;
  if (base.endsWith(`/${key}`)) return base;
  return `${base}/${key}`;
}

/** Bouwt de volledige RTMP-bestemming. Gooit bij ongeldige input. */
export function buildRtmpDestination(settings: LivestreamSettings): string {
  return buildRtmpDestinationFor(settings.platform, settings.streamKey, settings.customUrl);
}

export function buildRtmpDestinations(settings: LivestreamSettings): string[] {
  const dests = [buildRtmpDestination(settings)];
  if (settings.dualEnabled) {
    dests.push(buildRtmpDestinationFor(settings.platform2, settings.streamKey2, settings.customUrl2));
  }
  return dests;
}

export function isRtmpDestination(destination: string): boolean {
  return /^rtmps?:\/\//i.test(destination);
}

export function ffmpegOutputArgs(destinations: string[]): string[] {
  if (destinations.length === 1 && isRtmpDestination(destinations[0])) {
    return ["-f", "flv", destinations[0]];
  }
  if (destinations.length === 1) {
    return ["-movflags", "+frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", destinations[0]];
  }
  const spec = destinations
    .map((url) =>
      isRtmpDestination(url)
        ? `[f=flv:onfail=ignore:flvflags=no_duration_filesize]${escapeTeeUrl(url)}`
        : `[f=mp4:movflags=+frag_keyframe+empty_moov+default_base_moof]${escapeTeeUrl(url)}`,
    )
    .join("|");
  return [
    "-use_fifo",
    "1",
    "-fifo_options",
    "drop_pkts_on_overflow=1:attempt_recovery=1:recovery_wait_time=1",
    "-f",
    "tee",
    spec,
  ];
}

export function maskRtmpDestination(destination: string): string {
  try {
    const url = new URL(destination);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return `${url.protocol}//${url.host}/***`;
    parts[parts.length - 1] = "***";
    return `${url.protocol}//${url.host}/${parts.join("/")}`;
  } catch {
    return "rtmp://***";
  }
}

export function clampBitrateKbps(value: number): number {
  if (!Number.isFinite(value)) return 6000;
  return Math.min(20000, Math.max(1500, Math.round(value)));
}

export function clampAudioVolume(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_AUDIO_VOLUME;
  return Math.min(150, Math.max(0, Math.round(n)));
}

export function syncBrowserAudioChannels(
  videoInputs: LivestreamVideoInput[],
  channels: LivestreamAudioChannel[],
  activeVideoInputId: string,
): { audioChannels: LivestreamAudioChannel[]; videoInputs: LivestreamVideoInput[] } {
  const sourced = videoInputs.filter((input) => input.kind === "browser" || input.kind === "media");
  const deviceFor = (input: LivestreamVideoInput) =>
    input.kind === "media" ? mediaAudioDeviceId(input.id) : browserAudioDeviceId(input.id);
  const ownerOf = (device: string) =>
    isMediaAudioDevice(device) ? mediaAudioInputId(device) : browserAudioInputId(device);
  const want = new Set(sourced.map((input) => deviceFor(input)));
  let audioChannels = channels.filter(
    (channel) => !isSourceAudioDevice(channel.device) || want.has(channel.device),
  );
  const have = new Set(audioChannels.map((channel) => channel.device));
  for (const input of sourced) {
    const device = deviceFor(input);
    if (have.has(device)) continue;
    audioChannels = [
      ...audioChannels,
      createAudioChannel({
        device,
        muted: input.id !== activeVideoInputId,
      }),
    ];
    have.add(device);
  }
  const videoNext = videoInputs.map((input) => {
    const follow = { ...input.audioFollow };
    let changed = false;
    for (const channel of audioChannels) {
      if (!isSourceAudioDevice(channel.device) || follow[channel.id]) continue;
      follow[channel.id] = input.id === ownerOf(channel.device) ? "unmute" : "mute";
      changed = true;
    }
    return changed ? { ...input, audioFollow: follow } : input;
  });
  return { audioChannels, videoInputs: videoNext };
}

export function createAudioChannel(partial?: Partial<LivestreamAudioChannel>): LivestreamAudioChannel {
  const id =
    typeof partial?.id === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(partial.id)
      ? partial.id
      : `a${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    device: typeof partial?.device === "string" ? partial.device.trim() : "",
    volume: clampAudioVolume(partial?.volume ?? DEFAULT_AUDIO_VOLUME),
    muted: partial?.muted === true,
  };
}

export function mergeAudioChannels(
  raw: unknown,
  fallbackDevice: string,
): LivestreamAudioChannel[] {
  const fallback = fallbackDevice.trim();
  if (Array.isArray(raw) && raw.length > 0) {
    const seen = new Set<string>();
    const out: LivestreamAudioChannel[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const channel = createAudioChannel(item as Partial<LivestreamAudioChannel>);
      if (seen.has(channel.id)) channel.id = createAudioChannel().id;
      seen.add(channel.id);
      out.push(channel);
    }
    if (out.length > 0) return out;
  }
  return [createAudioChannel({ id: "a1", device: fallback })];
}

export function armedAudioChannels(channels: LivestreamAudioChannel[]): LivestreamAudioChannel[] {
  const seen = new Set<string>();
  const out: LivestreamAudioChannel[] = [];
  for (const channel of channels) {
    if (!channel.device || !isSafeDshowDeviceName(channel.device)) continue;
    if (seen.has(channel.device)) continue;
    seen.add(channel.device);
    out.push(channel);
  }
  return out;
}

export function audioChannelGain(channel: LivestreamAudioChannel, masterVolume: number): number {
  if (channel.muted) return 0;
  return (clampAudioVolume(channel.volume) / 100) * (clampAudioVolume(masterVolume) / 100);
}

export const AUDIO_MONITOR_MASTER_ID = "master";

export function mergeAudioMonitorCueIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || id.length > 24 || seen.has(id)) continue;
    if (id !== AUDIO_MONITOR_MASTER_ID && !/^[A-Za-z0-9_-]{1,24}$/.test(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function audioMonitorProcessKey(settings: {
  audioEnabled: boolean;
  audioMonitorDevice: string;
  audioMonitorCueIds: string[];
  audioChannels: LivestreamAudioChannel[];
}): string {
  if (!settings.audioEnabled) return "";
  if (mergeAudioMonitorCueIds(settings.audioMonitorCueIds).length === 0) return "";
  const armed = armedAudioChannels(settings.audioChannels);
  if (armed.length === 0) return "";
  return `${settings.audioMonitorDevice.trim() || "."}|${armed.map((channel) => channel.device).join("|")}`;
}

/** PFL (kanaal) = unity; master-koptelefoon = mix na faders. */
export function audioMonitorGains(settings: {
  audioMasterVolume: number;
  audioMonitorCueIds: string[];
  audioChannels: LivestreamAudioChannel[];
}): number[] {
  const armed = armedAudioChannels(settings.audioChannels);
  const cues = new Set(mergeAudioMonitorCueIds(settings.audioMonitorCueIds));
  const hasChannelCue = armed.some((channel) => cues.has(channel.id));
  if (hasChannelCue) {
    return armed.map((channel) => (cues.has(channel.id) && !channel.muted ? 1 : 0));
  }
  if (cues.has(AUDIO_MONITOR_MASTER_ID)) {
    return armed.map((channel) => audioChannelGain(channel, settings.audioMasterVolume));
  }
  return armed.map(() => 0);
}

export function audioMonitorOutputConflicts(
  output: string,
  channels: LivestreamAudioChannel[],
): boolean {
  const want = output.trim().toLowerCase();
  if (!want) return false;
  return channels.some((channel) => {
    const name = audioDeviceDisplayName(channel.device).trim().toLowerCase();
    return Boolean(name) && name === want;
  });
}

/** azmq bind — mute/faders sturen hier volume-commando's naartoe zonder FFmpeg te herstarten. */
export const LIVESTREAM_AZMQ_PORT = 18756;
export const LIVESTREAM_AZMQ_ADDR = `tcp://127.0.0.1:${LIVESTREAM_AZMQ_PORT}`;
/** `:` moet in een filtergraph als `\\:` zodat FFmpeg hem niet als optie-scheider ziet. */
export const LIVESTREAM_AZMQ_FILTER = `azmq=b=tcp\\\\://127.0.0.1\\\\:${LIVESTREAM_AZMQ_PORT}`;

/**
 * Apparaten in de FFmpeg-audioketen. Alleen dit vereist een herstart;
 * mute/volume gaat live via azmq.
 */
export function audioDeviceFingerprint(settings: {
  audioEnabled: boolean;
  audioChannels: LivestreamAudioChannel[];
}): string {
  if (!settings.audioEnabled) return "off";
  const armed = armedAudioChannels(settings.audioChannels);
  if (armed.length === 0) return "silent";
  return armed.map((channel) => channel.device).join("|");
}

export function audioGainCommands(settings: {
  audioMasterVolume: number;
  audioChannels: LivestreamAudioChannel[];
}): Array<{ target: string; gain: number }> {
  const master = settings.audioMasterVolume;
  return armedAudioChannels(settings.audioChannels).map((channel, index) => ({
    target: `volume@v${index}`,
    gain: audioChannelGain(channel, master),
  }));
}

/** @deprecated gebruik audioDeviceFingerprint + audioGainCommands */
export function audioChainFingerprint(settings: {
  audioEnabled: boolean;
  audioMasterVolume: number;
  audioChannels: LivestreamAudioChannel[];
}): string {
  if (!settings.audioEnabled) return "off";
  const armed = armedAudioChannels(settings.audioChannels);
  if (armed.length === 0) return "silent";
  const master = clampAudioVolume(settings.audioMasterVolume);
  return armed
    .map((channel) => `${channel.device}@${audioChannelGain(channel, master).toFixed(4)}`)
    .join("|");
}

export type LivestreamAudioMixPlan = {
  label: string;
  inputArgs: string[];
  filterComplex: string | null;
  audioMap: string;
};

export function silentAudioMixPlan(): LivestreamAudioMixPlan {
  return {
    label: "silent",
    inputArgs: silentAudioInputArgs(),
    filterComplex: null,
    audioMap: "1:a:0",
  };
}

export function buildAudioMixPlan(
  channels: LivestreamAudioChannel[],
  masterVolume: number,
): LivestreamAudioMixPlan {
  const armed = armedAudioChannels(channels);
  if (armed.length === 0) return silentAudioMixPlan();

  const inputArgs = armed.flatMap((channel) => audioInputArgs(channel.device));
  const pads = armed.map((channel, index) => {
    const gain = audioChannelGain(channel, masterVolume);
    const src = `${index + 1}:a`;
    const zmq = index === 0 ? `${LIVESTREAM_AZMQ_FILTER},` : "";
    return `[${src}]aformat=sample_fmts=fltp:sample_rates=${STREAM_AUDIO_SAMPLE_RATE}:channel_layouts=stereo,${zmq}volume@v${index}=${gain}:eval=frame[a${index}]`;
  });

  if (armed.length === 1) {
    return {
      label: `dshow ${armed[0].device} vol=${audioChannelGain(armed[0], masterVolume)}`,
      inputArgs,
      filterComplex: `${pads[0]};[a0]aresample=async=1:first_pts=0[aout]`,
      audioMap: "[aout]",
    };
  }

  const mixInputs = armed.map((_, index) => `[a${index}]`).join("");
  return {
    label: `mix ${armed.map((c) => c.device).join(" + ")}`,
    inputArgs,
    filterComplex: `${pads.join(";")};${mixInputs}amix=inputs=${armed.length}:duration=longest:dropout_transition=2:normalize=0,aresample=async=1:first_pts=0[aout]`,
    audioMap: "[aout]",
  };
}
