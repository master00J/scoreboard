import type { DisplayState } from "@prisma/client";

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
  const started = state.timerStartedAt instanceof Date
    ? state.timerStartedAt.getTime()
    : new Date(state.timerStartedAt).getTime();
  const diffSec = (now - started) / 1000;
  return Math.max(0, state.timerBaseSec + diffSec);
}

/**
 * Returns a fresh "paused at this seconds value" tuple.
 */
export function stopAt(seconds: number) {
  return {
    timerRunning: false,
    timerStartedAt: null,
    timerBaseSec: Math.max(0, Math.floor(seconds)),
  };
}

/**
 * Returns a fresh "starts running from this seconds value now" tuple.
 */
export function runFrom(seconds: number, now: Date = new Date()) {
  return {
    timerRunning: true,
    timerStartedAt: now,
    timerBaseSec: Math.max(0, Math.floor(seconds)),
  };
}

/** Shotclock telt af vanaf `baseSec` zolang hij loopt. */
export function computeShotClockSeconds(state: {
  shotClockRunning: boolean;
  shotClockStartedAt: Date | string | null;
  shotClockBaseSec: number;
}, now: number = Date.now()): number {
  const base = Math.max(0, state.shotClockBaseSec);
  if (!state.shotClockRunning || !state.shotClockStartedAt) return base;
  const started =
    state.shotClockStartedAt instanceof Date
      ? state.shotClockStartedAt.getTime()
      : new Date(state.shotClockStartedAt).getTime();
  return Math.max(0, base - (now - started) / 1000);
}

export function pauseShotClockAt(seconds: number) {
  return {
    shotClockRunning: false,
    shotClockStartedAt: null,
    shotClockBaseSec: Math.max(0, Math.ceil(seconds)),
  };
}

export function runShotClockFrom(seconds: number, now: Date = new Date()) {
  return {
    shotClockRunning: seconds > 0,
    shotClockStartedAt: seconds > 0 ? now : null,
    shotClockBaseSec: Math.max(0, Math.ceil(seconds)),
  };
}

export type SerializedDisplayState = Omit<
  DisplayState,
  "timerStartedAt" | "shotClockStartedAt" | "updatedAt"
> & {
  timerStartedAt: string | null;
  shotClockStartedAt: string | null;
  updatedAt: string;
};

export function serializeDisplayState(s: DisplayState): SerializedDisplayState {
  return {
    ...s,
    timerStartedAt: s.timerStartedAt ? s.timerStartedAt.toISOString() : null,
    shotClockStartedAt: s.shotClockStartedAt ? s.shotClockStartedAt.toISOString() : null,
    updatedAt: s.updatedAt.toISOString(),
  };
}
