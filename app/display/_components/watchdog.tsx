"use client";

import { useEffect, useState } from "react";
import { useDisplayStore } from "@/lib/store";

/**
 * Watchdog for the /display page.
 * If disconnected for 30+ seconds AND the current display mode is safe to reload
 * (IDLE / SPONSOR_ROTATION / SPONSOR), auto-reload the page to try reconnecting.
 */
export function DisplayWatchdog() {
  const connected = useDisplayStore((s) => s.connected);
  const state = useDisplayStore((s) => s.state);
  const [lostAt, setLostAt] = useState<number | null>(null);

  useEffect(() => {
    if (connected) {
      setLostAt(null);
      return;
    }
    if (lostAt === null) setLostAt(Date.now());
  }, [connected, lostAt]);

  useEffect(() => {
    if (lostAt === null) return;
    const safeModes = new Set(["IDLE", "SPONSOR_ROTATION", "SPONSOR"]);
    const mode = state?.mode ?? "IDLE";
    if (!safeModes.has(mode)) return;
    const id = setInterval(() => {
      if (Date.now() - lostAt > 30_000) {
        console.warn("[watchdog] reloading after 30s disconnect in safe mode");
        window.location.reload();
      }
    }, 2000);
    return () => clearInterval(id);
  }, [lostAt, state?.mode]);

  return null;
}
