"use client";

import { useEffect, useMemo, useState } from "react";
import { isElectron } from "@/lib/electron";
import type { LicenseGetStatusResult } from "@/lib/desktop-bridge";
import { LICENSE_CHANGED_EVENT } from "@/lib/license-ui";

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
    const read = () => {
      void window.electronAPI?.licenseGetStatus().then((result) => {
        if (alive) setStatus(result);
      });
    };
    read();
    window.addEventListener(LICENSE_CHANGED_EVENT, read);
    return () => {
      alive = false;
      window.removeEventListener(LICENSE_CHANGED_EVENT, read);
    };
  }, []);

  return useMemo(() => {
    const features = status && status.gate === false ? status.features : undefined;
    return {
      status,
      plan: status && status.gate === false ? status.plan : undefined,
      planLabel: status && status.gate === false ? status.planLabel : undefined,
      organizationLabel: status && status.gate === false ? status.organizationLabel : undefined,
      isFeatureAllowed: (key: DesktopFeatureKey) => features?.[key] !== false,
    };
  }, [status]);
}
