export const SPORT_TYPES = [
  "FOOTBALL",
  "FUTSAL",
  "BASKETBALL",
  "VOLLEYBALL",
  "HOCKEY",
] as const;

export type SportType = (typeof SPORT_TYPES)[number];
export type SportTimerMode = "COUNT_UP" | "COUNT_DOWN" | "NONE";

export type SportProfile = {
  id: SportType;
  label: string;
  periodLabel: string;
  periodCount: number;
  timerMode: SportTimerMode;
  defaultPeriodDurationSec: number;
  scoreLabel: string;
  scoreIncrements: number[];
  timeoutLabel: string;
  timeoutLimitForPeriod: (period: number) => number;
  statLabel: string | null;
  statLimit: number | null;
  hasSets: boolean;
  shotClockPresets: number[];
  fieldPlayers: number;
};

const PROFILES: Record<SportType, SportProfile> = {
  FOOTBALL: {
    id: "FOOTBALL",
    label: "Voetbal",
    periodLabel: "Helft",
    periodCount: 2,
    timerMode: "COUNT_UP",
    defaultPeriodDurationSec: 45 * 60,
    scoreLabel: "Goal",
    scoreIncrements: [1],
    timeoutLabel: "Time-outs",
    timeoutLimitForPeriod: () => 0,
    statLabel: null,
    statLimit: null,
    hasSets: false,
    shotClockPresets: [],
    fieldPlayers: 11,
  },
  FUTSAL: {
    id: "FUTSAL",
    label: "Futsal",
    periodLabel: "Helft",
    periodCount: 2,
    timerMode: "COUNT_DOWN",
    defaultPeriodDurationSec: 20 * 60,
    scoreLabel: "Goal",
    scoreIncrements: [1],
    timeoutLabel: "Time-outs",
    timeoutLimitForPeriod: () => 1,
    statLabel: "Teamfouten",
    statLimit: 5,
    hasSets: false,
    shotClockPresets: [],
    fieldPlayers: 5,
  },
  BASKETBALL: {
    id: "BASKETBALL",
    label: "Basketbal",
    periodLabel: "Quarter",
    periodCount: 4,
    timerMode: "COUNT_DOWN",
    defaultPeriodDurationSec: 10 * 60,
    scoreLabel: "Punten",
    scoreIncrements: [1, 2, 3],
    timeoutLabel: "Time-outs",
    // FIBA: twee in de eerste helft, drie in de tweede helft.
    timeoutLimitForPeriod: (period) => (period <= 2 ? 2 : 3),
    statLabel: "Teamfouten",
    statLimit: 4,
    hasSets: false,
    shotClockPresets: [24, 14],
    fieldPlayers: 5,
  },
  VOLLEYBALL: {
    id: "VOLLEYBALL",
    label: "Volleybal",
    periodLabel: "Set",
    periodCount: 5,
    timerMode: "NONE",
    defaultPeriodDurationSec: 0,
    scoreLabel: "Punt",
    scoreIncrements: [1],
    timeoutLabel: "Time-outs",
    timeoutLimitForPeriod: () => 2,
    statLabel: null,
    statLimit: null,
    hasSets: true,
    shotClockPresets: [],
    fieldPlayers: 6,
  },
  HOCKEY: {
    id: "HOCKEY",
    label: "Hockey",
    periodLabel: "Quarter",
    periodCount: 4,
    timerMode: "COUNT_DOWN",
    defaultPeriodDurationSec: 15 * 60,
    scoreLabel: "Goal",
    scoreIncrements: [1],
    timeoutLabel: "Time-outs",
    timeoutLimitForPeriod: () => 0,
    statLabel: "Straffen",
    statLimit: null,
    hasSets: false,
    shotClockPresets: [],
    fieldPlayers: 11,
  },
};

export function normalizeSport(value: unknown): SportType {
  const normalized = String(value ?? "").trim().toUpperCase();
  return SPORT_TYPES.includes(normalized as SportType)
    ? (normalized as SportType)
    : "FOOTBALL";
}

export function getSportProfile(value: unknown): SportProfile {
  return PROFILES[normalizeSport(value)];
}

export function sportPeriodLabel(sport: unknown, period: number): string {
  const profile = getSportProfile(sport);
  const safePeriod = Math.max(1, Math.floor(period || 1));
  if (profile.id === "FOOTBALL" || profile.id === "FUTSAL") {
    return safePeriod === 1 ? "1E HELFT" : safePeriod === 2 ? "2E HELFT" : "VERLENGING";
  }
  if (profile.id === "VOLLEYBALL") return `SET ${safePeriod}`;
  return `${profile.periodLabel.toUpperCase()} ${safePeriod}`;
}

/**
 * De bestaande sponsorlogica groepeert live speeltijd in een eerste en tweede
 * helft. Periodes worden daar compatibel op geprojecteerd; het display gebruikt
 * `currentPeriod` voor de echte sportspecifieke benaming.
 */
export function lifecycleStatusForPeriod(sport: unknown, period: number): "FIRST_HALF" | "SECOND_HALF" | "EXTRA_TIME" {
  const profile = getSportProfile(sport);
  const safePeriod = Math.max(1, Math.floor(period || 1));
  if (safePeriod > profile.periodCount) return "EXTRA_TIME";
  if (profile.periodCount <= 2) return safePeriod === 1 ? "FIRST_HALF" : "SECOND_HALF";
  return safePeriod <= Math.ceil(profile.periodCount / 2) ? "FIRST_HALF" : "SECOND_HALF";
}

export function sportClockSeconds(
  sport: unknown,
  elapsedSec: number,
  periodDurationSec?: number | null,
): number {
  const profile = getSportProfile(sport);
  const elapsed = Math.max(0, elapsedSec);
  if (profile.timerMode !== "COUNT_DOWN") return elapsed;
  const duration = Math.max(
    0,
    Number.isFinite(periodDurationSec) ? Number(periodDurationSec) : profile.defaultPeriodDurationSec,
  );
  return Math.max(0, duration - elapsed);
}

export function sportHasMainClock(sport: unknown): boolean {
  return getSportProfile(sport).timerMode !== "NONE";
}

export function sportBreakLabel(sport: unknown): string {
  const profile = getSportProfile(sport);
  if (profile.id === "FOOTBALL" || profile.id === "FUTSAL") return "RUST";
  if (profile.id === "VOLLEYBALL") return "SETBREAK";
  return "PERIODEPAUZE";
}

export function resetTimeoutsForNewPeriod(
  sport: unknown,
  previousPeriod: number,
  nextPeriod: number,
): boolean {
  const profile = getSportProfile(sport);
  if (profile.id === "BASKETBALL") {
    return (previousPeriod <= 2) !== (nextPeriod <= 2);
  }
  return profile.timeoutLimitForPeriod(nextPeriod) > 0;
}

export function resetStatsForNewPeriod(sport: unknown): boolean {
  return getSportProfile(sport).statLabel !== null;
}
