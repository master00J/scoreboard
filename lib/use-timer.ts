"use client";

import { useEffect, useState } from "react";
import { useDisplayStore } from "@/lib/store";
import {
  computeElapsedSeconds,
  computePenaltySeconds,
  computeShotClockSeconds,
  computeTimeoutSeconds,
} from "@/lib/timer";

/**
 * Zelfde wedstrijdklok als het stadionscherm: DisplayState-anker, met `display:tick`
 * als vangnet wanneer `timerRunning` aan staat maar `timerStartedAt` ontbreekt.
 *
 * Server ticks are still received to keep `state` fresh but we don't use them
 * here; that was the source of visible stutter (every ~250ms a re-computed
 * value with a slightly different drift correction caused a tiny jump).
 *
 * 10 updates per seconde: genoeg voor tienden in de laatste minuut (basket) en nog steeds goedkoop.
 */
export function useLiveTimerSeconds(): number {
  const state = useDisplayStore((s) => s.state);
  const tick = useDisplayStore((s) => s.tick);
  useWallClockMs(100);
  // Interval triggert alleen de re-render; `now` uit de hook kan achter
  // `timerStartedAt` lopen en dan 1s terugflitsen (floor van 20.85 → 00:20).
  return resolveLiveElapsedSeconds(state, tick, Date.now());
}

function useNowEvery100ms(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let raf = 0;
    let lastUpdate = 0;
    function loop() {
      const t = performance.now();
      if (t - lastUpdate >= 100) {
        lastUpdate = t;
        setNow(Date.now());
      }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return now;
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
