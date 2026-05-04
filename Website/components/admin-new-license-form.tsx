"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getAdminPathPrefix } from "@/lib/admin-url";

export function AdminNewLicenseForm() {
  const router = useRouter();
  const [organizationLabel, setOrganizationLabel] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [maxActivations, setMaxActivations] = useState(2);
  const [validUntil, setValidUntil] = useState("");
  const [plan, setPlan] = useState<"trial" | "standard" | "club" | "enterprise">("standard");
  const [notes, setNotes] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [autoKey, setAutoKey] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        organizationLabel,
        maxActivations,
        plan,
        notes: notes.trim() || null,
        downloadUrl: downloadUrl.trim() || null,
        ownerEmail: ownerEmail.trim() || "",
        validUntil: validUntil.trim() || null,
      };
      if (!autoKey && licenseKey.trim()) {
        body.licenseKey = licenseKey.trim();
      }
      const res = await fetch("/api/admin/licenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; licenseKey?: string };
      if (!res.ok || !data.ok) {
        setError(data.message ?? "Aanmaken mislukt.");
        return;
      }
      router.push(getAdminPathPrefix());
      router.refresh();
    } catch {
      setError("Netwerkfout.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="data-card">
      <p className="form-hint" style={{ marginBottom: 18 }}>
        <Link href={getAdminPathPrefix()}>← Terug naar overzicht</Link>
      </p>
      <h1 style={{ margin: "0 0 8px", fontSize: "1.5rem", letterSpacing: "-0.03em" }}>Nieuwe licentie</h1>
      <p className="form-hint" style={{ marginBottom: 22 }}>
        Vul het e-mailadres van de klant in zodat ze hun status kunnen bekijken op{" "}
        <Link href="/licentie">/licentie</Link>.
      </p>
      <form className="form-stack" onSubmit={onSubmit} style={{ maxWidth: 560 }}>
        <label>
          Organisatie / club
          <input value={organizationLabel} onChange={(e) => setOrganizationLabel(e.target.value)} required />
        </label>
        <label>
          E-mail klant (voor portaal)
          <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
          <span className="form-hint">Leeg laten = klant kan portaal niet gebruiken tot dit is ingevuld.</span>
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
          Geldig tot (optioneel)
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </label>
        <label>
          Plan
          <select value={plan} onChange={(e) => setPlan(e.target.value as typeof plan)}>
            <option value="trial">Trial</option>
            <option value="standard">Standard</option>
            <option value="club">Club</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </label>
        <label>
          Notities (intern)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label>
          Download-URL voor klant (optioneel)
          <input
            value={downloadUrl}
            onChange={(e) => setDownloadUrl(e.target.value)}
            placeholder="https://… of leeg voor globale site-URL"
          />
          <span className="form-hint">
            Leeg = gebruikt <code style={{ color: "var(--cyan)" }}>NEXT_PUBLIC_PORTAL_DOWNLOAD_URL</code> op
            Vercel.
          </span>
        </label>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="checkbox" checked={autoKey} onChange={(e) => setAutoKey(e.target.checked)} />
          <span>Sleutel automatisch genereren</span>
        </label>
        {!autoKey && (
          <label>
            Licentiesleutel
            <input value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} placeholder="ARENA-…" />
          </label>
        )}
        {error && <p className="form-error">{error}</p>}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "Opslaan…" : "Licentie aanmaken"}
          </button>
          <Link className="secondary-button" href={getAdminPathPrefix()}>
            Annuleren
          </Link>
        </div>
      </form>
    </div>
  );
}
