"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isElectron } from "@/lib/electron";
import type { LicenseGetStatusResult } from "@/lib/desktop-bridge";
import { CHANGE_LICENSE_EVENT, notifyLicenseChanged } from "@/lib/license-ui";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

type Phase = "loading" | "ok" | "gate";

export function LicenseActivationGate(props: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("loading");
  const [replaceMode, setReplaceMode] = useState(false);
  const [gateInfo, setGateInfo] = useState<Omit<Extract<LicenseGetStatusResult, { gate: true }>, "gate"> | null>(
    null,
  );
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const showForcedGate = useCallback((s: Extract<LicenseGetStatusResult, { gate: true }>) => {
    setReplaceMode(false);
    setGateInfo({
      machinePreview: s.machinePreview,
      message: s.message,
      prefillLicenseKey: s.prefillLicenseKey ?? null,
    });
    setKey((s.prefillLicenseKey ?? "").trim());
    setPhase("gate");
  }, []);

  const load = useCallback(async () => {
    if (typeof window === "undefined" || !isElectron || !window.electronAPI?.licenseGetStatus) {
      setReplaceMode(false);
      setPhase("ok");
      return;
    }
    setPhase("loading");
    setLocalErr(null);
    try {
      const s = await window.electronAPI.licenseGetStatus();
      if (!s.gate) {
        setReplaceMode(false);
        setGateInfo(null);
        setPhase("ok");
        return;
      }
      showForcedGate(s);
    } catch {
      setReplaceMode(false);
      setPhase("ok");
    }
  }, [showForcedGate]);

  const openReplace = useCallback(async () => {
    if (typeof window === "undefined" || !isElectron || !window.electronAPI?.licenseGetStatus) {
      return;
    }
    setLocalErr(null);
    setKey("");
    try {
      const s = await window.electronAPI.licenseGetStatus();
      if (s.gate) {
        showForcedGate(s);
        return;
      }
      setReplaceMode(true);
      setGateInfo({
        machinePreview: s.machinePreview ?? "—",
        message: t("license.replaceHint"),
        prefillLicenseKey: null,
      });
      setPhase("gate");
    } catch {
      setReplaceMode(false);
      setPhase("ok");
    }
  }, [showForcedGate, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => {
      void openReplace();
    };
    window.addEventListener(CHANGE_LICENSE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_LICENSE_EVENT, onChange);
  }, [openReplace]);

  async function onActivate() {
    const trimmed = key.trim().toUpperCase();
    if (trimmed.length < 8) {
      setLocalErr(t("license.keyTooShort"));
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
      const wasReplace = replaceMode;
      await load();
      notifyLicenseChanged();
      if (wasReplace) {
        toast({
          title: t("license.changed"),
          description: res.organizationLabel ?? res.planLabel ?? undefined,
          variant: "success",
        });
      }
    } catch {
      setLocalErr(t("license.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  function onCancelReplace() {
    setReplaceMode(false);
    setLocalErr(null);
    setKey("");
    setGateInfo(null);
    setPhase("ok");
  }

  async function openPortal() {
    await window.electronAPI?.openExternalUrl("https://arenacue.be/portal");
  }

  if (!isElectron || phase === "ok") {
    return <>{props.children}</>;
  }

  const overlay =
    phase === "loading" ? (
      <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-3 bg-background/95">
        <p className="text-sm text-muted-foreground">{t("license.checking")}</p>
      </div>
    ) : (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/98 p-4">
        <div className="w-full max-w-md space-y-5 rounded-xl border border-border bg-card p-6 shadow-lg">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{t("license.title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(replaceMode ? "license.replaceBody" : "license.body")}{" "}
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
            <span className="text-sm font-medium">{t("license.keyLabel")}</span>
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
              {busy ? t("license.activating") : t("license.activate")}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void openPortal()}>
              {t("license.openPortal")}
            </Button>
            {replaceMode ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={onCancelReplace}>
                {t("license.cancel")}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{t("license.afterActivate")}</p>
        </div>
      </div>
    );

  if (replaceMode) {
    return (
      <>
        {props.children}
        {overlay}
      </>
    );
  }

  return overlay;
}
