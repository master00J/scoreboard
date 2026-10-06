import { getSportProfile, periodDurationSecFor } from "../sports";
import {
  computeElapsedSeconds,
  computeShotClockSeconds,
  pauseShotClockAt,
  presentShotClock,
  runFrom,
  stopAt,
  suppressShotClock,
} from "../timer";
import type { ClockEstimate } from "./tracker";
import type { OfficialClockHoldReason } from "./types";

/**
 * Beslist hoe ArenaCue's eigen klok bijgestuurd wordt om gelijk te lopen met de console. Zuiver:
 * stand erin, wijziging eruit. ArenaCue blijft zelf tellen; we grijpen alleen in wanneer de stand
 * niet meer kan kloppen met wat de console toont.
 */

/** Toont ArenaCue een stand die op de console al voorbij is, dan meteen bijsturen. */
const BEHIND_TOLERANCE_SEC = 0.02;
const EPS = 0.002;

/**
 * Voorlopen mag zolang het door de vertraging van de console verklaard kan worden: de volgende tik
 * zien we hooguit één berichtinterval (plus wat netwerkvertraging) nadat hij op het bord stond.
 */
function aheadToleranceSec(official: ClockEstimate): number {
  return official.feedLagSec + 0.08;
}

/**
 * "ArenaCue loopt voor" kunnen we alleen zeggen als we net nog zagen wat de console toont. Komt er
 * even niets binnen (netwerk hapert), dan weten we dat niet en laten we ArenaCue gewoon doortellen
 * in plaats van de klok tegen te houden.
 */
function sawConsoleJustNow(official: ClockEstimate): boolean {
  return official.ageSec <= official.feedLagSec * 2 + 0.1;
}

/**
 * Wat de console nu toont, per klok. `null` = deze klok niet volgen (uitgezet, of geen verse stand);
 * `"off"` = de console toont een leeg shotclockscherm.
 */
export type OfficialClockTargets = {
  game: ClockEstimate | null;
  shot: ClockEstimate | "off" | null;
};

export type GameSyncState = {
  timerRunning: boolean;
  timerStartedAt: Date | string | null;
  timerBaseSec: number;
};

export type SyncMatch = { sport: string; currentPeriod: number; periodDurationSec: number | null };

type TimerPatch = ReturnType<typeof stopAt> | ReturnType<typeof runFrom>;

export type GameSyncPlan = {
  /** Reden waarom de wedstrijdklok nu niet gevolgd wordt. */
  hold: OfficialClockHoldReason | null;
  /** Klokstand die vóór het commando gezet wordt, zonder neveneffecten. */
  before: TimerPatch | null;
  /** Starten en pauzeren gaan via het echte commando, zodat ze hetzelfde doen als de knop. */
  command: "timer:start" | "timer:pause" | null;
  /** Klokstand die na het commando gezet wordt. */
  after: TimerPatch | null;
};

const NOTHING: GameSyncPlan = { hold: null, before: null, command: null, after: null };

export function gameSyncHasWork(plan: GameSyncPlan): boolean {
  return plan.before !== null || plan.command !== null || plan.after !== null;
}

