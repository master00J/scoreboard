import type { LivestreamPlatform, LivestreamResolution } from "./livestream";

/**
 * Aanbevolen videobitrate per resolutie/fps.
 *
 * Een scorebord is de zwaarste content voor H.264: harde witte cijfers op zwart,
 * scherpe randen en een klok die elke seconde verandert. Te weinig bits geeft
 * "ringing" (wazige halo's) rond de cijfers. YouTube adviseert 8 Mbps voor
 * 1080p30 en 12 Mbps voor 1080p60; Twitch kapt af rond 6–8 Mbps.
 */

export const BITRATE_MIN_KBPS = 1500;
export const BITRATE_MAX_KBPS = 20000;

/** Twitch weigert boven ~8000 kbps; hoger heeft geen zin. */
export const TWITCH_MAX_KBPS = 8000;
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
