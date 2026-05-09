"use client";

import { useEffect, useState } from "react";

/**
 * Loopt op vaste interval los van de wedstrijdklok — nodig voor HUD/telemetry
 * (clips lopen door terwijl `useLiveTimerSeconds` stilstaat bij gepauzeerde timer).
 */
export function useWallClockMs(intervalMs = 200): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
