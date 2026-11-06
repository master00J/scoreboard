import type { LivestreamPlatform, LivestreamResolution } from "./livestream";

/**
 * Aanbevolen videobitrate per resolutie/fps.
 *
 * Een scorebord is de zwaarste content voor H.264: harde witte cijfers op zwart,
 * scherpe randen en een klok die elke seconde verandert. Te weinig bits geeft
 * "ringing" (wazige halo's) rond de cijfers. YouTube adviseert 8 Mbps voor
 * 1080p30 en 12 Mbps voor 1080p60; Twitch adviseert hoogstens 6 Mbps.
 */

export const BITRATE_MIN_KBPS = 1500;
export const BITRATE_MAX_KBPS = 20000;

/**
 * Twitch adviseert hoogstens 6000 kbps video. De ingest neemt tot ~8500 aan, maar kleinere kanalen
 * krijgen niet altijd lagere kwaliteiten voor kijkers: dan moet iedereen de volle bitrate trekken
 * en blijft de stream bij trage kijkers hangen.
 */
export const TWITCH_MAX_KBPS = 6000;
/** Facebook Live neemt tot 9 Mbps aan voor 1080p; meer wordt teruggeschroefd of geweigerd. */
export const FACEBOOK_MAX_KBPS = 9000;

const PLATFORM_MAX_KBPS: Partial<Record<LivestreamPlatform, number>> = {
  twitch: TWITCH_MAX_KBPS,
  facebook: FACEBOOK_MAX_KBPS,
};

export type BitrateAdvice = {
  /** Aanbevolen waarde voor deze combinatie. */
  recommendedKbps: number;
  /** Onder deze waarde gaat de kwaliteit zichtbaar achteruit. */
  minimumKbps: number;
  /** Hoger dan dit levert niets op (of wordt door het platform geweigerd). */
  maximumKbps: number;
};

function baseAdvice(resolution: LivestreamResolution, fps: number): BitrateAdvice {
  const isHd = resolution === "1920x1080";
  if (isHd) {
    if (fps >= 50) return { recommendedKbps: 12000, minimumKbps: 8000, maximumKbps: 16000 };
    if (fps >= 24) return { recommendedKbps: 8000, minimumKbps: 5000, maximumKbps: 12000 };
    return { recommendedKbps: 5000, minimumKbps: 3000, maximumKbps: 8000 };
  }
  if (fps >= 50) return { recommendedKbps: 6000, minimumKbps: 4000, maximumKbps: 9000 };
  if (fps >= 24) return { recommendedKbps: 4500, minimumKbps: 3000, maximumKbps: 7000 };
  return { recommendedKbps: 3000, minimumKbps: 2000, maximumKbps: 5000 };
}

/**
 * Aanbeveling, eventueel afgetopt op wat het platform accepteert. Bij twee bestemmingen gaat één
 * encoder naar beide, dus telt de strengste grens.
 */
export function bitrateAdvice(
  resolution: LivestreamResolution,
  fps: number,
  platform?: LivestreamPlatform | readonly LivestreamPlatform[],
): BitrateAdvice {
  const base = baseAdvice(resolution, fps);
  const platforms: readonly LivestreamPlatform[] = platform == null ? [] : typeof platform === "string" ? [platform] : platform;
  const caps = platforms.map((item) => PLATFORM_MAX_KBPS[item]).filter((value): value is number => value != null);
  if (caps.length === 0) return base;
  const cap = Math.min(...caps);
  return {
    recommendedKbps: Math.min(base.recommendedKbps, cap),
    minimumKbps: Math.min(base.minimumKbps, cap),
    maximumKbps: Math.min(base.maximumKbps, cap),
  };
}

export type BitrateVerdict = "low" | "ok" | "high";

/** Oordeel over een gekozen bitrate: te laag, prima, of hoger dan nuttig. */
export function bitrateVerdict(
  bitrateKbps: number,
  resolution: LivestreamResolution,
  fps: number,
  platform?: LivestreamPlatform | readonly LivestreamPlatform[],
): BitrateVerdict {
  const advice = bitrateAdvice(resolution, fps, platform);
  if (bitrateKbps < advice.minimumKbps) return "low";
  if (bitrateKbps > advice.maximumKbps) return "high";
  return "ok";
}

