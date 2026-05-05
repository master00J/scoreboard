"use client";

import { useCallback, useEffect, useState } from "react";
import { isElectron } from "@/lib/electron";
import type { LicenseGetStatusResult } from "@/lib/desktop-bridge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Phase = "loading" | "ok" | "gate";

export function LicenseActivationGate(props: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [gateInfo, setGateInfo] = useState<Omit<Extract<LicenseGetStatusResult, { gate: true }>, "gate"> | null>(
    null,
  );
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (typeof window === "undefined" || !isElectron || !window.electronAPI?.licenseGetStatus) {
      setPhase("ok");
      return;
    }
    setPhase("loading");
    setLocalErr(null);
    try {
      const s = await window.electronAPI.licenseGetStatus();
      if (!s.gate) {
        setGateInfo(null);
        setPhase("ok");
        return;
      }
      setGateInfo({
        machinePreview: s.machinePreview,
        message: s.message,
        prefillLicenseKey: s.prefillLicenseKey ?? null,
      });
      setKey((s.prefillLicenseKey ?? "").trim());
      setPhase("gate");
    } catch {
      setPhase("ok");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onActivate() {
    const trimmed = key.trim().toUpperCase();
    if (trimmed.length < 8) {
      setLocalErr("Voer je volledige licentiesleutel in (formaat ARENA-…).");
      return;
    }
    if (!window.electronAPI?.licenseActivate) return;
    setBusy(true);
    setLocalErr(null);
    try {
      const res = await window.electronAPI.licenseActivate({ licenseKey: trimmed });
      if (!res.ok) {
        setLocalErr(res.message);
        return;
      }
      await load();
    } catch {
      setLocalErr("Onverwachte fout. Probeer opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  async function openPortal() {
    await window.electronAPI?.openExternalUrl("https://arenacue.be/portal");
  }

  if (!isElectron || phase === "ok") {
    return <>{props.children}</>;
  }

  if (phase === "loading") {
    return (
      <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-3 bg-background/95">
        <p className="text-sm text-muted-foreground">Licentie controleren…</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/98 p-4">
      <div className="w-full max-w-md space-y-5 rounded-xl border border-border bg-card p-6 shadow-lg">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">ArenaCue-licentie</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Activeer deze installatie met je licentiesleutel. Machine-id (voor support):{" "}
            <span className="font-mono text-xs text-foreground">{gateInfo?.machinePreview ?? "—"}</span>
          </p>
        </div>
        {gateInfo?.message && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            {gateInfo.message}
          </p>
        )}
        {localErr && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {localErr}
          </p>
        )}
        <label className="block space-y-2">
          <span className="text-sm font-medium">Licentiesleutel</span>
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="ARENA-XXXX-XXXX-XXXX"
            autoComplete="off"
            className="font-mono text-sm"
          />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" disabled={busy} onClick={() => void onActivate()}>
            {busy ? "Bezig…" : "Activeren op deze pc"}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void openPortal()}>
            Licentie & download (website)
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Na activeren kun je je installaties bekijken op{" "}
          <span className="text-foreground">arenacue.be/portal</span> met dezelfde sleutel en je e-mailadres.
        </p>
      </div>
    </div>
  );
}
