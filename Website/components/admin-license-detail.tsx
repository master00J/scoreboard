"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { InstallationFullRow, LicenseFullRow } from "@/lib/license-admin-data";
import type { LicensePlanRow } from "@/lib/license-plan-admin-data";
import { getAdminPathPrefix } from "@/lib/admin-url";

function fmtDate(iso: string | null | undefined): string {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) {
    return "—";
  }
  return d.toLocaleString("nl-BE", { dateStyle: "medium", timeStyle: "short" });
}

export function AdminLicenseDetailClient(props: {
  license: LicenseFullRow;
  installations: InstallationFullRow[];
  plans: LicensePlanRow[];
}) {
  const router = useRouter();
  const { license: initial } = props;
  const plans = props.plans;
  const [license, setLicense] = useState(initial);
  const [installations, setInstallations] = useState(props.installations);
  const [organizationLabel, setOrganizationLabel] = useState(license.organization_label);
  const [ownerEmail, setOwnerEmail] = useState(license.owner_email ?? "");
  const [maxActivations, setMaxActivations] = useState(license.max_activations);
  const [validUntil, setValidUntil] = useState(
    license.valid_until ? license.valid_until.slice(0, 10) : "",
  );
  const [plan, setPlan] = useState(license.plan);
  const [notes, setNotes] = useState(license.notes ?? "");
  const [downloadUrl, setDownloadUrl] = useState(license.download_url ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const revoked = Boolean(license.revoked_at);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/licenses/${license.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          organizationLabel,
          ownerEmail: ownerEmail.trim() || "",
          maxActivations,
          validUntil: validUntil.trim() || null,
          plan,
          notes: notes.trim() || null,
          downloadUrl: downloadUrl.trim() || null,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setErr(data.message ?? "Opslaan mislukt.");
        return;
      }
      setMsg("Opgeslagen.");
      setLicense((prev) => ({
        ...prev,
        organization_label: organizationLabel,
        owner_email: ownerEmail.trim() || null,
        max_activations: maxActivations,
        valid_until: validUntil.trim() ? `${validUntil.trim()}T23:59:59.999Z` : null,
        plan,
        notes: notes.trim() || null,
        download_url: downloadUrl.trim() || null,
      }));
      router.refresh();
    } catch {
      setErr("Netwerkfout.");
    } finally {
      setSaving(false);
    }
  }

  async function setRevoked(next: boolean) {
    setErr(null);
    setMsg(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/licenses/${license.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ revoked: next }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setErr(data.message ?? "Mislukt.");
        return;
      }
      setLicense((prev) => ({
        ...prev,
        revoked_at: next ? new Date().toISOString() : null,
      }));
      setMsg(next ? "Licentie ingetrokken." : "Intrekking opgeheven.");
      router.refresh();
    } catch {
      setErr("Netwerkfout.");
    } finally {
      setSaving(false);
    }
  }

  async function removeInstallation(id: string) {
    if (!confirm("Deze installatie verwijderen? De machine kan opnieuw activeren als er nog plek is.")) {
      return;
    }
    setErr(null);
    try {
      const res = await fetch(`/api/admin/installations/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setErr(data.message ?? "Verwijderen mislukt.");
        return;
      }
      setInstallations((prev) => prev.filter((x) => x.id !== id));
      setMsg("Installatie verwijderd.");
    } catch {
      setErr("Netwerkfout.");
    }
  }

  return (
    <div>
      <p className="form-hint" style={{ marginBottom: 18 }}>
        <Link href={getAdminPathPrefix()}>← Terug naar overzicht</Link>
      </p>

      <div className="data-card" style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontSize: "1.45rem", letterSpacing: "-0.03em" }}>Licentie</h1>
          {revoked ? (
            <span className="badge badge-bad">Ingetrokken</span>
          ) : (
            <span className="badge badge-ok">Actief</span>
          )}
        </div>
        <p style={{ margin: "0 0 6px", color: "var(--muted)", fontSize: "0.86rem" }}>Sleutel (geef dit door aan de klant)</p>
        <code
          style={{
            display: "block",
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid var(--line-strong)",
            background: "rgba(2,6,23,0.85)",
            fontSize: "1.05rem",
            letterSpacing: "0.04em",
            wordBreak: "break-all",
          }}
        >
          {license.license_key}
        </code>
        <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 10 }}>
          {revoked ? (
            <button type="button" className="secondary-button" disabled={saving} onClick={() => void setRevoked(false)}>
              Intrekking opheffen
            </button>
          ) : (
            <button type="button" className="secondary-button" disabled={saving} onClick={() => void setRevoked(true)}>
              Licentie intrekken
            </button>
          )}
        </div>
      </div>

      <div className="data-card" style={{ marginBottom: 22 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: "1.1rem" }}>Installaties ({installations.length}/{license.max_activations})</h2>
        {installations.length === 0 ? (
          <p className="form-hint">Nog geen machines geactiveerd.</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Machine-id</th>
                  <th>Laatst gezien</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {installations.map((i) => (
                  <tr key={i.id}>
                    <td>{i.device_label || "—"}</td>
                    <td style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }}>{i.machine_id}</td>
                    <td>{fmtDate(i.last_seen_at)}</td>
                    <td>
                      <button type="button" className="secondary-button" onClick={() => void removeInstallation(i.id)}>
                        Verwijderen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="data-card">
        <h2 style={{ margin: "0 0 16px", fontSize: "1.1rem" }}>Gegevens bewerken</h2>
        <form className="form-stack" onSubmit={(e) => void save(e)} style={{ maxWidth: 560 }}>
          <label>
            Organisatie
            <input value={organizationLabel} onChange={(e) => setOrganizationLabel(e.target.value)} required />
          </label>
          <label>
            E-mail klant (portaal)
            <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
          </label>
          <label>
            Max. installaties
            <input
              type="number"
              min={1}
              max={500}
              value={maxActivations}
              onChange={(e) => setMaxActivations(Number(e.target.value))}
              required
            />
          </label>
          <label>
            Geldig tot
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </label>
          <label>
            Plan
            <select value={plan} onChange={(e) => setPlan(e.target.value)}>
              {!plans.some((item) => item.code === plan) && <option value={plan}>{plan}</option>}
              {plans.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Notities
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label>
            Download-URL (portaal, optioneel)
            <input
              value={downloadUrl}
              onChange={(e) => setDownloadUrl(e.target.value)}
              placeholder="https://… of /downloads/bestand.exe"
            />
            <span className="form-hint">
              Overschrijft de globale Vercel-URL. Leeg = gebruik{" "}
              <code style={{ color: "var(--cyan)" }}>NEXT_PUBLIC_PORTAL_DOWNLOAD_URL</code>.
            </span>
          </label>
          {err && <p className="form-error">{err}</p>}
          {msg && <p className="form-hint" style={{ color: "var(--green)" }}>{msg}</p>}
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? "Bezig…" : "Wijzigingen opslaan"}
          </button>
        </form>
      </div>
    </div>
  );
}
