import type { LivestreamSettings, StreamLayerLayout } from "./livestream";
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

/**
 * Bepaalt welke lagen op de stream zichtbaar zijn.
 *
 * `phaseOverride` dwingt een fase af in plaats van die uit de wedstrijdstatus te lezen. Nodig voor
 * de indeling-editor: anders kun je de pauze-indeling niet zien zolang er gespeeld wordt, en de
 * speel-indeling niet in de rust.
 */
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
  phaseOverride?: StreamProgramPhase,
): ResolvedStreamProgramLayout {
  const phase = phaseOverride ?? streamProgramPhase(matchStatus);

  if (settings.layoutMode === "manual") {
    return layoutFromPhaseConfig(phase, activeManualPhaseLayout(settings, phase));
  }

  return layoutFromPhaseConfig(phase, autoPhaseLayout(settings, phase));
}

/**
 * Wat "automatisch" voor deze fase doet, als gewone indeling.
 *
 * Zo kan de indeling-editor bij de overstap naar zelf instellen hiermee beginnen: wie één vinkje
 * omzet, hoort de rest niet te zien veranderen.
 */
export function autoPhaseLayout(
  settings: Pick<LivestreamSettings, "sponsors">,
  phase: StreamProgramPhase,
): StreamLayerLayout {
  if (phase === "play") {
    return {
      score: true,
      scorePosition: "bottom",
      sponsors: false,
      sponsorStyle: "logos",
      sponsorScope: "phase",
      sponsorPosition: "auto",
    };
  }
  return {
    score: false,
    scorePosition: "bottom",
    sponsors: settings.sponsors,
    sponsorStyle: "break",
    sponsorScope: "phase",
    sponsorPosition: "auto",
  };
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

/**
 * Tekent de stream nu een eigen indeling uit Scherm indelen, en zo ja welk vlak? `null` = de vaste
 * lagen (score-widget, sponsorstrook of het sponsorscherm in de pauze), zoals voorheen.
 */
export function streamCustomSurface(
  settings: Pick<LivestreamSettings, "overlayPlay" | "overlayBreak">,
  phase: StreamProgramPhase,
): "stream" | "streamBreak" | null {
  if (phase === "break") return settings.overlayBreak === "custom" ? "streamBreak" : null;
  return settings.overlayPlay === "custom" ? "stream" : null;
}
