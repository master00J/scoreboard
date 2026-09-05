import type { DisplayState } from "@prisma/client";

/**
 * Authoritative timer math.
 * Elapsed seconds = base + (running ? (now - startedAt) / 1000 : 0)
 */
export function startedAtMs(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function computeElapsedSeconds(state: {
  timerRunning: boolean;
  timerStartedAt: Date | string | null;
  timerBaseSec: number;
}, now: number = Date.now()): number {
  const started = startedAtMs(state.timerStartedAt);
  if (!state.timerRunning || started == null) {
    return Math.max(0, state.timerBaseSec);
  }
  // `now` kan achter `startedAt` lopen (stale UI-tick of DateTime-afronding).
  // Nooit onder de stilgezette base zakken — anders flitst MM:SS 1s terug bij Start.
  const diffSec = Math.max(0, now - started) / 1000;
  return Math.max(0, state.timerBaseSec + diffSec);
}

/** Control-UI + preview: DisplayState wint; tick alleen als er geen bruikbaar anker is. */
export function resolveLiveElapsedSeconds(
  state: {
    timerRunning?: boolean;
    timerStartedAt?: Date | string | null;
    timerBaseSec?: number;
  } | null,
  tick: {
    elapsed: number;
    running: boolean;
    startedAt: string | null;
    baseSec: number;
    serverNow: number;
  } | null,
  now: number = Date.now(),
): number {
  if (state) {
    if (!state.timerRunning) {
      return Math.max(0, Number(state.timerBaseSec ?? 0));
    }
    const started = startedAtMs(state.timerStartedAt);
    if (started != null) {
      const base = Math.max(0, Number(state.timerBaseSec ?? 0));
      return base + Math.max(0, now - started) / 1000;
    }
  }
  if (tick) {
    if (!tick.running) {
      return Math.max(0, Number.isFinite(tick.baseSec) ? tick.baseSec : tick.elapsed);
    }
    const started = startedAtMs(tick.startedAt);
    if (started != null) {
      const base = Math.max(0, Number(tick.baseSec ?? 0));
      return base + Math.max(0, now - started) / 1000;
    }
    if (Number.isFinite(tick.elapsed) && Number.isFinite(tick.serverNow)) {
      return Math.max(0, tick.elapsed + Math.max(0, now - tick.serverNow) / 1000);
    }
  }
  return Math.max(0, Number(state?.timerBaseSec ?? 0));
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
  "timerStartedAt" | "shotClockStartedAt" | "postMatchStartedAt" | "preMatchStartedAt" | "updatedAt"
> & {
  timerStartedAt: string | null;
  shotClockStartedAt: string | null;
  postMatchStartedAt: string | null;
  preMatchStartedAt: string | null;
  updatedAt: string;
};

export function serializeDisplayState(s: DisplayState): SerializedDisplayState {
  const row = s as DisplayState & {
    postMatchStartedAt?: Date | null;
    preMatchStartedAt?: Date | null;
  };
  return {
    ...s,
    timerStartedAt: s.timerStartedAt ? s.timerStartedAt.toISOString() : null,
    shotClockStartedAt: s.shotClockStartedAt ? s.shotClockStartedAt.toISOString() : null,
    postMatchStartedAt: row.postMatchStartedAt ? row.postMatchStartedAt.toISOString() : null,
    preMatchStartedAt: row.preMatchStartedAt ? row.preMatchStartedAt.toISOString() : null,
    updatedAt: s.updatedAt.toISOString(),
  };
}
