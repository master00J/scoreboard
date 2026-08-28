"use client";

import { useEffect, useState } from "react";
import { isElectron } from "@/lib/electron";
import type { AppResourceMetrics } from "@/lib/desktop-bridge";

const TOOLTIP =
  "CPU: Chromium percentCPUUsage (kan kort afwijken van Taakbeheer door ander meetinterval). GPU = GPU-hulpproces (CPU-tijd), geen GPU-chipmeter. RAM: op Windows som van private geheugen per proces (niet som van werksets — die dubbeltelt gedeelde pagina's), vergelijkbaar met de kolom Geheugen bij Electron in Taakbeheer.";

export function AppResourceMeter() {
  const [metrics, setMetrics] = useState<AppResourceMetrics | null>(null);

  useEffect(() => {
    if (!isElectron || !window.electronAPI?.getAppResourceMetrics) return;
    let cancelled = false;
    async function tick() {
      try {
        const next = await window.electronAPI.getAppResourceMetrics();
        if (!cancelled) setMetrics(next);
      } catch {
        /* ignore */
      }
    }
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!isElectron || !metrics) return null;

  return (
    <div
      className="hidden sm:block text-right text-xs text-muted-foreground font-mono leading-tight max-w-[14rem]"
      title={TOOLTIP}
    >
      <div>
        CPU {metrics.cpuNonGpuPercent}% · GPU {metrics.gpuCpuPercent}% · RAM {metrics.ramTotalMb}{" "}
        MB
      </div>
      <div className="text-[10px] opacity-90">
        Totaal: {metrics.cpuTotalPercent}% CPU · {metrics.ramTotalMb} MB RAM
      </div>
    </div>
  );
}
