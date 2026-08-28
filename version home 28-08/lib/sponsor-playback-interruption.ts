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
): boolean {
  return hasScheduledMediaCue || SPONSOR_PLAYBACK_INTERRUPTION_MODES.has(mode);
}
