"use client";

import { useEffect, useRef, useState } from "react";

/** Lokale tijd (s) in het rustsegment voor sponsor-rooster (sync met display). */
export function useHalftimeSponsorTimelineT(
  status: string | undefined,
  halfBreakSec: number,
): number {
  const originRef = useRef<number | null>(null);
  const [t, setT] = useState(0);
  useEffect(() => {
    if (status === "HALF_TIME") {
      if (originRef.current == null) originRef.current = Date.now();
    } else {
      originRef.current = null;
    }
  }, [status]);
  useEffect(() => {
    if (status !== "HALF_TIME" || originRef.current == null) {
      setT(0);
      return;
    }
    const H = Math.max(60, halfBreakSec);
    const tick = () => {
      setT(((Date.now() - originRef.current!) / 1000) % H);
    };
    tick();
    const id = setInterval(tick, 400);
    return () => clearInterval(id);
  }, [status, halfBreakSec]);
  return status === "HALF_TIME" ? t : 0;
}
