/**
 * Proof-of-play filters and totals, shared by the local API (server/sponsor-plays.ts) and the
 * proof-of-play panel.
 *
 * A stored `SponsorPlayLog.segmentKey` is `<matchId>:<phase>` (see `sponsorTelemetrySegmentKey`),
 * so a phase filter has to match the end of the key, not the start.
 */

export const SPONSOR_PLAY_PHASES = [
  "prematch",
  "FIRST_HALF",
  "halftime",
  "SECOND_HALF",
  "EXTRA_TIME",
  "postmatch",
] as const;

export type SponsorPlayPhase = (typeof SPONSOR_PLAY_PHASES)[number];

export function isSponsorPlayPhase(value: string): value is SponsorPlayPhase {
  return (SPONSOR_PLAY_PHASES as readonly string[]).includes(value);
}

/** Phase part of a stored segment key, or null when it is not a known phase. */
export function sponsorPlayPhaseOfSegmentKey(segmentKey: string): SponsorPlayPhase | null {
  const idx = segmentKey.lastIndexOf(":");
  const phase = idx >= 0 ? segmentKey.slice(idx + 1) : segmentKey;
  return isSponsorPlayPhase(phase) ? phase : null;
}

export type SegmentKeyCondition = { endsWith: string } | { equals: string };

/**
 * Condition on `segmentKey` for a filter value from the panel or the API.
 * - empty: no condition
 * - a phase (`FIRST_HALF`, `postmatch`, …): every key that ends in `:<phase>`
 * - a full key (`<matchId>:<phase>`): exactly that key
 */
export function sponsorPlaySegmentKeyCondition(
  filter: string | null | undefined,
): SegmentKeyCondition | undefined {
  const value = (filter ?? "").trim();
  if (!value) return undefined;
  if (value.includes(":")) return { equals: value };
  return { endsWith: `:${value}` };
}

/** In-memory version of the same condition (tests, client-side checks). */
export function segmentKeyMatchesFilter(segmentKey: string, filter: string | null | undefined): boolean {
  const cond = sponsorPlaySegmentKeyCondition(filter);
  if (!cond) return true;
  if ("equals" in cond) return segmentKey === cond.equals;
  return segmentKey.endsWith(cond.endsWith);
}

export type ProofOfPlayTotals = {
  totalPlays: number;
  totalActualSec: number;
  totalExpectedSec: number;
  avgFulfillmentPercent: number;
  /** Geboekte seconden (vastgelegd bij de start van elke fase). */
  totalBookedSec: number;
  /** Seconden die na de gekozen fases nog niet geleverd zijn. */
  totalShortfallSec: number;
};

/**
 * Totals for the report from the per-sponsor aggregate (one row per sponsor, over every
 * matching play). Do not compute them from the detail list: that list is capped.
 */
export function proofOfPlayTotals(
  summary: ReadonlyArray<{
    plays: number;
    actualSec: number;
    expectedSec: number;
    bookedSec?: number;
    shortfallSec?: number;
  }>,
): ProofOfPlayTotals {
  let totalPlays = 0;
  let totalActualSec = 0;
  let totalExpectedSec = 0;
  let totalBookedSec = 0;
  let totalShortfallSec = 0;
  for (const row of summary) {
    totalBookedSec += row.bookedSec || 0;
    totalShortfallSec += row.shortfallSec || 0;
    totalPlays += row.plays || 0;
    totalActualSec += row.actualSec || 0;
    totalExpectedSec += row.expectedSec || 0;
  }
  const avgFulfillmentPercent =
    totalExpectedSec > 0 ? Math.round((totalActualSec / totalExpectedSec) * 100) : 0;
  return {
    totalPlays,
    totalActualSec,
    totalExpectedSec,
    avgFulfillmentPercent,
    totalBookedSec,
    totalShortfallSec,
  };
}
