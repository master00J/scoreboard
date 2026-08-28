"use client";

import { useEffect, useState } from "react";
import { LicensePortalForm } from "@/components/license-portal-form";
import { LicenseReleaseNotice, type PortalReleaseInfo } from "@/components/license-release-notice";
import { seedLicentieReleaseSeenIfEmpty } from "@/lib/licentie-release-storage";

export function LicentiePortalClient() {
  const [release, setRelease] = useState<PortalReleaseInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/app/release", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as PortalReleaseInfo;
        if (!json?.version?.trim() || cancelled) return;
        seedLicentieReleaseSeenIfEmpty(json.version.trim());
        if (!cancelled) setRelease(json);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <LicenseReleaseNotice release={release} />
      <LicensePortalForm portalReleaseVersion={release?.version?.trim() ?? null} />
    </>
  );
}
