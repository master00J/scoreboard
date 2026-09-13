import type { TFunction } from "i18next";
import { describePeriod, getSportProfile, sportBreakLabel, sportPeriodLabel } from "../sports";

function tOr(t: TFunction, key: string, fallback: string, params?: Record<string, unknown>): string {
  const translated = params ? t(key, params) : t(key);
  return translated === key ? fallback : translated;
}

/** Sportnaam in de UI-taal ("Voetbal" / "Football" / …). */
export function tSportLabel(t: TFunction, sport: unknown): string {
  const profile = getSportProfile(sport);
  return tOr(t, `sports.${profile.id}`, profile.label);
}

/** Periodesoort ("Helft", "Quarter", "Set") in de UI-taal. */
export function tPeriodLabel(t: TFunction, sport: unknown): string {
  const profile = getSportProfile(sport);
  return tOr(t, `sports.periodLabel.${profile.id}`, profile.periodLabel);
}

/** Teamfouten/straffen-label of null als de sport geen teller heeft. */
export function tStatLabel(t: TFunction, sport: unknown): string | null {
  const profile = getSportProfile(sport);
  if (!profile.statLabel) return null;
  return tOr(t, `sports.statLabel.${profile.id}`, profile.statLabel);
}

export function tScoreLabel(t: TFunction, sport: unknown): string {
  const profile = getSportProfile(sport);
  return tOr(t, `sports.scoreLabel.${profile.id}`, profile.scoreLabel);
}

/** Knoplabel voor een periode in het bedieningspaneel: "Quarter 3", "Set 2", "Verlenging 1". */
export function tPeriodButton(t: TFunction, sport: unknown, period: number): string {
  const d = describePeriod(sport, period);
  if (d.kind === "overtime") {
    const profile = getSportProfile(sport);
    return profile.maxOvertimePeriods > 1
      ? tOr(t, "sports.overtimeN", `Verlenging ${d.index}`, { n: d.index })
      : tOr(t, "sports.overtime", "Verlenging");
  }
  return `${tPeriodLabel(t, sport)} ${d.index}`;
}

/** Periodenaam voor het stadionscherm (hoofdletters): "1E HELFT", "QUARTER 3", "SET 2", "VERLENGING". */
export function tPeriodName(t: TFunction, sport: unknown, period: number): string {
  const d = describePeriod(sport, period);
  const fallback = sportPeriodLabel(sport, period);
  switch (d.kind) {
    case "half":
      return tOr(t, d.index === 1 ? "scoreboard.half1" : "scoreboard.half2", fallback);
    case "overtime": {
      const profile = getSportProfile(sport);
      return profile.maxOvertimePeriods > 1
        ? tOr(t, "scoreboard.overtimeN", fallback, { n: d.index })
        : tOr(t, "scoreboard.overtime", fallback);
    }
    case "quarter":
      return tOr(t, "scoreboard.quarterN", fallback, { n: d.index });
    case "set":
      return tOr(t, "scoreboard.setN", fallback, { n: d.index });
    default:
      return tOr(t, "scoreboard.periodN", fallback, { n: d.index });
  }
}

/** Pauzelabel voor het stadionscherm: "RUST", "PERIODEPAUZE", "SETBREAK". */
export function tBreakName(t: TFunction, sport: unknown): string {
  const profile = getSportProfile(sport);
  return tOr(t, `scoreboard.break_${profile.id}`, sportBreakLabel(sport));
}

/** Korte scorebord-tekst met Nederlandse fallback. */
export function tBoard(t: TFunction, key: string, fallback: string, params?: Record<string, unknown>): string {
  return tOr(t, `scoreboard.${key}`, fallback, params);
}
