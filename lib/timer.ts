import type { DisplayState } from "@prisma/client";

/** Klokwaarden bewaren we op milliseconde-precisie (geen seconde verlies per pauze). */
function toClockSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.round(seconds * 1000) / 1000);
}

function startedAtMs(value: Date | string | null): number {
  return value instanceof Date ? value.getTime() : new Date(value as string).getTime();
}

/**
 * Authoritative timer math.
 * Elapsed seconds = base + (running ? (now - startedAt) / 1000 : 0)
 */
export function computeElapsedSeconds(state: {
  timerRunning: boolean;
  timerStartedAt: Date | string | null;
  timerBaseSec: number;
}, now: number = Date.now()): number {
  if (!state.timerRunning || !state.timerStartedAt) {
    return Math.max(0, state.timerBaseSec);
  }
  const diffSec = (now - startedAtMs(state.timerStartedAt)) / 1000;
  return Math.max(0, state.timerBaseSec + diffSec);
}

/**
 * Returns a fresh "paused at this seconds value" tuple.
 */
export function stopAt(seconds: number) {
  return {
    timerRunning: false,
    timerStartedAt: null,
    timerBaseSec: toClockSeconds(seconds),
  };
}

/**
 * Returns a fresh "starts running from this seconds value now" tuple.
 */
export function runFrom(seconds: number, now: Date = new Date()) {
  return {
    timerRunning: true,
    timerStartedAt: now,
    timerBaseSec: toClockSeconds(seconds),
  };
}

/** Generieke aftellende klok (shotclock, straftijd, time-out). */
export type CountdownState = {
  running: boolean;
  startedAt: Date | string | null;
  baseSec: number;
};

export function computeCountdownSeconds(state: CountdownState, now: number = Date.now()): number {
  const base = Math.max(0, state.baseSec);
  if (!state.running || !state.startedAt) return base;
  return Math.max(0, base - (now - startedAtMs(state.startedAt)) / 1000);
}

/** Shotclock telt af vanaf `baseSec` zolang hij loopt. */
export function computeShotClockSeconds(state: {
  shotClockRunning: boolean;
  shotClockStartedAt: Date | string | null;
  shotClockBaseSec: number;
}, now: number = Date.now()): number {
  return computeCountdownSeconds(
    {
      running: state.shotClockRunning,
      startedAt: state.shotClockStartedAt,
      baseSec: state.shotClockBaseSec,
    },
    now,
  );
}

export function pauseShotClockAt(seconds: number) {
  return {
    shotClockRunning: false,
    shotClockStartedAt: null,
    shotClockBaseSec: toClockSeconds(seconds),
  };
}

export function runShotClockFrom(seconds: number, now: Date = new Date()) {
  const sec = toClockSeconds(seconds);
  return {
    shotClockRunning: sec > 0,
    shotClockStartedAt: sec > 0 ? now : null,
    shotClockBaseSec: sec,
  };
}

export function computePenaltySeconds(state: CountdownState, now: number = Date.now()): number {
  return computeCountdownSeconds(state, now);
}

export function penaltyStateFor(
  s: {
    homePenaltyRunning: boolean;
    homePenaltyStartedAt: Date | string | null;
    homePenaltyBaseSec: number;
    awayPenaltyRunning: boolean;
    awayPenaltyStartedAt: Date | string | null;
    awayPenaltyBaseSec: number;
  },
  side: "home" | "away",
): CountdownState {
  return side === "home"
    ? { running: s.homePenaltyRunning, startedAt: s.homePenaltyStartedAt, baseSec: s.homePenaltyBaseSec }
    : { running: s.awayPenaltyRunning, startedAt: s.awayPenaltyStartedAt, baseSec: s.awayPenaltyBaseSec };
}

export function pausePenaltyAt(side: "home" | "away", seconds: number) {
  const sec = toClockSeconds(seconds);
  return side === "home"
    ? {
        homePenaltyRunning: false,
        homePenaltyStartedAt: null,
        homePenaltyBaseSec: sec,
      }
    : {
        awayPenaltyRunning: false,
        awayPenaltyStartedAt: null,
        awayPenaltyBaseSec: sec,
      };
}

export function runPenaltyFrom(side: "home" | "away", seconds: number, now: Date = new Date()) {
  const sec = toClockSeconds(seconds);
  const running = sec > 0;
  return side === "home"
    ? {
        homePenaltyRunning: running,
        homePenaltyStartedAt: running ? now : null,
        homePenaltyBaseSec: sec,
      }
    : {
        awayPenaltyRunning: running,
        awayPenaltyStartedAt: running ? now : null,
        awayPenaltyBaseSec: sec,
      };
}

export type TimeoutSide = "home" | "away" | "technical";

export function computeTimeoutSeconds(state: {
  timeoutRunning: boolean;
  timeoutStartedAt: Date | string | null;
  timeoutBaseSec: number;
}, now: number = Date.now()): number {
  return computeCountdownSeconds(
    { running: state.timeoutRunning, startedAt: state.timeoutStartedAt, baseSec: state.timeoutBaseSec },
    now,
  );
}

export function runTimeoutFrom(side: TimeoutSide, seconds: number, now: Date = new Date()) {
  const sec = toClockSeconds(seconds);
  return {
    timeoutRunning: sec > 0,
    timeoutStartedAt: sec > 0 ? now : null,
    timeoutBaseSec: sec,
    timeoutSide: sec > 0 ? side : null,
  };
}

export function clearTimeoutClock() {
  return {
    timeoutRunning: false,
    timeoutStartedAt: null,
    timeoutBaseSec: 0,
    timeoutSide: null,
  };
}

export type SerializedDisplayState = Omit<
  DisplayState,
  | "timerStartedAt"
  | "shotClockStartedAt"
  | "homePenaltyStartedAt"
  | "awayPenaltyStartedAt"
  | "timeoutStartedAt"
  | "updatedAt"
> & {
  timerStartedAt: string | null;
  shotClockStartedAt: string | null;
  homePenaltyStartedAt: string | null;
  awayPenaltyStartedAt: string | null;
  timeoutStartedAt: string | null;
  updatedAt: string;
};

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function serializeDisplayState(s: DisplayState): SerializedDisplayState {
  return {
    ...s,
    timerStartedAt: isoOrNull(s.timerStartedAt),
    shotClockStartedAt: isoOrNull(s.shotClockStartedAt),
    homePenaltyStartedAt: isoOrNull(s.homePenaltyStartedAt),
    awayPenaltyStartedAt: isoOrNull(s.awayPenaltyStartedAt),
    timeoutStartedAt: isoOrNull(s.timeoutStartedAt),
    updatedAt: s.updatedAt.toISOString(),
  };
}
