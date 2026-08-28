"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Loopt van 0 → 1 over `totalMs` (wall clock), opnieuw bij `resetKey`.
 * Bij totalMs ≤ 0: geen animatie, waarde blijft 0.
 */
export function useTimedSlideProgress(
  totalMs: number,
  resetKey: string | number,
  paused = false,
) {
  const [elapsed01, setElapsed01] = useState(0);
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    if (totalMs <= 0) {
      setElapsed01(0);
      return;
    }
    let cancelled = false;
    let raf = 0;
    let accumulatedMs = 0;
    let lastTickMs = performance.now();
    function tick(now: number) {
      if (cancelled) return;
      if (!pausedRef.current) {
        accumulatedMs += Math.max(0, now - lastTickMs);
      }
      lastTickMs = now;
      const t = accumulatedMs / totalMs;
      const clamped = Math.min(1, Math.max(0, t));
      setElapsed01(clamped);
      if (clamped < 1) raf = requestAnimationFrame(tick);
    }
    setElapsed01(0);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [totalMs, resetKey]);
  return elapsed01;
}

/** Onderaan preview: resterende tijd als balk (vol = nog volledige duur). */
export function PreviewSlideProgressBar({
  elapsed01,
  totalMs,
}: {
  /** 0 = net gestart, 1 = slide voorbij. */
  elapsed01: number;
  /** Voor tooltip (seconden resterend). */
  totalMs: number;
}) {
  const remaining01 = Math.max(0, Math.min(1, 1 - elapsed01));
  const secLeft =
    totalMs > 0 ? Math.max(0, Math.ceil((remaining01 * totalMs) / 1000)) : 0;
  return (
    <div
      className="pointer-events-none absolute bottom-0 left-0 right-0 z-[30] bg-gradient-to-t from-black/55 via-black/25 to-transparent pt-8 pb-1"
      title={secLeft > 0 ? `Nog ca. ${secLeft} s` : undefined}
      aria-hidden
    >
      <div className="mx-2 h-[3px] overflow-hidden rounded-full bg-white/25">
        <div
          className="h-full rounded-full bg-emerald-400/90 shadow-[0_0_10px_rgba(52,211,153,0.45)]"
          style={{ width: `${remaining01 * 100}%` }}
        />
      </div>
    </div>
  );
}
