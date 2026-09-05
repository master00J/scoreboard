"use client";

import { useEffect, useState } from "react";
import { useDisplayStore } from "@/lib/store";
import { resolveLiveElapsedSeconds } from "@/lib/timer";
import { computeShotClockSeconds } from "@/lib/timer";
import { useWallClockMs } from "@/lib/use-wall-clock-tick";

/**
 * Zelfde wedstrijdklok als het stadionscherm: DisplayState-anker, met `display:tick`
 * als vangnet wanneer `timerRunning` aan staat maar `timerStartedAt` ontbreekt.
 */
export function useLiveTimerSeconds(): number {
  const state = useDisplayStore((s) => s.state);
  const tick = useDisplayStore((s) => s.tick);
  useWallClockMs(200);
  // Interval triggert alleen de re-render; `now` uit de hook kan tot 200ms achter
  // `timerStartedAt` lopen en dan 1s terugflitsen (floor van 20.85 → 00:20).
  return resolveLiveElapsedSeconds(state, tick, Date.now());
}

/** Vloeiende lokale countdown voor de onafhankelijke shotclock. */
export function useLiveShotClockSeconds(): number {
  const state = useDisplayStore((s) => s.state);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, []);

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
