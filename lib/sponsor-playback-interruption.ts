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

export function isSponsorPlaybackInterrupted(
  mode: DisplayModeT,
  hasScheduledMediaCue: boolean,
  /**
   * Externe capture staat fullscreen op het stadionscherm: de sponsorrotatie draait
   * er onzichtbaar onder. Niemand in het stadion ziet die sponsor, dus mag de clip
   * geen budget of proof-of-play-impressie verbruiken zolang het beeld bedekt is.
   */
  externalCaptureCoversDisplay = false,
): boolean {
  return (
    hasScheduledMediaCue ||
    externalCaptureCoversDisplay ||
    SPONSOR_PLAYBACK_INTERRUPTION_MODES.has(mode)
  );
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
