import type { TFunction } from "i18next";
import { getSportProfile, isOvertimePeriod, periodForLifecycleStatus, sportSponsorBlockLabel } from "../sports";
import type { Match } from "../types";

/** Match-status → vertaalde fase-label (Setup / Prematch / …), sport-aware. */
export function tMatchStatus(
  t: TFunction,
  status: string | null | undefined,
  sport?: unknown,
): string {
  if (!status) return "";
  if (sport != null) {
    const profile = getSportProfile(sport);
    if (status === "HALF_TIME") {
      const key = `phases.break_${profile.id}`;
      const translated = t(key);
      if (translated !== key) return translated;
    }
    if (status === "FIRST_HALF") {
      const key = `phases.blockA_${profile.id}`;
      const translated = t(key);
      if (translated !== key) return translated;
    }
    if (status === "SECOND_HALF") {
      const key = `phases.blockB_${profile.id}`;
      const translated = t(key);
      if (translated !== key) return translated;
    }
  }
  const key = `phases.${status}`;
  const translated = t(key);
  return translated === key ? status.replaceAll("_", " ") : translated;
}

export function tSponsorBlock(
  t: TFunction,
  sport: unknown,
  block: "h1" | "h2" | "halftime",
): string {
  const profile = getSportProfile(sport);
  const key =
    block === "halftime"
      ? `phases.break_${profile.id}`
      : block === "h1"
        ? `phases.blockA_${profile.id}`
        : `phases.blockB_${profile.id}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return sportSponsorBlockLabel(sport, block);
}

/** Woord voor het geplande begin: aftrap (voetbal) vs start (andere sporten). */
export function tSportStartEvent(t: TFunction, sport: unknown): string {
  const id = getSportProfile(sport).id;
  const key = `sports.startEvent.${id}`;
  const translated = t(key);
  return translated === key ? t("sports.startEvent.default") : translated;
}

export function sportStartEventVars(t: TFunction, sport: unknown): { start: string; Start: string } {
  const start = tSportStartEvent(t, sport);
  const Start = start ? start.charAt(0).toUpperCase() + start.slice(1) : start;
  return { start, Start };
}

export function tSportLabel(t: TFunction, sport: string | null | undefined, fallback?: string): string {
  if (!sport) return fallback ?? "";
  const key = `sports.${sport}`;
  const translated = t(key);
  return translated === key ? fallback ?? sport : translated;
}

export function tSportPeriodLabel(t: TFunction, sport: unknown, period: number): string {
  const profile = getSportProfile(sport);
  const n = Math.max(1, Math.floor(period || 1));
  if (isOvertimePeriod(sport, n)) {
    const extra = t("sports.period.extra");
    const index = n - profile.periodCount;
    return profile.maxOvertimePeriods > 1 ? `${extra} ${index}` : extra;
  }
  if (profile.id === "FOOTBALL" || profile.id === "FUTSAL") {
    if (n === 1) return t("sports.period.half1");
    return t("sports.period.half2");
  }
  if (profile.id === "VOLLEYBALL") return t("sports.period.set", { n });
  return t("sports.period.quarter", { n });
}

export function tSportPeriodName(t: TFunction, sport: unknown, period: number): string {
  const profile = getSportProfile(sport);
  const n = Math.max(1, Math.floor(period || 1));
  if (isOvertimePeriod(sport, n)) {
    const index = n - profile.periodCount;
    return profile.maxOvertimePeriods > 1
      ? t("sports.overtimeN", { n: index })
      : t("sports.overtime");
  }
  if (profile.id === "VOLLEYBALL") return t("sports.periodName.set", { n });
  if (profile.id === "BASKETBALL" || profile.id === "HOCKEY") return t("sports.periodName.quarter", { n });
  return t("sports.periodName.half", { n });
}

export function tSportBreakLabel(t: TFunction, sport: unknown): string {
  const profile = getSportProfile(sport);
  if (profile.id === "FOOTBALL" || profile.id === "FUTSAL") return t("sports.break.half");
  if (profile.id === "VOLLEYBALL") return t("sports.break.set");
  return t("sports.break.period");
}

/** Periode op het scorebord / de widget: sportlabel tijdens speeltijd, anders de fase. */
export function tMatchPeriod(t: TFunction, match: Pick<Match, "sport" | "status" | "currentPeriod"> | null): string {
  const status = match?.status;
  if (match && (status === "FIRST_HALF" || status === "SECOND_HALF" || status === "EXTRA_TIME")) {
    const period = periodForLifecycleStatus(match.sport, status, match.currentPeriod);
    return tSportPeriodLabel(t, match.sport, period);
  }
  if (!status) return t("sports.period.live");
  return tMatchStatus(t, status, match?.sport) || t("sports.period.live");
}