export function planGameClockSync(input: {
  state: GameSyncState;
  match: SyncMatch | null;
  official: ClockEstimate;
  nowMs: number;
}): GameSyncPlan {
  const { state, match, official, nowMs } = input;
  if (!match) return { ...NOTHING, hold: "no_match_clock" };
  const profile = getSportProfile(match.sport);
  if (profile.timerMode === "NONE") return { ...NOTHING, hold: "no_match_clock" };

  const countsDown = profile.timerMode === "COUNT_DOWN";
  const duration = periodDurationSecFor(match.sport, match.currentPeriod, match.periodDurationSec);
  const officialDown = official.direction === "down";
  if (officialDown && duration <= 0) return { ...NOTHING, hold: "no_match_clock" };

  const local = computeElapsedSeconds(state, nowMs);
  // Meer tijd dan een periode duurt: dat is een pauzeklok of een andere wedstrijdinstelling.
  if (officialDown && official.shown > duration + 1) return { ...NOTHING, hold: "longer_than_period" };
  // De tijd volgt altijd de console, ook als de operator de volgende periode nog niet gekozen heeft:
  // dan klopt de klok al en staat alleen het periodenummer nog achter.
  const periodOverLocally = countsDown && duration > 0 && !state.timerRunning && local >= duration - EPS;

  // Alles in verstreken seconden, zoals ArenaCue de klok bewaart. Wat de console toont, komt overeen
  // met het interval [lo, hi): op een tik is de verstreken tijd precies `lo`.
  const toElapsed = (seconds: number) => {
    const elapsed = officialDown ? duration - seconds : seconds;
    return Math.max(0, countsDown && duration > 0 ? Math.min(duration, elapsed) : elapsed);
  };
  const lo = toElapsed(official.shown);
  const hi = lo + official.resolution;
  const best = Math.min(Math.max(toElapsed(official.value), lo), hi - EPS);
  const at = new Date(nowMs);

  // De console staat op nul: de periode is voorbij.
  if (countsDown && lo >= duration - EPS) {
    if (state.timerRunning) {
      // ArenaCue sluit de periode zelf af (pauzeklok, scherm); we zorgen alleen dat dat nu gebeurt.
      return duration - local > 0.3 ? { ...NOTHING, after: runFrom(Math.max(0, duration - 0.02), at) } : NOTHING;
    }
    return periodOverLocally ? NOTHING : { ...NOTHING, after: stopAt(duration) };
  }

  // ArenaCue sloot de periode net af terwijl de console haar laatste tienden nog aftelt: niet opnieuw
  // starten voor die fractie, anders loopt het periode-einde twee keer.
  if (periodOverLocally && official.running && duration - lo <= 1.5) return NOTHING;

  if (official.running && !state.timerRunning) {
    const fits = local >= lo - BEHIND_TOLERANCE_SEC && local < hi + aheadToleranceSec(official);
    return { hold: null, before: fits ? null : stopAt(best), command: "timer:start", after: null };
  }

  if (!official.running && state.timerRunning) {
    // De console stond al stil toen dit bericht vertrok: ArenaCue liep intussen hooguit één
    // berichtinterval door. Dat halen we eraf, zodat het scherm na de hervatting niet voorloopt, en we
    // blijven binnen wat de console toont.
    const rewound = local - official.feedLagSec;
    const held = rewound < lo ? lo : rewound >= hi ? Math.max(lo, hi - 0.05) : rewound;
    return { hold: null, before: null, command: "timer:pause", after: stopAt(held) };
  }

  if (official.running) {
    const behind = local < lo - BEHIND_TOLERANCE_SEC;
    const ahead = sawConsoleJustNow(official) && local >= hi + aheadToleranceSec(official);
    return behind || ahead ? { ...NOTHING, after: runFrom(best, at) } : NOTHING;
  }

  // Beide staan stil: alleen bijsturen als ArenaCue iets anders toont dan de console.
  return local < lo - EPS || local >= hi ? { ...NOTHING, after: stopAt(lo) } : NOTHING;
}

export type ShotSyncState = {
  shotClockRunning: boolean;
  shotClockStartedAt: Date | string | null;
  shotClockBaseSec: number;
  shotClockOff: boolean;
  shotClockDisabled: boolean;
};

export type ShotPatch = ReturnType<typeof presentShotClock>;

/**
 * Wijziging voor de shotclock, of `null` als er niets hoeft te gebeuren. `official: "off"` betekent
 * dat de console een leeg shotclockscherm toont.
 */
export function planShotClockSync(input: {
  state: ShotSyncState;
  sport: string | null;
  official: ClockEstimate | "off";
  nowMs: number;
}): ShotPatch | null {
  const { state, sport, official, nowMs } = input;
  // De operator heeft de shotclock uitgezet, of deze sport heeft er geen: daar blijven we af.
  if (state.shotClockDisabled || !sport || getSportProfile(sport).shotClockPresets.length === 0) return null;

  if (official === "off") return state.shotClockOff ? null : suppressShotClock();

  const at = new Date(nowMs);
  const local = computeShotClockSeconds(state, nowMs);
  // Aftellend: wat de console toont, komt overeen met het interval (lo, hi].
  const hi = official.shown;
  const lo = Math.max(0, hi - official.resolution);
  const best = Math.min(hi, Math.max(lo + EPS, official.value));
  const ahead = aheadToleranceSec(official);

  if (hi <= 0) {
    return !state.shotClockOff && !state.shotClockRunning && local <= EPS
      ? null
      : { ...pauseShotClockAt(0), shotClockOff: false };
  }
  if (state.shotClockOff) return presentShotClock(official.running ? best : hi, official.running, at);

  if (official.running && !state.shotClockRunning) {
    const fits = local > lo - ahead && local <= hi + BEHIND_TOLERANCE_SEC;
    return presentShotClock(fits ? Math.max(local, EPS) : best, true, at);
  }
  if (!official.running && state.shotClockRunning) {
    // Zelfde redenering als bij de wedstrijdklok: wat we te ver doorliepen, komt er weer bij.
    const rewound = local + official.feedLagSec;
    const held = rewound > hi ? hi : rewound <= lo ? Math.min(hi, lo + 0.05) : rewound;
    return { ...pauseShotClockAt(held), shotClockOff: false };
  }
  if (official.running) {
    const tooFar = sawConsoleJustNow(official) && local <= lo - ahead;
    return local > hi + BEHIND_TOLERANCE_SEC || tooFar ? presentShotClock(best, true, at) : null;
  }
  return local > hi + EPS || local <= lo ? presentShotClock(hi, false, at) : null;
}
