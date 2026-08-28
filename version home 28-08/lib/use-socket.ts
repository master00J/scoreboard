"use client";

import { useEffect } from "react";
import { useDisplayStore } from "./store";
import type { Command } from "./validation/commands";
import type { ElectronBridge } from "./desktop-bridge";
import type {
  SponsorTelemetryClipEnd,
  SponsorTelemetryClipProgress,
  SponsorTelemetryClipStart,
} from "./sponsor-telemetry";

async function waitForElectronApi(timeoutMs = 10000): Promise<ElectronBridge | null> {
  if (typeof window === "undefined") return null;
  if (window.electronAPI) return window.electronAPI;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.electronAPI) return window.electronAPI;
    await new Promise((r) => setTimeout(r, 25));
  }
  return window.electronAPI ?? null;
}

export function useSocketSync(skip: boolean = false) {
  const setState = useDisplayStore((s) => s.setState);
  const setTick = useDisplayStore((s) => s.setTick);
  const setSponsorLedger = useDisplayStore((s) => s.setSponsorLedger);
  const setConnected = useDisplayStore((s) => s.setConnected);

  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const api = await waitForElectronApi();
      if (cancelled) return;
      if (!api) {
        setConnected(false);
        console.warn("[use-socket] electronAPI never became available");
        return;
      }

      const offState = api.onDisplayState((state) => setState(state));
      const offTick = api.onTick((tick) => setTick(tick));
      const offLedger = api.onSponsorLedger((ledger) => setSponsorLedger(ledger));

      try {
        const snapshot = await api.getDisplaySnapshot();
        if (!cancelled) {
          if (snapshot) setState(snapshot);
          setConnected(true);
        }
        try {
          const ledger = await api.getSponsorLedgerSnapshot();
          if (!cancelled) setSponsorLedger(ledger ?? null);
        } catch {
          /* ignore */
        }
      } catch (err) {
        if (!cancelled) {
          setConnected(false);
          console.error("[use-socket] snapshot failed", err);
        }
      }

      cleanup = () => {
        offState();
        offTick();
        offLedger();
        setConnected(false);
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [setState, setTick, setSponsorLedger, setConnected, skip]);
}

export async function reportSponsorClipStart(payload: SponsorTelemetryClipStart) {
  const api = await waitForElectronApi(800);
  if (!api) return;
  await api.reportSponsorClipStart(payload);
}

export async function reportSponsorClipEnd(payload: SponsorTelemetryClipEnd) {
  const api = await waitForElectronApi(800);
  if (!api) return;
  await api.reportSponsorClipEnd(payload);
}

export async function reportSponsorClipProgress(payload: SponsorTelemetryClipProgress) {
  const api = await waitForElectronApi(800);
  if (!api?.reportSponsorClipProgress) return;
  await api.reportSponsorClipProgress(payload);
}

export async function sendCommand(cmd: Command) {
  const api = await waitForElectronApi(2000);
  if (!api) {
    return { ok: false, error: "Electron bridge unavailable" };
  }
  return api.sendCommand(cmd);
}

export function onDisplayError(listener: (payload: { message: string }) => void) {
  let active = true;
  let unsubscribe: (() => void) | null = null;
  void (async () => {
    const api = await waitForElectronApi();
    if (!active || !api) return;
    unsubscribe = api.onDisplayError(listener);
  })();
  return () => {
    active = false;
    unsubscribe?.();
  };
}
