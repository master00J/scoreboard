import type { Match, Sponsor, SponsorSection } from "./types";
import {
  postmatchSpreadTimelineSeconds,
  prematchSpreadTimelineSeconds,
} from "./sponsor-distribution";

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

/** Overlay die de LED-sponsors bevriest — niet rust/einde, die ís de stream-break. */
export function streamSponsorInterrupted(mode: string | undefined): boolean {
  return (
    mode === "GOAL" ||
    mode === "GOAL_INTRO_VIDEO" ||
    mode === "GOAL_PLAYER_VIDEO" ||
    mode === "SUBSTITUTION" ||
    mode === "CARD"
  );
}
