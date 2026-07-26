"use client";

import { useEffect, useRef, useState } from "react";
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
            <PairCodeQr pairCode={info.cloud.pairCode} label="Cloud QR-code" />
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-green-500">Mobiele app via cloud</span>
              <span className="text-muted-foreground">Werkt ook buiten hetzelfde netwerk.</span>
              <span className="font-mono text-muted-foreground">venue: {info.cloud.venueId}</span>
              <button
                type="button"
                className="w-fit font-mono text-primary underline"
                onClick={() => {
                  void navigator.clipboard?.writeText(info.cloud.pairCode ?? "");
                  toast({ title: "Cloud koppelcode gekopieerd" });
                }}
              >
                Kopieer cloud-code
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {info.enabled && info.pairingCode ? (
        <div className="rounded-lg border border-border bg-card p-3 text-xs shadow-sm">
          <div className="flex items-start gap-3">
            <PairCodeQr pairCode={activeLanPairCode} label="LAN QR-code" />
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-foreground">Mobiele app via LAN</span>
              <span className="text-muted-foreground">Snelste optie op hetzelfde netwerk.</span>
              {!showOperatorSecrets ? (
                <span className="text-muted-foreground">
                  Standaardtoon: alleen <strong>viewer</strong>-QR (geen operator-PIN in de code). Vink hieronder aan
                  om operator-koppelcode en PIN te tonen.
                </span>
              ) : null}
              <span className="font-mono text-muted-foreground">pairing: {info.pairingCode}</span>
              {info.operatorPin && showOperatorSecrets ? (
                <span className="font-mono text-green-500">operator PIN: {info.operatorPin}</span>
              ) : info.operatorPin ? (
                <span className="font-mono text-muted-foreground">operator PIN: ••••••</span>
              ) : null}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded border-border"
                  checked={showOperatorSecrets}
                  onChange={(e) => setShowOperatorSecrets(e.target.checked)}
                />
                <span>Toon operator-PIN en volledige LAN-koppelcode (QR)</span>
              </label>
              {bridgeUrl ? (
                <button
                  type="button"
                  className="w-fit font-mono text-primary underline"
                  title="Klik om Bridge URL te kopiëren"
                  onClick={() => {
                    void navigator.clipboard?.writeText(bridgeUrl);
                    toast({ title: "Bridge URL gekopieerd", description: bridgeUrl });
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
                      title: "LAN koppelcode gekopieerd",
                      description: showOperatorSecrets ? "Inclusief operator-PIN" : "Alleen viewer",
                    });
                  }}
                >
                  Kopieer LAN-code
                </button>
              ) : null}
              <span className={info.operatorPinConfigured ? "text-green-500" : "text-amber-500"}>
                {info.operatorPinConfigured ? "operator actief" : "viewer only"}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MobileBridgeMenu({ info }: { info: MobileBridgeInfo | null }) {
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
          Mobiele app
        </span>
        <span className="text-muted-foreground">{open ? "▴" : "▾"}</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Mobiele app koppelen"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(92vw,420px)] rounded-xl border border-border bg-card shadow-xl"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Mobiele app koppelen</p>
            <p className="text-xs text-muted-foreground">Scan een QR-code of kopieer de koppelcode.</p>
          </div>
          <MobileBridgePanel info={info} />
        </div>
      ) : null}
    </div>
  );
}
