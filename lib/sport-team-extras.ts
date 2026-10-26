import type { Match } from "./types";
import { getSportProfile } from "./sports";
import { normalizeServingSide } from "./volleyball";

export type SportTeamExtraChip =
  | { kind: "possession"; text: "◀" | "▶" }
  | { kind: "serve"; text: "Serve" }
  | { kind: "sets"; text: string }
  | { kind: "timeouts"; text: string }
  | { kind: "fouls"; text: string }
  | { kind: "bonus"; text: string };

export function sportTeamExtraChips(match: Match, side: "home" | "away"): SportTeamExtraChip[] {
  const profile = getSportProfile(match.sport);
  const timeouts = side === "home" ? match.homeTimeouts : match.awayTimeouts;
  const fouls = side === "home" ? match.homeFouls : match.awayFouls;
  const sets = side === "home" ? match.homeSets : match.awaySets;
  const chips: SportTeamExtraChip[] = [];
  if (profile.supportsPossessionArrow && match.possessionArrow === side) {
    chips.push({ kind: "possession", text: side === "home" ? "◀" : "▶" });
  }
  if (profile.hasSets && normalizeServingSide(match.servingSide) === side) {
    chips.push({ kind: "serve", text: "Serve" });
  }
  if (profile.hasSets) chips.push({ kind: "sets", text: `Sets ${sets}` });
  if (profile.timeoutLimitForPeriod(1) > 0) {
    chips.push({
      kind: "timeouts",
      text: `TO ${timeouts}/${profile.timeoutLimitForPeriod(match.currentPeriod || 1)}`,
    });
  }
  if (profile.statLabel) chips.push({ kind: "fouls", text: `F ${fouls}` });
  if (profile.foulBonusFrom != null && fouls >= profile.foulBonusFrom) {
    chips.push({ kind: "bonus", text: profile.id === "FUTSAL" ? "PK" : "BONUS" });
  }
  return chips;
}

export function sportTeamExtrasCharCount(chips: SportTeamExtraChip[]): number {
  return chips.reduce((sum, chip, index) => sum + chip.text.length + (index > 0 ? 1 : 0), 0);
}

/** Eén regel in het vak: niet wrappen, letters niet afbreken. */
export function sportTeamExtrasFitFontSize(charCount: number, compact: boolean): string {
  const perChar = Math.min(12, Math.max(3.4, 88 / Math.max(1, charCount)));
  if (compact) return `min(14cqh, ${perChar.toFixed(1)}cqw, 22px)`;
  return `min(28cqh, ${perChar.toFixed(1)}cqw, 42px)`;
}
