import type { DisplayState } from "@prisma/client";

/** Klokwaarden bewaren we op milliseconde-precisie (geen seconde verlies per pauze). */
function toClockSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.round(seconds * 1000) / 1000);
}

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
  const diffSec = (now - started) / 1000;
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
  const started = startedAtMs(state.startedAt);
  if (!state.running || started == null) return base;
  return Math.max(0, base - (now - started) / 1000);
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
  /** Alleen runtime: na sport:setPeriod, tot timer:start. Niet in Prisma. */
  sponsorPeriodBreakPending?: boolean;
};

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function serializeDisplayState(s: DisplayState): SerializedDisplayState {
  const row = s as DisplayState & {
    postMatchStartedAt?: Date | null;
    preMatchStartedAt?: Date | null;
  };
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
