import {
  computeCountdownSeconds,
  computeElapsedSeconds,
  computeShotClockSeconds,
} from "./timer";

/**
 * Voegt uitgerekende klokwaarden toe aan een DisplayState-snapshot voor clients zonder eigen
 * klokmodel (mobiele app, cloud). Alle waarden gelden op `timerElapsedAtMs`; de client telt zelf
 * door voor lopende klokken.
 */
export function withClockTelemetry(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  const state = snapshot as {
    timerRunning?: boolean;
    timerStartedAt?: string | null;
    timerBaseSec?: number;
    shotClockRunning?: boolean;
    shotClockStartedAt?: string | null;
    shotClockBaseSec?: number;
    homePenaltyRunning?: boolean;
    homePenaltyStartedAt?: string | null;
    homePenaltyBaseSec?: number;
    awayPenaltyRunning?: boolean;
    awayPenaltyStartedAt?: string | null;
    awayPenaltyBaseSec?: number;
    timeoutRunning?: boolean;
    timeoutStartedAt?: string | null;
    timeoutBaseSec?: number;
  };
  const now = Date.now();
  return {
    ...state,
    timerElapsedSec: computeElapsedSeconds(
      {
        timerRunning: !!state.timerRunning,
        timerStartedAt: state.timerStartedAt ?? null,
        timerBaseSec: Number(state.timerBaseSec ?? 0),
      },
      now,
    ),
    shotClockRemainingSec: computeShotClockSeconds(
      {
        shotClockRunning: !!state.shotClockRunning,
        shotClockStartedAt: state.shotClockStartedAt ?? null,
        shotClockBaseSec: Number(state.shotClockBaseSec ?? 0),
      },
      now,
    ),
    homePenaltyRemainingSec: computeCountdownSeconds(
      {
        running: !!state.homePenaltyRunning,
        startedAt: state.homePenaltyStartedAt ?? null,
        baseSec: Number(state.homePenaltyBaseSec ?? 0),
      },
      now,
    ),
    awayPenaltyRemainingSec: computeCountdownSeconds(
      {
        running: !!state.awayPenaltyRunning,
        startedAt: state.awayPenaltyStartedAt ?? null,
        baseSec: Number(state.awayPenaltyBaseSec ?? 0),
      },
      now,
    ),
    timeoutRemainingSec: computeCountdownSeconds(
      {
        running: !!state.timeoutRunning,
        startedAt: state.timeoutStartedAt ?? null,
        baseSec: Number(state.timeoutBaseSec ?? 0),
      },
      now,
    ),
    timerElapsedAtMs: now,
  };
}
