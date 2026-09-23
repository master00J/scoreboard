export const SPORT_TYPES = [
  "FOOTBALL",
  "FUTSAL",
  "BASKETBALL",
  "VOLLEYBALL",
  "HOCKEY",
] as const;

export type SportType = (typeof SPORT_TYPES)[number];
export type SportTimerMode = "COUNT_UP" | "COUNT_DOWN" | "NONE";
export type SportCardColor = "YELLOW" | "RED" | "GREEN";

export type SportProfile = {
  id: SportType;
  /** Nederlandse fallback; UI gebruikt `tSportLabel` (lib/i18n/t-phase). */
  label: string;
  /** Nederlandse fallback; UI gebruikt `tPeriodLabel`. */
  periodLabel: string;
  periodCount: number;
  timerMode: SportTimerMode;
  defaultPeriodDurationSec: number;
  /** Duur van één verlengingsperiode (0 = geen verlenging voor deze sport). */
  overtimeDurationSec: number;
  /** Aantal verlengingsperiodes dat na de reguliere periodes mag volgen. */
  maxOvertimePeriods: number;
  /** Hoofdpauze (rust) in seconden; overschrijfbaar per wedstrijd via `Match.halfBreakSec`. */
  breakDurationSec: number;
  /** Korte pauze tussen andere periodes (quarterpauze, setbreak). */
  shortBreakDurationSec: number;
  /** Na welke periode de hoofdpauze valt; null = alle pauzes even lang (volleybal). */
  mainBreakAfterPeriod: number | null;
  /** Aftellende klok toont tienden onder de laatste minuut (FIBA). */
  tenthsUnderMinute: boolean;
  scoreLabel: string;
  scoreIncrements: number[];
  timeoutLabel: string;
  timeoutLimitForPeriod: (period: number) => number;
  timeoutDurationSec: number;
  statLabel: string | null;
  statLimit: number | null;
  /** Highlight teamfouten/straffen vanaf dit aantal (basket bonus, futsal 10 m). */
  foulBonusFrom: number | null;
  hasSets: boolean;
  shotClockPresets: number[];
  penaltyClockPresets: number[];
  /** Straftijd loopt alleen als de wedstrijdklok loopt (hockey). */
  penaltyFollowsClock: boolean;
  fieldPlayers: number;
  supportsCards: boolean;
  cardColors: SportCardColor[];
  supportsGoalVisuals: boolean;
  supportsInjuryTime: boolean;
  supportsSubstitutions: boolean;
  /** FIBA wisselend balbezit: pijl op het scherm naar het team dat de volgende AP-inworp krijgt. */
  supportsPossessionArrow: boolean;
  clockVisibleOnDisplay: boolean;
  pointsToWinRegular: number | null;
  pointsToWinDecider: number | null;
  winBy: number;
  setsToWinMatch: number;
  technicalTimeoutScores: number[];
};

