import type { DisplayModeT } from "@/lib/validation/commands";

/**
 * Tijdelijke schermmodi die een lopende sponsorclip onderbreken.
 *
 * MATCH en SPONSOR_ROTATION staan hier bewust niet in: een handmatige keuze voor
 * alleen het scorebord pauzeert de rotatie, maar is geen kort wedstrijdmoment dat
 * de huidige sponsorclip automatisch opnieuw moet starten.
 */
const SPONSOR_PLAYBACK_INTERRUPTION_MODES: ReadonlySet<DisplayModeT> = new Set([
  "TEAM_INTRO",
  "PLAYER_INTRO",
  "GOAL",
  "GOAL_INTRO_VIDEO",
  "GOAL_PLAYER_VIDEO",
  "SUBSTITUTION",
  "CARD",
  "HALFTIME",
  "FULLTIME",
  "SPONSOR",
  "BLACKOUT",
  "CUSTOM",
]);

/**
 * Speelhelft L-frame: deze modi blijven boven de gemounte (gepauzeerde) rotatie liggen.
 * SPONSOR (quick button / één clip) hoort daarbij — anders blijft alleen de rotatie zichtbaar.
 */
export function isBesideInterruptOverlay(
  mode: DisplayModeT | string,
  hasActiveMedia: boolean,
): boolean {
  return mode === "GOAL" || mode === "CARD" || (mode === "SPONSOR" && hasActiveMedia);
}

export function isSponsorPlaybackInterrupted(
  mode: DisplayModeT | string,
  hasScheduledMediaCue: boolean,
  /**
   * Externe capture staat fullscreen op het stadionscherm: de sponsorrotatie draait
   * er onzichtbaar onder. Niemand in het stadion ziet die sponsor, dus mag de clip
   * geen budget of proof-of-play-impressie verbruiken zolang het beeld bedekt is.
   */
  externalCaptureCoversDisplay = false,
  /** Time-out-klok loopt: wedstrijdmoment, geen sponsortijd. */
  timeoutCoversDisplay = false,
): boolean {
  return (
    hasScheduledMediaCue ||
    externalCaptureCoversDisplay ||
    timeoutCoversDisplay ||
    SPONSOR_PLAYBACK_INTERRUPTION_MODES.has(mode as DisplayModeT)
  );
}

/** Time-out-overlay is actief (geen blackout). */
export function timeoutCoversDisplay(state: {
  timeoutRunning?: boolean | null;
  mode?: string | null;
} | null | undefined): boolean {
  if (!state) return false;
  return !!state.timeoutRunning && state.mode !== "BLACKOUT";
}

/** Bedekt de externe capture nu het stadionscherm? (BLACKOUT wint: dan staat het scherm zwart.) */
export function externalCaptureCoversDisplay(state: {
  externalCaptureToDisplay?: boolean | null;
  externalCaptureSourceId?: string | null;
  mode?: string | null;
} | null | undefined): boolean {
  if (!state) return false;
  return (
    !!state.externalCaptureToDisplay &&
    !!state.externalCaptureSourceId &&
    state.mode !== "BLACKOUT"
  );
}
