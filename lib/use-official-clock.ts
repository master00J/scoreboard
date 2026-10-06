"use client";

import { useEffect, useState } from "react";
import type { OfficialClockStatus } from "./official-clock/types";

/** Status van het volgen van de officiële klok; `null` buiten de desktop-app of zolang hij nog laadt. */
export function useOfficialClockStatus(): OfficialClockStatus | null {
  const [status, setStatus] = useState<OfficialClockStatus | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getOfficialClockStatus) return;
    let active = true;
    void api.getOfficialClockStatus().then((next) => {
      if (active && next) setStatus(next);
    });
    const unsubscribe = api.onOfficialClockStatus?.((next) => setStatus(next));
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return status;
}
