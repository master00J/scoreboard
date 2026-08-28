"use client";

import { useState } from "react";

export function PortalLoginPanel({
  linkError,
}: {
  /** Query `?fout=link`: verlopen of ongeldige magic link. */
  linkError?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const res = await fetch("/api/portal/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string };
      if (!json.ok) {
        setError(json.message ?? "Er ging iets mis.");
        return;
      }
      setMessage(json.message ?? null);
      setEmail("");
    } catch {
      setError("Netwerkfout. Probeer later opnieuw.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="data-card">
      <h2 style={{ margin: "0 0 8px", fontSize: "1.35rem", letterSpacing: "-0.03em" }}>Inloggen</h2>
      <p className="form-hint" style={{ marginBottom: 18 }}>
        Vul het e-mailadres in dat bij je ArenaCue-licentie staat als <strong>eigenaar</strong>. Je ontvangt een
        loginlink die 15 minuten geldig is.
      </p>
      {linkError ? (
        <p className="form-error" style={{ marginBottom: 14 }}>
          De loginlink is ongeldig of verlopen. Vraag hieronder een nieuwe link aan.
        </p>
      ) : null}
      <form className="form-stack" onSubmit={(e) => void onSubmit(e)} style={{ maxWidth: 480 }}>
        <label>
          E-mailadres
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        {message ? (
          <p className="form-hint" style={{ color: "var(--cyan)", margin: 0 }}>
            {message}
          </p>
        ) : null}
        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? "Bezig…" : "Verstuur loginlink"}
        </button>
      </form>
    </div>
  );
}
