import type { Match } from "./types";

/** Duur vóór kickoffAt waarin de matchsponsor automatisch fullscreen wordt getoond. */
export const PREMATCH_MATCH_SPONSOR_LEAD_MS = 5 * 60 * 1000;

type PrematchMatchPick =
  | (Pick<Match, "status" | "kickoffAt"> & { matchSponsorMediaId?: string | null })
  | null
  | undefined;

export function isPrematchMatchSponsorWindow(match: PrematchMatchPick, nowMs: number): boolean {
  if (!match?.kickoffAt || !match.matchSponsorMediaId) return false;
  if (match.status !== "SETUP" && match.status !== "PREMATCH") return false;
  const ko = new Date(match.kickoffAt).getTime();
  if (Number.isNaN(ko)) return false;
  const start = ko - PREMATCH_MATCH_SPONSOR_LEAD_MS;
  return nowMs >= start && nowMs < ko;
}
