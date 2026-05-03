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

export type SerializedDisplayState = Omit<DisplayState, "timerStartedAt" | "updatedAt"> & {
  timerStartedAt: string | null;
  updatedAt: string;
};

export function serializeDisplayState(s: DisplayState): SerializedDisplayState {
  return {
    ...s,
    timerStartedAt: s.timerStartedAt ? s.timerStartedAt.toISOString() : null,
    updatedAt: s.updatedAt.toISOString(),
  };
}
