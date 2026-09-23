import type { Match, Sponsor, SponsorSection } from "./types";
import {
  postmatchSpreadTimelineSeconds,
  prematchSpreadTimelineSeconds,
} from "./sponsor-distribution";
import { isSponsorPlaybackInterrupted } from "./sponsor-playback-interruption";

export function streamSponsorTimelineSeconds(
  section: SponsorSection,
  match: Pick<Match, "halfDurationSec" | "halfBreakSec" | "prematchSpreadWindowSec"> | null,
  sponsors: Sponsor[],
): number {
  if (section === "match") return Math.max(60, match?.halfDurationSec ?? 60);
  if (section === "halftime") return Math.max(60, match?.halfBreakSec ?? 60);
  if (section === "prematch") return prematchSpreadTimelineSeconds(match ?? undefined, sponsors);
  return postmatchSpreadTimelineSeconds(sponsors);
}

/**
 * Overlay die de stream-sponsors bevriest (goal, quick button, intro, blackout).
 * Rust/einde ís het stream-programma, geen korte onderbreking.
 */
export function streamSponsorInterrupted(mode: string | undefined): boolean {
  if (mode === "HALFTIME" || mode === "FULLTIME") return false;
  return isSponsorPlaybackInterrupted(mode ?? "IDLE", false);
}
