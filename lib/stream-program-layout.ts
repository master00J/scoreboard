import type { LivestreamSettings } from "./livestream";
import { activeManualPhaseLayout } from "./stream-layer-layout";
import type {
  LivestreamScorePosition,
  LivestreamSponsorPosition,
  LivestreamSponsorScope,
} from "./livestream";

/** Speeltijd vs pauze — zelfde fases als het LED-scorebord. */
export type StreamProgramPhase = "play" | "break";

export type ResolvedStreamProgramLayout = {
  phase: StreamProgramPhase;
  showScore: boolean;
  showSponsorStrip: boolean;
  showSponsorBreak: boolean;
  scorePosition: LivestreamScorePosition;
  sponsorStripStyle: "logos" | "lowerthird";
  sponsorScope: LivestreamSponsorScope;
  sponsorPosition: LivestreamSponsorPosition;
};

export function streamProgramPhase(matchStatus: string | undefined): StreamProgramPhase {
  if (
    matchStatus === "FIRST_HALF" ||
    matchStatus === "SECOND_HALF" ||
    matchStatus === "EXTRA_TIME"
  ) {
    return "play";
  }
  return "break";
}

function layoutFromPhaseConfig(
  phase: StreamProgramPhase,
  config: ReturnType<typeof activeManualPhaseLayout>,
): ResolvedStreamProgramLayout {
  const stripStyle = config.sponsorStyle === "lowerthird" ? "lowerthird" : "logos";
  return {
    phase,
    showScore: config.score,
    showSponsorStrip: config.sponsors && config.sponsorStyle !== "break",
    showSponsorBreak: config.sponsors && config.sponsorStyle === "break",
    scorePosition: config.scorePosition,
    sponsorStripStyle: stripStyle,
    sponsorScope: config.sponsorScope,
    sponsorPosition: config.sponsorPosition,
  };
}

/** Bepaalt welke lagen op de stream zichtbaar zijn. */
export function resolveStreamProgramLayout(
  settings: Pick<
    LivestreamSettings,
    | "layoutMode"
    | "sponsors"
    | "manualPhaseSplit"
    | "manualLayout"
    | "manualPlayLayout"
    | "manualBreakLayout"
  >,
  matchStatus: string | undefined,
): ResolvedStreamProgramLayout {
  const phase = streamProgramPhase(matchStatus);

  if (settings.layoutMode === "manual") {
    return layoutFromPhaseConfig(phase, activeManualPhaseLayout(settings, phase));
  }

  if (phase === "play") {
    return layoutFromPhaseConfig(phase, {
      score: true,
      scorePosition: "bottom",
      sponsors: false,
      sponsorStyle: "logos",
      sponsorScope: "phase",
      sponsorPosition: "auto",
    });
  }

  return layoutFromPhaseConfig(phase, {
    score: false,
    scorePosition: "bottom",
    sponsors: settings.sponsors,
    sponsorStyle: "break",
    sponsorScope: "phase",
    sponsorPosition: "auto",
  });
}

export function streamProgramPhaseLabelKey(
  phase: StreamProgramPhase,
): "livestream.phasePlay" | "livestream.phaseBreak" {
  return phase === "play" ? "livestream.phasePlay" : "livestream.phaseBreak";
}

export type StreamLayoutSummary = {
  phase: StreamProgramPhase;
  score: boolean;
  sponsors: "off" | "pip" | "fullscreen";
};

/** Wat de kijker nu ziet — voor studio-previewtekst. */
export function summarizeStreamLayout(
  settings: Parameters<typeof resolveStreamProgramLayout>[0],
  matchStatus: string | undefined,
): StreamLayoutSummary {
  const layout = resolveStreamProgramLayout(settings, matchStatus);
  return {
    phase: layout.phase,
    score: layout.showScore,
    sponsors: layout.showSponsorBreak ? "fullscreen" : layout.showSponsorStrip ? "pip" : "off",
  };
}
