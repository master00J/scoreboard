import type { LivestreamSettings, StreamLayerLayout } from "./livestream";
import type { StreamProgramPhase } from "./stream-program-layout";

export type { StreamLayerLayout } from "./livestream";
export {
  DEFAULT_STREAM_BREAK_LAYOUT,
  DEFAULT_STREAM_MANUAL_LAYOUT,
  DEFAULT_STREAM_PLAY_LAYOUT,
} from "./livestream";

export function syncLegacyFromManualLayout(layout: StreamLayerLayout): Pick<
  LivestreamSettings,
  "overlay" | "scorePosition" | "sponsors" | "sponsorStyle" | "sponsorScope" | "sponsorPosition"
> {
  return {
    overlay: layout.score,
    scorePosition: layout.scorePosition,
    sponsors: layout.sponsors,
    sponsorStyle: layout.sponsorStyle,
    sponsorScope: layout.sponsorScope,
    sponsorPosition: layout.sponsorPosition,
  };
}

export function activeManualPhaseLayout(
  settings: Pick<
    LivestreamSettings,
    "manualPhaseSplit" | "manualLayout" | "manualPlayLayout" | "manualBreakLayout"
  >,
  phase: StreamProgramPhase,
): StreamLayerLayout {
  if (!settings.manualPhaseSplit) return settings.manualLayout;
  return phase === "play" ? settings.manualPlayLayout : settings.manualBreakLayout;
}

/** Strip-stijl (geen fullscreen break). */
export function stripSponsorStyle(style: StreamLayerLayout["sponsorStyle"]): "logos" | "lowerthird" {
  return style === "lowerthird" ? "lowerthird" : "logos";
}

export function resolveSponsorStripEdge(
  sponsorPosition: StreamLayerLayout["sponsorPosition"],
  scorePosition: StreamLayerLayout["scorePosition"],
  scoreVisible: boolean,
): "top" | "bottom" {
  if (sponsorPosition === "top") return "top";
  if (sponsorPosition === "bottom") return "bottom";
  if (scoreVisible) return scorePosition === "bottom" ? "top" : "bottom";
  return "bottom";
}
