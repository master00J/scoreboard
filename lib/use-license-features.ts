"use client";

import { useEffect, useMemo, useState } from "react";
import { isElectron } from "@/lib/electron";
import type { LicenseGetStatusResult } from "@/lib/desktop-bridge";

export type DesktopFeatureKey =
  | "automatic_sponsor_rotation"
  | "proof_of_play_export"
  | "sponsor_budget_tracking"
  | "sponsor_interrupt_resume";

export function useLicenseFeatures() {
  const [status, setStatus] = useState<LicenseGetStatusResult | null>(null);

  useEffect(() => {
    let alive = true;
    if (!isElectron || !window.electronAPI?.licenseGetStatus) {
      setStatus({ gate: false, organizationLabel: null });
      return;
    }
    void window.electronAPI.licenseGetStatus().then((result) => {
      if (alive) setStatus(result);
    });
    return () => {
      alive = false;
    };
  }, []);

  return useMemo(() => {
    const features = status && status.gate === false ? status.features : undefined;
    return {
      status,
      plan: status && status.gate === false ? status.plan : undefined,
      planLabel: status && status.gate === false ? status.planLabel : undefined,
      isFeatureAllowed: (key: DesktopFeatureKey) => features?.[key] !== false,
    };
  }, [status]);
}