const PROFILES: Record<SportType, SportProfile> = {
  FOOTBALL: {
    id: "FOOTBALL",
    label: "Voetbal",
    periodLabel: "Helft",
    periodCount: 2,
    timerMode: "COUNT_UP",
    defaultPeriodDurationSec: 45 * 60,
    overtimeDurationSec: 15 * 60,
    maxOvertimePeriods: 2,
    breakDurationSec: 15 * 60,
    shortBreakDurationSec: 15 * 60,
    mainBreakAfterPeriod: 1,
    tenthsUnderMinute: false,
    scoreLabel: "Goal",
    scoreIncrements: [1],
    timeoutLabel: "Time-outs",
    timeoutLimitForPeriod: () => 0,
    timeoutDurationSec: 0,
    statLabel: null,
    statLimit: null,
    foulBonusFrom: null,
    hasSets: false,
    shotClockPresets: [],
    penaltyClockPresets: [],
    penaltyFollowsClock: false,
    fieldPlayers: 11,
    supportsCards: true,
    cardColors: ["YELLOW", "RED"],
    supportsGoalVisuals: true,
    supportsInjuryTime: true,
    supportsSubstitutions: true,
    supportsPossessionArrow: false,
    clockVisibleOnDisplay: true,
    pointsToWinRegular: null,
    pointsToWinDecider: null,
    winBy: 0,
    setsToWinMatch: 0,
    technicalTimeoutScores: [],
  },
  FUTSAL: {
    id: "FUTSAL",
    label: "Futsal",
    periodLabel: "Helft",
    periodCount: 2,
    timerMode: "COUNT_DOWN",
    defaultPeriodDurationSec: 20 * 60,
    overtimeDurationSec: 5 * 60,
    maxOvertimePeriods: 2,
    breakDurationSec: 10 * 60,
    shortBreakDurationSec: 10 * 60,
    mainBreakAfterPeriod: 1,
    tenthsUnderMinute: false,
    scoreLabel: "Goal",
    scoreIncrements: [1],
    timeoutLabel: "Time-outs",
    /** 1 time-out per helft; geen time-outs in de verlenging (FIFA Futsal Laws). */
    timeoutLimitForPeriod: (period) => (period <= 2 ? 1 : 0),
    timeoutDurationSec: 60,
    statLabel: "Teamfouten",
    statLimit: 5,
    foulBonusFrom: 5,
    hasSets: false,
    shotClockPresets: [],
    penaltyClockPresets: [],
    penaltyFollowsClock: false,
    fieldPlayers: 5,
    supportsCards: true,
    cardColors: ["YELLOW", "RED"],
    supportsGoalVisuals: true,
    supportsInjuryTime: false,
    supportsSubstitutions: true,
    supportsPossessionArrow: false,
    clockVisibleOnDisplay: true,
    pointsToWinRegular: null,
    pointsToWinDecider: null,
    winBy: 0,
    setsToWinMatch: 0,
    technicalTimeoutScores: [],
  },
  BASKETBALL: {
    id: "BASKETBALL",
    label: "Basketbal",
    periodLabel: "Quarter",
    periodCount: 4,
    timerMode: "COUNT_DOWN",
    defaultPeriodDurationSec: 10 * 60,
    overtimeDurationSec: 5 * 60,
    maxOvertimePeriods: 5,
    breakDurationSec: 15 * 60,
    shortBreakDurationSec: 2 * 60,
    mainBreakAfterPeriod: 2,
    tenthsUnderMinute: true,
    scoreLabel: "Punten",
    scoreIncrements: [1, 2, 3],
    timeoutLabel: "Time-outs",
    /** FIBA: 2 in de eerste helft, 3 in de tweede helft, 1 per verlenging. */
    timeoutLimitForPeriod: (period) => (period > 4 ? 1 : period <= 2 ? 2 : 3),
    timeoutDurationSec: 60,
    statLabel: "Teamfouten",
    statLimit: 4,
    foulBonusFrom: 4,
    hasSets: false,
    shotClockPresets: [24, 14],
    penaltyClockPresets: [],
    penaltyFollowsClock: false,
    fieldPlayers: 5,
    supportsCards: false,
    cardColors: [],
    supportsGoalVisuals: false,
    supportsInjuryTime: false,
    supportsSubstitutions: true,
    supportsPossessionArrow: true,
    clockVisibleOnDisplay: true,
    pointsToWinRegular: null,
    pointsToWinDecider: null,
    winBy: 0,
    setsToWinMatch: 0,
    technicalTimeoutScores: [],
  },
  VOLLEYBALL: {
    id: "VOLLEYBALL",
    label: "Volleybal",
    periodLabel: "Set",
    periodCount: 5,
    timerMode: "NONE",
    defaultPeriodDurationSec: 0,
    overtimeDurationSec: 0,
    maxOvertimePeriods: 0,
    breakDurationSec: 3 * 60,
    shortBreakDurationSec: 3 * 60,
    mainBreakAfterPeriod: null,
    tenthsUnderMinute: false,
    scoreLabel: "Punt",
    scoreIncrements: [1],
    timeoutLabel: "Time-outs",
    timeoutLimitForPeriod: () => 2,
    timeoutDurationSec: 30,
    statLabel: null,
    statLimit: null,
    foulBonusFrom: null,
    hasSets: true,
    shotClockPresets: [],
    penaltyClockPresets: [],
    penaltyFollowsClock: false,
    fieldPlayers: 6,
    supportsCards: false,
    cardColors: [],
    supportsGoalVisuals: false,
    supportsInjuryTime: false,
    supportsSubstitutions: true,
    supportsPossessionArrow: false,
    clockVisibleOnDisplay: false,
    pointsToWinRegular: 25,
    pointsToWinDecider: 15,
    winBy: 2,
    setsToWinMatch: 3,
    technicalTimeoutScores: [8, 16],
  },
  HOCKEY: {
    id: "HOCKEY",
    label: "Hockey",
    periodLabel: "Quarter",
    periodCount: 4,
    timerMode: "COUNT_DOWN",
    defaultPeriodDurationSec: 15 * 60,
    /** FIH: bij gelijkspel volgt een shoot-out, geen verlenging. */
    overtimeDurationSec: 0,
    maxOvertimePeriods: 0,
    breakDurationSec: 10 * 60,
    shortBreakDurationSec: 2 * 60,
    mainBreakAfterPeriod: 2,
    tenthsUnderMinute: false,
    scoreLabel: "Goal",
    scoreIncrements: [1],
    timeoutLabel: "Time-outs",
    timeoutLimitForPeriod: () => 0,
    timeoutDurationSec: 0,
    statLabel: "Straffen",
    statLimit: null,
    foulBonusFrom: null,
    hasSets: false,
    shotClockPresets: [],
    penaltyClockPresets: [120, 300],
    penaltyFollowsClock: true,
    fieldPlayers: 11,
    supportsCards: true,
    cardColors: ["GREEN", "YELLOW", "RED"],
    supportsGoalVisuals: true,
    supportsInjuryTime: false,
    supportsSubstitutions: true,
    supportsPossessionArrow: false,
    clockVisibleOnDisplay: true,
    pointsToWinRegular: null,
    pointsToWinDecider: null,
    winBy: 0,
    setsToWinMatch: 0,
    technicalTimeoutScores: [],
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

/** Hoogste periode die `sport:setPeriod` accepteert (regulier + verlengingen). */
export function sportMaxPeriod(sport: unknown): number {
  const profile = getSportProfile(sport);
  return profile.periodCount + (profile.overtimeDurationSec > 0 ? profile.maxOvertimePeriods : 0);
}

export function isOvertimePeriod(sport: unknown, period: number): boolean {
  return Math.floor(period || 1) > getSportProfile(sport).periodCount;
}

export type PeriodDescriptor =
  | { kind: "half"; index: 1 | 2 }
  | { kind: "quarter"; index: number }
  | { kind: "set"; index: number }
  | { kind: "period"; index: number }
  | { kind: "overtime"; index: number };

/** Sport-neutrale beschrijving van een periode; UI vertaalt via `tPeriodName`. */
export function describePeriod(sport: unknown, period: number): PeriodDescriptor {
  const profile = getSportProfile(sport);
  const safePeriod = Math.max(1, Math.floor(period || 1));
  if (safePeriod > profile.periodCount) {
    return { kind: "overtime", index: safePeriod - profile.periodCount };
  }
  if (profile.id === "FOOTBALL" || profile.id === "FUTSAL") {
    return { kind: "half", index: safePeriod === 1 ? 1 : 2 };
  }
  if (profile.id === "VOLLEYBALL") return { kind: "set", index: safePeriod };
  if (profile.id === "BASKETBALL" || profile.id === "HOCKEY") {
    return { kind: "quarter", index: safePeriod };
  }
  return { kind: "period", index: safePeriod };
}

/** Nederlandse fallback (logs, exports). Display/control gebruiken `tPeriodName`. */
export function sportPeriodLabel(sport: unknown, period: number): string {
  const d = describePeriod(sport, period);
  switch (d.kind) {
    case "half":
      return d.index === 1 ? "1E HELFT" : "2E HELFT";
    case "overtime":
      return getSportProfile(sport).maxOvertimePeriods > 1 ? `VERLENGING ${d.index}` : "VERLENGING";
    case "set":
      return `SET ${d.index}`;
    case "quarter":
      return `QUARTER ${d.index}`;
    default:
      return `PERIODE ${d.index}`;
  }
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

/** Omgekeerde projectie: status → periode wanneer een client alleen een status stuurt (voetbalflow, mobiel). */
export function periodForLifecycleStatus(
  sport: unknown,
  status: string,
  currentPeriod: number,
): number {
  const profile = getSportProfile(sport);
  const current = Math.max(1, Math.floor(currentPeriod || 1));
  switch (status) {
    case "FIRST_HALF":
      return profile.periodCount <= 2 ? 1 : Math.min(current, Math.ceil(profile.periodCount / 2));
    case "SECOND_HALF": {
      const firstOfSecond = profile.periodCount <= 2 ? 2 : Math.ceil(profile.periodCount / 2) + 1;
      if (current >= firstOfSecond && current <= profile.periodCount) return current;
      return firstOfSecond;
    }
    case "EXTRA_TIME":
      return current > profile.periodCount ? current : profile.periodCount + 1;
    default:
      return current;
  }
}

/** Effectieve periodeduur: reguliere periode uit de match, verlenging uit het profiel. */
export function periodDurationSecFor(
  sport: unknown,
  period: number,
  periodDurationSec?: number | null,
): number {
  const profile = getSportProfile(sport);
  if (isOvertimePeriod(sport, period)) return profile.overtimeDurationSec;
  const configured = Number(periodDurationSec);
  return Number.isFinite(configured) && configured > 0 ? configured : profile.defaultPeriodDurationSec;
}

export function sportClockSeconds(
  sport: unknown,
  elapsedSec: number,
  periodDurationSec?: number | null,
  period: number = 1,
): number {
  const profile = getSportProfile(sport);
  const elapsed = Math.max(0, elapsedSec);
  if (profile.timerMode !== "COUNT_DOWN") return elapsed;
  const duration = Math.max(0, periodDurationSecFor(sport, period, periodDurationSec));
  return Math.max(0, duration - elapsed);
}

/**
 * Kloktekst per sport. Aftellend: naar boven afgerond (00:01 tot de klok echt op nul staat),
 * met tienden onder de laatste minuut waar de sport dat vraagt. Optellend: naar beneden.
 */
export function formatSportClock(sport: unknown, seconds: number): string {
  const profile = getSportProfile(sport);
  const value = Math.max(0, seconds);
  if (profile.timerMode === "COUNT_DOWN") {
    if (profile.tenthsUnderMinute && value < 60) {
      const tenths = Math.ceil(value * 10 - 1e-9);
      const whole = Math.floor(tenths / 10);
      const frac = tenths % 10;
      return `${whole}.${frac}`;
    }
    const s = Math.ceil(value - 1e-9);
    const mm = Math.floor(s / 60).toString().padStart(2, "0");
    const ss = (s % 60).toString().padStart(2, "0");
    return `${mm}:${ss}`;
  }
  const s = Math.floor(value);
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

/**
 * Shotclocktekst. Onder 5 seconden in tienden (naar boven), zodat 0.3, 0.2 en 0.1
 * afleesbaar blijven. Daarboven hele seconden, ook naar boven.
 */
export function formatShotClock(seconds: number): string {
  const value = Math.max(0, seconds);
  if (value < 5) {
    const tenths = Math.ceil(value * 10 - 1e-9);
    const whole = Math.floor(tenths / 10);
    const frac = tenths % 10;
    return `${whole}.${frac}`;
  }
  return String(Math.ceil(value - 1e-9));
}

/** FIBA 50.5: bij nieuw balbezit en minder dan 14s op de wedstrijdklok gaat de shotclock uit. */
export const FIBA_SHOT_CLOCK_OFF_BELOW_SEC = 14;

export function newShotClockSuppressed(sport: unknown, gameClockRemainingSec: number): boolean {
  const profile = getSportProfile(sport);
  if (profile.shotClockPresets.length === 0 || profile.timerMode !== "COUNT_DOWN") return false;
  return gameClockRemainingSec < FIBA_SHOT_CLOCK_OFF_BELOW_SEC;
}

/** FIBA 18.2.5: in Q4 tellen maximaal 2 van de time-outs mee zodra de klok 2:00 of minder toont. */
export const BASKETBALL_Q4_LATE_WINDOW_SEC = 120;
export const BASKETBALL_Q4_LATE_TIMEOUT_MAX = 2;

export function basketballLateTimeoutCounts(
  sport: unknown,
  period: number,
  gameClockRemainingSec: number,
): boolean {
  const profile = getSportProfile(sport);
  if (profile.id !== "BASKETBALL") return false;
  if (Math.floor(period || 1) !== profile.periodCount) return false;
  return gameClockRemainingSec <= BASKETBALL_Q4_LATE_WINDOW_SEC;
}

export function basketballLateTimeoutBlocked(input: {
  sport: unknown;
  period: number;
  gameClockRemainingSec: number;
  lateTimeoutsUsed: number;
}): boolean {
  if (!basketballLateTimeoutCounts(input.sport, input.period, input.gameClockRemainingSec)) return false;
  return input.lateTimeoutsUsed >= BASKETBALL_Q4_LATE_TIMEOUT_MAX;
}

/** Zoemer 30s vóór Q2, Q4 en elke verlenging (niet vóór de grote rust). */
export function breakWarnsAtThirtySeconds(sport: unknown, endedPeriod: number): boolean {
  const profile = getSportProfile(sport);
  if (profile.id !== "BASKETBALL") return false;
  const next = Math.floor(endedPeriod || 1) + 1;
  if (next === 2 || next === profile.periodCount) return true;
  return next > profile.periodCount && profile.overtimeDurationSec > 0;
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

/** Groepering van time-outbudgetten: wisselt de groep, dan reset de teller. */
export function timeoutGroupForPeriod(sport: unknown, period: number): string {
  const profile = getSportProfile(sport);
  const safePeriod = Math.max(1, Math.floor(period || 1));
  if (profile.id === "BASKETBALL") {
    if (safePeriod > profile.periodCount) return `ot${safePeriod}`;
    return safePeriod <= 2 ? "h1" : "h2";
  }
  return `p${safePeriod}`;
}

export function resetTimeoutsForNewPeriod(
  sport: unknown,
  previousPeriod: number,
  nextPeriod: number,
): boolean {
  const profile = getSportProfile(sport);
  if (profile.timeoutLimitForPeriod(nextPeriod) <= 0) return false;
  return timeoutGroupForPeriod(sport, previousPeriod) !== timeoutGroupForPeriod(sport, nextPeriod);
}

/**
 * Teamfouten resetten bij een nieuwe reguliere periode (basket per quarter, futsal per helft).
 * In de verlenging lopen de fouten van de laatste reguliere periode door (FIBA / FIFA Futsal).
 * Hockey-straffen zijn een wedstrijdteller en resetten nooit.
 */
export function resetStatsForNewPeriod(
  sport: unknown,
  previousPeriod: number,
  nextPeriod: number,
): boolean {
  const profile = getSportProfile(sport);
  if (!profile.statLabel) return false;
  if (profile.id === "HOCKEY") return false;
  if (nextPeriod === previousPeriod) return false;
  return nextPeriod <= profile.periodCount;
}

/** Sponsor-kolom A/B: helften, of geprojecteerde periodes (sets 1–3 / 4–5). */
export function sportSponsorBlockLabel(sport: unknown, block: "h1" | "h2" | "halftime"): string {
  const profile = getSportProfile(sport);
  if (block === "halftime") return sportBreakLabel(sport);
  if (profile.id === "VOLLEYBALL") return block === "h1" ? "SETS 1–3" : "SETS 4–5";
  if (profile.periodCount > 2) return block === "h1" ? "Q1–2" : "Q3–4";
  return block === "h1" ? "1E" : "2E";
}

export function resolveDisplayShowClock(sport: unknown, themeShowClock: boolean): boolean {
  return getSportProfile(sport).clockVisibleOnDisplay && themeShowClock;
}

/**
 * Duur van de pauze waarin de wedstrijd zich (bij HALF_TIME) bevindt: hoofdpauze uit de match
 * (`halfBreakSec`, default per sport) of de korte periodepauze uit het profiel. Voor klok-sporten is
 * `currentPeriod` bij HALF_TIME de net afgesloten periode; bij volleybal zijn alle setbreaks even lang.
 */
export function matchBreakDurationSec(match: {
  sport: unknown;
  currentPeriod?: number | null;
  halfBreakSec?: number | null;
  shortBreakSec?: number | null;
}): number {
  const profile = getSportProfile(match.sport);
  const configured = Number(match.halfBreakSec);
  const main = Number.isFinite(configured) && configured > 0 ? configured : profile.breakDurationSec;
  const shortConfigured = Number(match.shortBreakSec);
  const short =
    Number.isFinite(shortConfigured) && shortConfigured > 0 ? shortConfigured : profile.shortBreakDurationSec;
  if (profile.mainBreakAfterPeriod == null) return Math.max(30, main);
  const period = Math.max(1, Math.floor(Number(match.currentPeriod) || 1));
  return Math.max(60, period === profile.mainBreakAfterPeriod ? main : short);
}

/** Pauze die start wanneer `endedPeriod` op 0 komt (Q1 → 2 min, Q2 → rust, Q4 → 2 min vóór OT). */
export function basketballIntervalBreak(match: {
  sport: unknown;
  currentPeriod?: number | null;
  halfBreakSec?: number | null;
  shortBreakSec?: number | null;
}): { seconds: number; warnAt30: boolean } | null {
  if (getSportProfile(match.sport).id !== "BASKETBALL") return null;
  const ended = Math.max(1, Math.floor(Number(match.currentPeriod) || 1));
  return {
    seconds: matchBreakDurationSec({ ...match, currentPeriod: ended }),
    warnAt30: breakWarnsAtThirtySeconds(match.sport, ended),
  };
}

/** Hoogste speelperiode voor deze wedstrijd (volleybal: best-of via `setsToWin`). */
export function sportMaxPeriodForMatch(match: { sport: unknown; setsToWin?: number | null }): number {
  const profile = getSportProfile(match.sport);
  if (profile.hasSets) {
    const raw = Number(match.setsToWin);
    const setsToWin =
      Number.isFinite(raw) && raw > 0 ? Math.min(5, Math.max(1, Math.floor(raw))) : profile.setsToWinMatch || 3;
    return setsToWin * 2 - 1;
  }
  return sportMaxPeriod(match.sport);
}

export function timeoutLimitForMatch(match: {
  sport: unknown;
  currentPeriod: number;
  timeoutsPerSet?: number | null;
}): number {
  const profile = getSportProfile(match.sport);
  if (profile.hasSets) {
    const raw = Number(match.timeoutsPerSet);
    if (Number.isFinite(raw)) return Math.max(0, Math.min(6, Math.floor(raw)));
  }
  return profile.timeoutLimitForPeriod(match.currentPeriod);
}

export function timeoutDurationSecForMatch(match: {
  sport: unknown;
  timeoutDurationSec?: number | null;
}): number {
  const profile = getSportProfile(match.sport);
  const raw = Number(match.timeoutDurationSec);
  if (profile.hasSets && Number.isFinite(raw) && raw > 0) {
    return Math.max(5, Math.min(180, Math.floor(raw)));
  }
  return profile.timeoutDurationSec;
}

export function technicalTimeoutDurationSecForMatch(match: {
  sport: unknown;
  technicalTimeoutDurationSec?: number | null;
}): number {
  const profile = getSportProfile(match.sport);
  const raw = Number(match.technicalTimeoutDurationSec);
  if (profile.hasSets && Number.isFinite(raw) && raw > 0) {
    return Math.max(5, Math.min(180, Math.floor(raw)));
  }
  return 60;
}