/**
 * Deel van de gemeten upload dat de stream mag gebruiken. De rest is ruimte voor pieken, ander
 * verkeer en een snelheidstest die wat optimistisch was. Twitch en OBS adviseren 75–80%.
 */
export const UPLOAD_HEADROOM = 0.75;
/** Ingevulde upload wordt afgekapt op deze waarde (Mbps). */
export const UPLOAD_MBPS_MAX = 1000;
/** Onder deze videobitrate zakken we nooit, ook niet als de upload eigenlijk te klein is. */
export const UPLOAD_FLOOR_KBPS = 800;

/** Uploadsnelheid in Mbps, zoals een snelheidstest hem toont (twee decimalen). 0 = onbekend. */
export function clampUploadMbps(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.min(n, UPLOAD_MBPS_MAX) * 100) / 100;
}

/**
 * Videobitrate (kbps) per bestemming die in de upload past, of null als de upload onbekend is.
 * Eén encoder stuurt naar elke bestemming een eigen kopie: twee platformen = dubbele upload.
 */
export function uploadBudgetKbps(uploadMbps: number, destinations: number, audioKbps: number): number | null {
  if (!(uploadMbps > 0) || destinations < 1) return null;
  const perDestination = (uploadMbps * 1000 * UPLOAD_HEADROOM) / destinations - audioKbps;
  return Math.max(0, Math.floor(perDestination / 100) * 100);
}

/** Wat de encoder echt krijgt: de gekozen bitrate, maar nooit meer dan de upload draagt. */
export function effectiveBitrateKbps(chosenKbps: number, budgetKbps: number | null): number {
  if (budgetKbps == null) return chosenKbps;
  return Math.min(chosenKbps, Math.max(budgetKbps, UPLOAD_FLOOR_KBPS));
}

/** Totale upload (kbps) voor video + audio naar alle bestemmingen samen. */
export function totalUploadKbps(videoKbps: number, destinations: number, audioKbps: number): number {
  return (videoKbps + audioKbps) * Math.max(1, destinations);
}

/**
 * FFmpeg verstuurt trager dan realtime: de verbinding (of de encoder) houdt het niet bij en
 * kijkers zien de stream bufferen. De eerste seconden tellen niet mee, dan is `speed` nog onrustig.
 */
export function streamFallingBehind(health: { speed: number | null; frames: number; targetFps: number }): boolean {
  if (health.speed == null) return false;
  if (health.frames < Math.max(1, health.targetFps) * 15) return false;
  return health.speed < 0.95;
}

/**
 * Instellen zoals in OBS: "Eenvoudig" kiest alleen een kwaliteit en ArenaCue vult resolutie, fps en
 * bitrate in; "Geavanceerd" laat elk getal zelf zetten.
 */
export type LivestreamEncoderMode = "simple" | "advanced";
/** Kwaliteit in de eenvoudige stand. `auto` = het beste wat de upload draagt. */
export type LivestreamQuality = "auto" | "720p30" | "720p60" | "1080p30" | "1080p60";
/** Afweging snelheid/kwaliteit van de encoder. `balanced` is wat ArenaCue altijd al gebruikte. */
export type LivestreamEncoderPreset = "quality" | "balanced" | "performance";

export const LIVESTREAM_QUALITIES: readonly LivestreamQuality[] = ["auto", "1080p60", "1080p30", "720p60", "720p30"];
export const ENCODER_PRESETS: readonly LivestreamEncoderPreset[] = ["quality", "balanced", "performance"];
export const KEYFRAME_SECONDS = [1, 2, 3, 4] as const;
export const DEFAULT_KEYFRAME_SEC = 2;
export const AUDIO_BITRATES_KBPS = [96, 128, 160, 192, 256, 320] as const;
export const DEFAULT_AUDIO_BITRATE_KBPS = 160;

export function parseEncoderMode(value: unknown): LivestreamEncoderMode | null {
  return value === "simple" || value === "advanced" ? value : null;
}

