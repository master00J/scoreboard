import type { PortalLicenseCardView } from "@/lib/portal-dashboard-data";
import { PortalLogoutButton } from "@/components/portal-logout-button";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) {
    return "—";
  }
  return d.toLocaleString("nl-BE", { dateStyle: "medium", timeStyle: "short" });
}

function statusLabel(s: PortalLicenseCardView["status"]): { text: string; cls: string } {
  if (s === "active") {
    return { text: "Actief", cls: "badge-ok" };
  }
  if (s === "revoked") {
    return { text: "Ingetrokken", cls: "badge-bad" };
  }
  return { text: "Verlopen", cls: "badge-warn" };
}

export function PortalDashboard({
  email,
  licenses,
  portalReleaseVersion,
}: {
  email: string;
  licenses: PortalLicenseCardView[];
  portalReleaseVersion: string | null;
}) {
  return (
    <>
      <div className="data-card" style={{ marginBottom: 22 }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 14,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <p style={{ margin: 0 }} className="form-hint">
            Ingelogd als <strong style={{ color: "var(--text)" }}>{email}</strong>
          </p>
          <PortalLogoutButton />
        </div>
      </div>

      {licenses.length === 0 ? (
        <div className="data-card">
          <p className="form-hint" style={{ margin: 0 }}>
            Er zijn geen licenties gekoppeld aan dit adres. Klopt dat niet? Neem contact op via{" "}
            <a href="mailto:info@arenacue.be">info@arenacue.be</a>.
          </p>
        </div>
      ) : null}

      {licenses.map((data) => (
        <div key={data.licenseKey} className="portal-result data-card" style={{ marginBottom: 22 }}>
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 12 }}
          >
            <h2 style={{ margin: 0, fontSize: "1.2rem" }}>{data.organizationLabel || "—"}</h2>
            <span className={`badge ${statusLabel(data.status).cls}`}>{statusLabel(data.status).text}</span>
          </div>
          <p className="form-hint" style={{ marginBottom: 12 }}>
            Sleutel:{" "}
            <strong style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>
              {data.licenseKey}
            </strong>
          </p>
          <p className="form-hint" style={{ marginBottom: 16 }}>
            Plan: <strong style={{ color: "var(--text)" }}>{data.planLabel}</strong>
            {" · "}
            Installaties:{" "}
            <strong style={{ color: "var(--text)" }}>
              {data.usedActivations}/{data.maxActivations}
            </strong>
            {data.validUntil ? (
              <>
                {" · "}
                Geldig tot:{" "}
                <strong style={{ color: "var(--text)" }}>{fmtDate(data.validUntil)}</strong>
              </>
            ) : (
              <>
                {" · "}
                Geldigheid: <strong style={{ color: "var(--text)" }}>onbeperkt</strong>
              </>
            )}
          </p>

          {data.status !== "active" ? (
            <p className="form-error" style={{ marginBottom: 16 }}>
              {data.status === "revoked"
                ? "Deze licentie is ingetrokken. Neem contact op met ArenaCue."
                : "Deze licentie is verlopen. Neem contact op met ArenaCue om te verlengen."}
            </p>
          ) : null}

          {data.status === "active" ? (
            <div
              style={{
                marginBottom: 20,
                padding: "14px 16px",
                borderRadius: 10,
                border: "1px solid rgba(0, 229, 255, 0.22)",
                background: "rgba(0, 229, 255, 0.06)",
              }}
            >
              <h3 style={{ margin: "0 0 10px", fontSize: "0.95rem", color: "var(--muted)" }}>Download</h3>
              {data.downloadUrl || data.ledboardingDownloadUrl || data.mobileDownloadUrl ? (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {data.downloadUrl ? (
                      <a
                        className="primary-button"
                        href={data.downloadUrl}
                        {...(data.downloadUrl.startsWith("http://") || data.downloadUrl.startsWith("https://")
                          ? { target: "_blank", rel: "noopener noreferrer" }
                          : {})}
                      >
                        {data.downloadLabel?.trim() || "Download"}
                      </a>
                    ) : null}
                    {data.ledboardingDownloadUrl ? (
                      <a
                        className="primary-button"
                        href={data.ledboardingDownloadUrl}
                        {...(data.ledboardingDownloadUrl.startsWith("http://") ||
                        data.ledboardingDownloadUrl.startsWith("https://")
                          ? { target: "_blank", rel: "noopener noreferrer" }
                          : {})}
                        style={
                          data.downloadUrl
                            ? {
                                background:
                                  "linear-gradient(135deg, rgba(25, 216, 255, 0.22), rgba(33, 243, 107, 0.18))",
                                border: "1px solid rgba(25, 216, 255, 0.35)",
                                color: "var(--text)",
                              }
                            : undefined
                        }
                      >
                        {data.ledboardingDownloadLabel?.trim() || "ArenaCue LED boarding"}
                      </a>
                    ) : null}
                    {data.mobileDownloadUrl ? (
                      <a
                        className="primary-button"
                        href={data.mobileDownloadUrl}
                        {...(data.mobileDownloadUrl.startsWith("http://") ||
                        data.mobileDownloadUrl.startsWith("https://")
                          ? { target: "_blank", rel: "noopener noreferrer" }
                          : {})}
                        style={
                          data.downloadUrl || data.ledboardingDownloadUrl
                            ? {
                                background:
                                  "linear-gradient(135deg, rgba(120, 119, 198, 0.26), rgba(99, 102, 241, 0.2))",
                                border: "1px solid rgba(120, 119, 198, 0.45)",
                                color: "var(--text)",
                              }
                            : undefined
                        }
                      >
                        {data.mobileDownloadLabel?.trim() || "ArenaCue mobiele app (Android)"}
                      </a>
                    ) : null}
                  </div>
                  <p className="form-hint" style={{ marginTop: 12, marginBottom: 0 }}>
                    Installeer ArenaCue op je Windows-pc met deze download(s). Bij vragen:{" "}
                    <a href="mailto:info@arenacue.be">info@arenacue.be</a>.
                    {portalReleaseVersion ? (
                      <>
                        {" "}
                        Publicatie scoreboard op dit portaal:{" "}
                        <strong style={{ fontFamily: "ui-monospace", color: "var(--text)" }}>
                          v{portalReleaseVersion}
                        </strong>
                        .
                      </>
                    ) : null}
                  </p>
                </>
              ) : (
                <p className="form-hint" style={{ margin: 0 }}>
                  Er is nog geen downloadlink geconfigureerd voor dit portaal. Neem contact op met ArenaCue of vraag je
                  beheerder om een link in te stellen (
                  <code style={{ color: "var(--cyan)" }}>NEXT_PUBLIC_PORTAL_DOWNLOAD_URL</code>, optioneel{" "}
                  <code style={{ color: "var(--cyan)" }}>NEXT_PUBLIC_PORTAL_LEDBOARDING_DOWNLOAD_URL</code>,{" "}
                  <code style={{ color: "var(--cyan)" }}>NEXT_PUBLIC_PORTAL_MOBILE_DOWNLOAD_URL</code>, of per
                  licentie).
                </p>
              )}
            </div>
          ) : null}

          <h3 style={{ margin: "18px 0 10px", fontSize: "0.95rem", color: "var(--muted)" }}>
            Geactiveerde machines
          </h3>
          {data.installations.length === 0 ? (
            <p className="form-hint">Nog geen installaties geregistreerd.</p>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Apparaat</th>
                    <th>Machine</th>
                    <th>Laatst actief</th>
                  </tr>
                </thead>
                <tbody>
                  {data.installations.map((i, idx) => (
                    <tr key={`${i.machinePreview}-${idx}`}>
                      <td>{i.deviceLabel}</td>
                      <td style={{ fontFamily: "ui-monospace, monospace" }}>{i.machinePreview}</td>
                      <td>{fmtDate(i.lastSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
