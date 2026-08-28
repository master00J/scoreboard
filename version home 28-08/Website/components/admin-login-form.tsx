"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { getAdminPathPrefix } from "@/lib/admin-url";

export function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefix = getAdminPathPrefix();
  const nextPath = searchParams.get("next") || prefix;

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setError(data.message ?? "Inloggen mislukt.");
        return;
      }
      router.push(nextPath.startsWith(prefix) ? nextPath : prefix);
      router.refresh();
    } catch {
      setError("Netwerkfout. Probeer opnieuw.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="data-card" style={{ maxWidth: 440, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 8px", fontSize: "1.65rem", letterSpacing: "-0.04em" }}>ArenaCue admin</h1>
      <p className="form-hint" style={{ marginBottom: 22 }}>
        Log in om licenties te beheren. Gebruik het wachtwoord uit je serverconfiguratie.
      </p>
      <form className="form-stack" onSubmit={onSubmit}>
        <label>
          Wachtwoord
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? "Bezig…" : "Inloggen"}
        </button>
      </form>
    </div>
  );
}
