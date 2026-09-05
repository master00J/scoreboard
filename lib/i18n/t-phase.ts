import type { TFunction } from "i18next";
import { getSportProfile } from "../sports";
import type { Match } from "../types";

/** Match-status → vertaalde fase-label (Setup / Prematch / …). */
export function tMatchStatus(t: TFunction, status: string | null | undefined): string {
  if (!status) return "";
  const key = `phases.${status}`;
  const translated = t(key);
  return translated === key ? status.replaceAll("_", " ") : translated;
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
  if (profile.id === "FOOTBALL" || profile.id === "FUTSAL") {
    if (n === 1) return t("sports.period.half1");
    if (n === 2) return t("sports.period.half2");
    return t("sports.period.extra");
  }
  if (profile.id === "VOLLEYBALL") return t("sports.period.set", { n });
  return t("sports.period.quarter", { n });
}

export function tSportPeriodName(t: TFunction, sport: unknown, period: number): string {
  const profile = getSportProfile(sport);
  const n = Math.max(1, Math.floor(period || 1));
  if (profile.id === "VOLLEYBALL") return t("sports.periodName.set", { n });
  if (profile.id === "BASKETBALL" || profile.id === "HOCKEY") return t("sports.periodName.quarter", { n });
  return t("sports.periodName.half", { n });
}

/** Periode op het scorebord / de widget: sportlabel tijdens speeltijd, anders de fase. */
export function tSportBreakLabel(t: TFunction, sport: unknown): string {
  const profile = getSportProfile(sport);
  if (profile.id === "FOOTBALL" || profile.id === "FUTSAL") return t("sports.break.half");
  if (profile.id === "VOLLEYBALL") return t("sports.break.set");
  return t("sports.break.period");
}

export function tMatchPeriod(t: TFunction, match: Pick<Match, "sport" | "status" | "currentPeriod"> | null): string {
  const status = match?.status;
  if (match && (status === "FIRST_HALF" || status === "SECOND_HALF" || status === "EXTRA_TIME")) {
    return tSportPeriodLabel(t, match.sport, match.currentPeriod);
  }
  if (!status) return t("sports.period.live");
  return tMatchStatus(t, status) || t("sports.period.live");
}
