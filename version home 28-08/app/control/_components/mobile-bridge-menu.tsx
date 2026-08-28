"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as QRCode from "qrcode";
import { toast } from "@/components/ui/toast";
import type { MobileBridgeInfo } from "@/lib/desktop-bridge";

function buildLocalPairCode(bridgeUrl: string, pairingCode: string, operatorPinForQr: string): string {
  return [
    "ACPAIR:local",
    encodeURIComponent(bridgeUrl),
    encodeURIComponent(pairingCode),
    encodeURIComponent(operatorPinForQr),
  ].join("|");
}

function PairCodeQr({ pairCode, label }: { pairCode: string; label: string }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!pairCode) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(pairCode, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 132,
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pairCode]);

  if (!qrDataUrl) return null;
  return <img src={qrDataUrl} alt={label} className="h-[96px] w-[96px] rounded-md bg-white p-1" />;
}

function MobileBridgePanel({ info }: { info: MobileBridgeInfo }) {
  const { t } = useTranslation();
  const [showOperatorSecrets, setShowOperatorSecrets] = useState(false);
  const bridgeUrl = info.bridgeUrls[0] ?? (info.port ? `http://localhost:${info.port}` : "");
  const localPairCodeViewer =
    info.pairCodes[0] ??
    (bridgeUrl && info.pairingCode ? buildLocalPairCode(bridgeUrl, info.pairingCode, "") : "");
  const localPairCodeOperator =
    info.pairCodesOperator?.[0] ??
    (bridgeUrl && info.pairingCode
      ? buildLocalPairCode(bridgeUrl, info.pairingCode, info.operatorPin ?? "")
      : "");
  const activeLanPairCode = showOperatorSecrets ? localPairCodeOperator : localPairCodeViewer;

  return (
    <div className="flex flex-col gap-3 p-4">
      {info.cloud.enabled && info.cloud.pairCode ? (
        <div className="rounded-lg border border-green-500/40 bg-card p-3 text-xs shadow-sm">
          <div className="flex items-start gap-3">
            <PairCodeQr pairCode={info.cloud.pairCode} label={t("bridge.cloudQrAlt")} />
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-green-500">{t("bridge.cloudTitle")}</span>
              <span className="text-muted-foreground">{t("bridge.cloudHint")}</span>
              <span className="font-mono text-muted-foreground">venue: {info.cloud.venueId}</span>
              <button
                type="button"
                className="w-fit font-mono text-primary underline"
                onClick={() => {
                  void navigator.clipboard?.writeText(info.cloud.pairCode ?? "");
                  toast({ title: t("bridge.cloudCodeCopied") });
                }}
              >
                {t("bridge.copyUrl")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {info.enabled && info.pairingCode ? (
        <div className="rounded-lg border border-border bg-card p-3 text-xs shadow-sm">
          <div className="flex items-start gap-3">
            <PairCodeQr pairCode={activeLanPairCode} label={t("bridge.lanQrAlt")} />
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-foreground">{t("bridge.lanTitle")}</span>
              <span className="text-muted-foreground">{t("bridge.hint")}</span>
              {!showOperatorSecrets ? (
                <span className="text-muted-foreground">{t("bridge.viewerOnlyHint")}</span>
              ) : null}
              <span className="font-mono text-muted-foreground">
                {t("bridge.pairingLabel")} {info.pairingCode}
              </span>
              {info.operatorPin && showOperatorSecrets ? (
                <span className="font-mono text-green-500">
                  {t("bridge.operatorPinLabel")} {info.operatorPin}
                </span>
              ) : info.operatorPin ? (
                <span className="font-mono text-muted-foreground">
                  {t("bridge.operatorPinLabel")} ••••••
                </span>
              ) : null}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded border-border"
                  checked={showOperatorSecrets}
                  onChange={(e) => setShowOperatorSecrets(e.target.checked)}
                />
                <span>{t("bridge.showOperatorSecrets")}</span>
              </label>
              {bridgeUrl ? (
                <button
                  type="button"
                  className="w-fit font-mono text-primary underline"
                  title={t("bridge.copyUrl")}
                  onClick={() => {
                    void navigator.clipboard?.writeText(bridgeUrl);
                    toast({ title: t("bridge.copyUrl"), description: bridgeUrl });
                  }}
                >
                  {bridgeUrl}
                </button>
              ) : null}
              {activeLanPairCode ? (
                <button
                  type="button"
                  className="w-fit text-primary underline"
                  onClick={() => {
                    void navigator.clipboard?.writeText(activeLanPairCode);
                    toast({
                      title: t("bridge.lanCodeCopied"),
                      description: showOperatorSecrets ? t("bridge.withPin") : t("bridge.viewerOnly"),
                    });
                  }}
                >
                  {t("bridge.copyUrl")}
                </button>
              ) : null}
              <span className={info.operatorPinConfigured ? "text-green-500" : "text-amber-500"}>
                {info.operatorPinConfigured ? t("bridge.connected") : t("bridge.viewerOnlyStatus")}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MobileBridgeMenu({ info }: { info: MobileBridgeInfo | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!info?.enabled && !info?.cloud.enabled) return null;

  const cloudActive = Boolean(info.cloud.enabled && info.cloud.pairCode);
  const lanActive = Boolean(info.enabled && info.pairingCode);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary/60 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
      >
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${cloudActive || lanActive ? "bg-green-500" : "bg-muted-foreground"}`} />
          {t("bridge.title")}
        </span>
        <span className="text-muted-foreground">{open ? "▴" : "▾"}</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={t("bridge.title")}
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(92vw,420px)] rounded-xl border border-border bg-card shadow-xl"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">{t("bridge.title")}</p>
            <p className="text-xs text-muted-foreground">{t("bridge.hint")}</p>
          </div>
          <MobileBridgePanel info={info} />
        </div>
      ) : null}
    </div>
  );
}
