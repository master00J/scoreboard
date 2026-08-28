"use client";

import { useState } from "react";
import { compareSemver } from "@/lib/semver-compare";
import { LICENTIE_PORTAL_RELEASE_SEEN_KEY } from "@/lib/licentie-release-storage";

export type PortalReleaseInfo = {
  version: string;
  downloadUrl: string;
  title: string | null;
  body: string | null;
};

type Props = {
  release: PortalReleaseInfo | null;
};

export function LicenseReleaseNotice({ release }: Props) {
  const [, setRerender] = useState(0);

  if (!release?.version?.trim()) {
    return null;
  }

  const v = release.version.trim();
  let seen: string | null = null;
  try {
    seen = typeof window !== "undefined" ? localStorage.getItem(LICENTIE_PORTAL_RELEASE_SEEN_KEY)?.trim() || null : null;
  } catch {
    seen = null;
  }

  const isNewVersusSeen = Boolean(seen && compareSemver(seen, v) < 0);

  function onAcknowledge() {
    try {
      localStorage.setItem(LICENTIE_PORTAL_RELEASE_SEEN_KEY, v);
    } catch {
      /* ignore */
    }
    setRerender((n) => n + 1);
  }

  return (
    <div style={{ marginBottom: 20 }}>
      {isNewVersusSeen && (
        <div
          role="status"
          style={{
            marginBottom: 14,
            padding: "14px 16px",
            borderRadius: 14,
            border: "1px solid rgba(245, 158, 11, 0.45)",
            background: "rgba(245, 158, 11, 0.1)",
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: "0.95rem", fontWeight: 700, color: "var(--text)" }}>
            {release.title?.trim() || "Nieuwe publicatie van de app"}
          </p>
          <p className="form-hint" style={{ margin: "0 0 12px", color: "var(--text)", lineHeight: 1.45 }}>
            De download op dit portaal is bijgewerkt naar versie <strong style={{ fontFamily: "ui-monospace" }}>{v}</strong>.
            {release.body?.trim() ? ` ${release.body.trim()}` : " Vervang je oude Stadium-Scoreboard.exe door de nieuwe build."}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            {release.downloadUrl?.trim() ? (
              <a
                className="primary-button"
                href={release.downloadUrl.trim()}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open download
              </a>
            ) : null}
            <button
              type="button"
              onClick={onAcknowledge}
              style={{
                background: "transparent",
                border: "1px solid var(--line)",
                color: "var(--muted)",
                padding: "8px 14px",
                borderRadius: 10,
                fontWeight: 600,
                fontSize: "0.88rem",
                cursor: "pointer",
              }}
            >
              Begrepen, verberg melding
            </button>
          </div>
        </div>
      )}

      <p className="form-hint" style={{ margin: 0 }}>
        Huidige publicatie op dit portaal:{" "}
        <strong style={{ fontFamily: "ui-monospace", color: "var(--text)" }}>v{v}</strong>
      </p>
    </div>
  );
}
