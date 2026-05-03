"use client";

import { useEffect, useState } from "react";
import { useDisplayStore } from "@/lib/store";
import { computeElapsedSeconds } from "@/lib/timer";

/**
 * Smooth local timer. Only reads authoritative `timerStartedAt` + `timerBaseSec`
 * from DisplayState and the local clock — no drift correction, no per-tick jumps.
 *
 * Server ticks are still received to keep `state` fresh but we don't use them
 * here; that was the source of visible stutter (every ~250ms a re-computed
 * value with a slightly different drift correction caused a tiny jump).
 */
export function useLiveTimerSeconds(): number {
  const state = useDisplayStore((s) => s.state);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let raf = 0;
    let lastUpdate = 0;
    function loop() {
      const t = performance.now();
      // 5fps is plenty for an MM:SS display, cheap, and stutter-free.
      if (t - lastUpdate >= 200) {
        lastUpdate = t;
        setNow(Date.now());
      }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!state) return 0;
  return computeElapsedSeconds(
    {
      timerRunning: state.timerRunning,
      timerStartedAt: state.timerStartedAt,
      timerBaseSec: state.timerBaseSec,
    },
    now,
  );
}
