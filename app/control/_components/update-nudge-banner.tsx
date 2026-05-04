"use client";

import { useEffect, useState } from "react";
import { isElectron } from "@/lib/electron";
import { Button } from "@/components/ui/button";

const FEED_URL = "https://arenacue.be/api/app/release";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const LS_LAST_CHECK = "arenacue-release-last-check";
const LS_DISMISS_FOR = "arenacue-update-dismissed-for";

type ReleaseInfo = {
  version: string;
  downloadUrl: string;
  title: string | null;
  body: string | null;
};

function parseSemverParts(v: string): number[] {
  const core = v.split(/[-+]/)[0] ?? v;
  return core.split(".").map((p) => parseInt(p.replace(/\D/g, ""), 10) || 0);
}

/** Negatief als a ouder is dan b. */
function compareSemver(a: string, b: string): number {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

export function UpdateNudgeBanner() {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "update"; current: string; release: ReleaseInfo }
    | { kind: "hidden" }
  >({ kind: "idle" });

  useEffect(() => {
    if (!isElectron || typeof window === "undefined" || !window.electronAPI?.getAppVersion) {
      setState({ kind: "hidden" });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const now = Date.now();
        const last = Number(localStorage.getItem(LS_LAST_CHECK) || 0);
        if (now - last < CHECK_INTERVAL_MS) {
          setState({ kind: "hidden" });
          return;
        }

        const current = (await window.electronAPI.getAppVersion()).trim();
        const res = await fetch(FEED_URL, { cache: "no-store" });
        if (!res.ok) {
          localStorage.setItem(LS_LAST_CHECK, String(now));
          setState({ kind: "hidden" });
          return;
        }
        const release = (await res.json()) as ReleaseInfo;
        if (!release?.version || !release?.downloadUrl) {
          localStorage.setItem(LS_LAST_CHECK, String(now));
          setState({ kind: "hidden" });
          return;
        }

        localStorage.setItem(LS_LAST_CHECK, String(now));

        if (cancelled) return;
        if (compareSemver(current, release.version) >= 0) {
          setState({ kind: "hidden" });
          return;
        }

        const dismissed = localStorage.getItem(LS_DISMISS_FOR);
        if (dismissed === release.version) {
          setState({ kind: "hidden" });
          return;
        }

        setState({ kind: "update", current, release });
      } catch {
        if (!cancelled) setState({ kind: "hidden" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind !== "update") {
    return null;
  }

  const { release, current } = state;
  const title = release.title?.trim() || `Update beschikbaar (${release.version})`;

  return (
    <div
      className="mb-4 flex flex-col gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      role="status"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-amber-100">{title}</p>
        <p className="text-xs text-amber-200/90">
          Je gebruikt versie <span className="font-mono">{current}</span>. De nieuwste versie is{" "}
          <span className="font-mono">{release.version}</span>.
          {release.body ? ` ${release.body}` : " Download de nieuwste build en vervang je bestand."}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            localStorage.setItem(LS_DISMISS_FOR, release.version);
            setState({ kind: "hidden" });
          }}
        >
          Later
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            void window.electronAPI?.openExternalUrl(release.downloadUrl);
          }}
        >
          Download-update
        </Button>
      </div>
    </div>
  );
}
