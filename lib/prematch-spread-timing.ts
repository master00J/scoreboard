import { prematchSpreadClock, prematchSpreadTimelineSeconds } from "./sponsor-distribution";
import type { Match, Sponsor } from "./types";

export type PrematchSpreadTiming = {
  /** Tijdlijnlengte (s) waarin sponsor-budgetten worden gespreid. */
  timelineLenSec: number;
  /** Seconden sinds start van het prematch-venster. */
  elapsedSec: number;
  /** Rooster loopt (sponsor-slots actief). */
  rosterRunning: boolean;
  timelineComplete: boolean;
  /** Nog vóór kickoff − venster (alleen bij geplande aftrap). */
  beforeWindow: boolean;
  usesKickoffAnchor: boolean;
};

/**
 * Prematch sponsor-spread:
 * - Met `kickoffAt`: venster start op kickoff − H en eindigt op aftrap (H = prematchSpreadWindowSec of som budgets).
 * - Zonder aftrap: val terug op `fallbackOriginMs` (moment waarop spread actief werd), zoals voorheen.
 */
export function computePrematchSpreadTiming(
  match: Pick<Match, "kickoffAt" | "prematchSpreadWindowSec"> | null | undefined,
  sponsors: Sponsor[],
  nowMs: number,
  fallbackOriginMs: number | null,
): PrematchSpreadTiming {
  const H = Math.max(1, prematchSpreadTimelineSeconds(match ?? undefined, sponsors));
  const koMs = match?.kickoffAt ? new Date(match.kickoffAt).getTime() : Number.NaN;

  if (Number.isFinite(koMs)) {
    const windowStartMs = koMs - H * 1000;
    if (nowMs < windowStartMs) {
      return {
        timelineLenSec: H,
        elapsedSec: 0,
        rosterRunning: false,
        timelineComplete: false,
        beforeWindow: true,
        usesKickoffAnchor: true,
      };
    }
    if (nowMs >= koMs) {
      return {
        timelineLenSec: H,
        elapsedSec: H,
        rosterRunning: false,
        timelineComplete: true,
        beforeWindow: false,
        usesKickoffAnchor: true,
      };
    }
    const elapsedSec = (nowMs - windowStartMs) / 1000;
    const { timelineComplete } = prematchSpreadClock(elapsedSec, H);
    return {
      timelineLenSec: H,
      elapsedSec,
      rosterRunning: !timelineComplete,
      timelineComplete,
      beforeWindow: false,
      usesKickoffAnchor: true,
    };
  }

  if (fallbackOriginMs == null) {
    return {
      timelineLenSec: H,
      elapsedSec: 0,
      rosterRunning: false,
      timelineComplete: false,
      beforeWindow: false,
      usesKickoffAnchor: false,
    };
  }
  const elapsedSec = Math.max(0, (nowMs - fallbackOriginMs) / 1000);
  const { timelineComplete } = prematchSpreadClock(elapsedSec, H);
  return {
    timelineLenSec: H,
    elapsedSec,
    rosterRunning: !timelineComplete,
    timelineComplete,
    beforeWindow: false,
    usesKickoffAnchor: false,
  };
}

/** Voor control live-rooster: prematch-tijd op de spread-tijdlijn. */
export function prematchRosterClockSec(
  match: Pick<Match, "kickoffAt" | "prematchSpreadWindowSec" | "status"> | null | undefined,
  sponsors: Sponsor[],
  nowMs: number,
  fallbackOriginMs: number | null,
  matchTimerElapsedSec: number,
): number {
  if (!match) return 0;
  if (match.status !== "PREMATCH" && match.status !== "SETUP") return matchTimerElapsedSec;
  const t = computePrematchSpreadTiming(match, sponsors, nowMs, fallbackOriginMs);
  if (t.usesKickoffAnchor) return t.elapsedSec;
  return fallbackOriginMs != null ? t.elapsedSec : matchTimerElapsedSec;
}