export function parseQuality(value: unknown): LivestreamQuality {
  return LIVESTREAM_QUALITIES.includes(value as LivestreamQuality) ? (value as LivestreamQuality) : "auto";
}

export function parseEncoderPreset(value: unknown): LivestreamEncoderPreset {
  return ENCODER_PRESETS.includes(value as LivestreamEncoderPreset) ? (value as LivestreamEncoderPreset) : "balanced";
}

export function clampKeyframeSec(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_KEYFRAME_SEC;
  return Math.min(4, n);
}

export function clampAudioBitrateKbps(value: unknown): number {
  const n = Number(value);
  return (AUDIO_BITRATES_KBPS as readonly number[]).includes(n) ? n : DEFAULT_AUDIO_BITRATE_KBPS;
}

/** Keyframe-interval in beelden. Twitch en YouTube willen elke 2 seconden een keyframe. */
export function keyframeIntervalFrames(fps: number, keyframeSec: number): number {
  return Math.max(1, Math.round(fps * clampKeyframeSec(keyframeSec)));
}

const QUALITY_FORMAT: Record<Exclude<LivestreamQuality, "auto">, { resolution: LivestreamResolution; fps: number }> = {
  "1080p60": { resolution: "1920x1080", fps: 60 },
  "1080p30": { resolution: "1920x1080", fps: 30 },
  "720p60": { resolution: "1280x720", fps: 60 },
  "720p30": { resolution: "1280x720", fps: 30 },
};

/** Van beste naar eenvoudigste: `auto` neemt de eerste die in de upload past. */
const AUTO_LADDER: readonly Exclude<LivestreamQuality, "auto">[] = ["1080p60", "1080p30", "720p60", "720p30"];

/** Zonder gemeten upload kiest `auto` iets wat op een gewone clubverbinding doorkomt. */
const AUTO_WITHOUT_UPLOAD: Exclude<LivestreamQuality, "auto"> = "720p30";

export type StreamFormatPlan = {
  quality: Exclude<LivestreamQuality, "auto">;
  resolution: LivestreamResolution;
  fps: number;
  bitrateKbps: number;
  /** Ook de eenvoudigste stand haalt het minimum niet: beeld wordt wazig. */
  tight: boolean;
};

/**
 * Resolutie, fps en bitrate voor een kwaliteit, rekening houdend met het platform en de upload.
 * Dit is de aanbeveling van de wizard én wat de eenvoudige stand instelt.
 */
export function streamFormatPlan(
  quality: LivestreamQuality,
  uploadMbps: number,
  platforms: readonly LivestreamPlatform[],
  audioKbps: number,
): StreamFormatPlan {
  const budget = uploadBudgetKbps(uploadMbps, platforms.length, audioKbps);
  let pick: Exclude<LivestreamQuality, "auto">;
  if (quality !== "auto") {
    pick = quality;
  } else if (budget == null) {
    pick = AUTO_WITHOUT_UPLOAD;
  } else {
    pick =
      AUTO_LADDER.find((step) => {
        const format = QUALITY_FORMAT[step];
        return bitrateAdvice(format.resolution, format.fps, platforms).minimumKbps <= budget;
      }) ?? AUTO_LADDER[AUTO_LADDER.length - 1]!;
  }
  const format = QUALITY_FORMAT[pick];
  const advice = bitrateAdvice(format.resolution, format.fps, platforms);
  const bitrateKbps = effectiveBitrateKbps(advice.recommendedKbps, budget);
  return {
    quality: pick,
    resolution: format.resolution,
    fps: format.fps,
    bitrateKbps,
    tight: bitrateKbps < advice.minimumKbps,
  };
}

/** Keuzelijst voor de UI: vaste stappen plus de aanbevolen waarde. */
export function bitrateOptionsKbps(
  resolution: LivestreamResolution,
  fps: number,
  platform?: LivestreamPlatform | readonly LivestreamPlatform[],
): number[] {
  const advice = bitrateAdvice(resolution, fps, platform);
  const steps = [2500, 4500, 6000, 8000, 10000, 12000, 16000];
  const set = new Set(steps.filter((v) => v <= advice.maximumKbps));
  set.add(advice.recommendedKbps);
  return [...set].sort((a, b) => a - b);
}
