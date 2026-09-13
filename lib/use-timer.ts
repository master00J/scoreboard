"use client";

import { useEffect, useState } from "react";
import { useDisplayStore } from "@/lib/store";
import {
  computePenaltySeconds,
  computeShotClockSeconds,
  computeTimeoutSeconds,
  resolveLiveElapsedSeconds,
} from "@/lib/timer";
import { useWallClockMs } from "@/lib/use-wall-clock-tick";

/**
 * Zelfde wedstrijdklok als het stadionscherm: DisplayState-anker, met `display:tick`
 * als vangnet wanneer `timerRunning` aan staat maar `timerStartedAt` ontbreekt.
 *
 * 10 updates per seconde: genoeg voor tienden in de laatste minuut (basket) en nog steeds goedkoop.
 */
export function useLiveTimerSeconds(): number {
  const state = useDisplayStore((s) => s.state);
  const tick = useDisplayStore((s) => s.tick);
  useWallClockMs(100);
  return resolveLiveElapsedSeconds(state, tick, Date.now());
}

function useNowEvery100ms(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Vloeiende lokale countdown voor de onafhankelijke shotclock. */
export function useLiveShotClockSeconds(): number {
  const state = useDisplayStore((s) => s.state);
  const now = useNowEvery100ms();
  if (!state) return 0;
  return computeShotClockSeconds(
    {
      shotClockRunning: state.shotClockRunning,
      shotClockStartedAt: state.shotClockStartedAt,
      shotClockBaseSec: state.shotClockBaseSec,
    },
    now,
  );
}

/** Resterende straftijd per ploeg (hockey); loopt mee met de wedstrijdklok. */
export function useLivePenaltySeconds(side: "home" | "away"): number {
  const state = useDisplayStore((s) => s.state);
  const now = useNowEvery100ms();
  if (!state) return 0;
  return computePenaltySeconds(
    side === "home"
      ? {
          running: state.homePenaltyRunning,
          startedAt: state.homePenaltyStartedAt,
          baseSec: state.homePenaltyBaseSec,
        }
      : {
          running: state.awayPenaltyRunning,
          startedAt: state.awayPenaltyStartedAt,
          baseSec: state.awayPenaltyBaseSec,
        },
    now,
  );
}

/** Resterende seconden van de lopende time-out (0 als er geen loopt). */
export function useLiveTimeoutSeconds(): number {
  const state = useDisplayStore((s) => s.state);
  const now = useNowEvery100ms();
  if (!state || !state.timeoutRunning) return 0;
  return computeTimeoutSeconds(
    {
      timeoutRunning: state.timeoutRunning,
      timeoutStartedAt: state.timeoutStartedAt,
      timeoutBaseSec: state.timeoutBaseSec,
    },
    now,
  );
}
