import type { MutableRefObject } from "react";
import type { Match, Sponsor } from "@/lib/types";
import {
  activeSponsorsForSection,
  buildSponsorSlotMap,
  sponsorScreenSecondsConsumed,
  sponsorSectionBudgetSeconds,
} from "@/lib/sponsor-distribution";

/**
 * Ruw rooster: slots + budget (zonder correctie bij tussentijdse budgetwijziging).
 *
 * @param matchPlayRosterSeconds — tijd op de sponsor-slotmap tijdens speelhelft / verlenging (sync met display,
 *   zie `effectiveMatchPlayRosterSeconds`).
 * @param prematchTimelineSec — voor prematch/setup: wedstrijdklok-seconden op dat segment.
 */
export function sponsorLiveProgressFromRosterRaw(
  sponsor: Sponsor,
  allSponsors: Sponsor[],
  match: Match,
  matchPlayRosterSeconds: number,
  halftimeTSec: number,
  prematchTimelineSec: number,
): { label: string; slotsUsed: number; budget: number; carryKey: string } | null {
  const status = match.status;
  if (status === "FIRST_HALF" || status === "SECOND_HALF" || status === "EXTRA_TIME") {
    const section = "match" as const;
    const active = activeSponsorsForSection(allSponsors, section, status);
    if (!active.some((s) => s.id === sponsor.id)) return null;
    const H = Math.max(60, match.halfDurationSec);
    const map = buildSponsorSlotMap(active, section, H, status);
    const t = matchPlayRosterSeconds;
    const budget = sponsorSectionBudgetSeconds(sponsor, section, status);
    const slotsUsed = sponsorScreenSecondsConsumed(
      map,
      allSponsors,
      section,
      status,
      t,
      sponsor.id,
    );
    const label =
      status === "FIRST_HALF"
        ? "1e helft (rooster)"
        : status === "SECOND_HALF"
          ? "2e helft (rooster)"
          : "Verlenging (rooster)";
    const carryKey = `${match.id}:match:${status}:${sponsor.id}`;
    return { label, slotsUsed, budget, carryKey };
  }
  if (status === "HALF_TIME") {
    const section = "halftime" as const;
    const active = activeSponsorsForSection(allSponsors, section);
    if (!active.some((s) => s.id === sponsor.id)) return null;
    const H = Math.max(60, match.halfBreakSec);
    const map = buildSponsorSlotMap(active, section, H);
    const t = halftimeTSec % H;
    const budget = sponsorSectionBudgetSeconds(sponsor, section);
    const slotsUsed = sponsorScreenSecondsConsumed(
      map,
      allSponsors,
      section,
      undefined,
      t,
      sponsor.id,
    );
    const carryKey = `${match.id}:halftime:${sponsor.id}`;
    const label = "Rust (rooster)";
    return { label, slotsUsed, budget, carryKey };
  }
  if (status === "PREMATCH" || status === "SETUP") {
    const section = "prematch" as const;
    const active = activeSponsorsForSection(allSponsors, section);
    if (!active.some((s) => s.id === sponsor.id)) return null;
    const budgetTotal = active.reduce(
      (a, s) => a + sponsorSectionBudgetSeconds(s, section),
      0,
    );
    const H = Math.max(60, budgetTotal);
    const map = buildSponsorSlotMap(active, section, H);
    const budget = sponsorSectionBudgetSeconds(sponsor, section);
    const slotsUsed =
      prematchTimelineSec >= H
        ? budget
        : sponsorScreenSecondsConsumed(
            map,
            allSponsors,
            section,
            undefined,
            prematchTimelineSec,
            sponsor.id,
          );
    const carryKey = `${match.id}:prematch:${sponsor.id}`;
    const label = "Prematch (rooster)";
    return { label, slotsUsed, budget, carryKey };
  }
  return null;
}

export type RosterCarry = {
  matchId: string;
  carryKey: string;
  budget: number;
  slotsCeiling: number | null;
  tAtCeiling: number;
  /** Monotonic floor: getoonde verbruikswaarde nooit terug laten springen binnen dezelfde fase. */
  consumedFloor: number;
  /** Laatst geziene tClock — gebruikt om reset/terugspring te detecteren. */
  lastTClock: number;
};

export function applyRosterBudgetCarry(
  ref: MutableRefObject<RosterCarry | null>,
  raw: { carryKey: string; budget: number; slotsUsed: number; matchId: string },
  tClock: number,
): { consumed: number; budget: number } {
  const { carryKey, budget, slotsUsed, matchId } = raw;
  let e = ref.current;

  /**
   * Match-reset of fase-terugspring: tClock viel terug onder de vorige stand.
   * Behandel alsof we voor het eerst in deze fase komen → alle state (en floor) wissen.
   */
  if (e && e.carryKey === carryKey && e.matchId === matchId && tClock + 0.25 < e.lastTClock) {
    e = null;
    ref.current = null;
  }

  if (!e || e.carryKey !== carryKey || e.matchId !== matchId) {
    const consumed = Math.min(budget, slotsUsed);
    ref.current = {
      matchId,
      carryKey,
      budget,
      slotsCeiling: null,
      tAtCeiling: tClock,
      consumedFloor: consumed,
      lastTClock: tClock,
    };
    return { consumed, budget };
  }
  if (budget < e.budget) {
    const consumed = Math.min(budget, slotsUsed);
    ref.current = {
      matchId,
      carryKey,
      budget,
      slotsCeiling: null,
      tAtCeiling: tClock,
      consumedFloor: Math.min(budget, consumed),
      lastTClock: tClock,
    };
    return { consumed, budget };
  }
  if (budget > e.budget) {
    const oldBudget = e.budget;
    const consumed = Math.min(budget, slotsUsed, oldBudget);
    const floor = Math.max(e.consumedFloor, consumed);
    ref.current = {
      matchId,
      carryKey,
      budget,
      slotsCeiling: oldBudget,
      tAtCeiling: tClock,
      consumedFloor: floor,
      lastTClock: tClock,
    };
    return { consumed: floor, budget };
  }
  if (e.slotsCeiling != null && tClock >= e.tAtCeiling + 1) {
    ref.current = {
      ...e,
      budget,
      slotsCeiling: null,
      tAtCeiling: tClock,
    };
    e = ref.current;
  }
  const rawConsumed = Math.min(budget, slotsUsed);
  let consumed = rawConsumed;
  if (e.slotsCeiling != null) {
    consumed = Math.min(rawConsumed, e.slotsCeiling);
  }
  /** Nooit zakken: zo blijft "30s" staan ook als de echte clip-gemeten tijd lager terug komt. */
  const floor = Math.max(e.consumedFloor, consumed);
  ref.current = { ...e, budget, consumedFloor: floor, lastTClock: tClock };
  return { consumed: floor, budget };
}
