import { app } from "electron";
import type { AppResourceMetrics } from "../lib/desktop-bridge";

/**
 * Geheugen per proces in KB volgens Electron MemoryInfo (alle waarden in KB).
 * Op Windows levert `privateBytes` private geheugen zonder gedeelde code/data tussen
 * processen dubbel te tellen — dat sluit beter aan bij Taakbeheer dan som(workingSet).
 */
function memoryFootprintKb(mem: { privateBytes?: number; workingSetSize: number } | undefined): number {
  if (!mem) return 0;
  if (typeof mem.privateBytes === "number") return mem.privateBytes;
  return mem.workingSetSize ?? 0;
}

/**
 * Verzamelt CPU- en RAM-cijfers voor alle Electron/Chromium-processen van deze app.
 * GPU: `percentCPUUsage` van het Chromium GPU-hulpproces (geen directe GPU-chipbelasting).
 */
export function getAppResourceMetrics(): AppResourceMetrics {
  const metrics = app.getAppMetrics();
  let cpuNonGpu = 0;
  let gpuCpu = 0;
  let ramTotalKb = 0;
  let gpuRamKb = 0;

  for (const m of metrics) {
    const pct = m.cpu?.percentCPUUsage ?? 0;
    const kb = memoryFootprintKb(m.memory);
    ramTotalKb += kb;
    if (m.type === "GPU") {
      gpuCpu += pct;
      gpuRamKb += kb;
    } else {
      cpuNonGpu += pct;
    }
  }

  const round1 = (n: number) => Math.round(n * 10) / 10;

  return {
    cpuNonGpuPercent: round1(cpuNonGpu),
    gpuCpuPercent: round1(gpuCpu),
    ramTotalMb: round1(ramTotalKb / 1024),
    gpuRamMb: round1(gpuRamKb / 1024),
    cpuTotalPercent: round1(cpuNonGpu + gpuCpu),
  };
}

/** RAM per Chromium-procestype (MB) voor periodieke boot.log-regels. */
export function getMemoryBreakdownForBootLog(): string {
  const metrics = app.getAppMetrics();
  const byType: Record<string, { mb: number; n: number }> = {};
  for (const m of metrics) {
    const t = String(m.type);
    if (!byType[t]) byType[t] = { mb: 0, n: 0 };
    byType[t].mb += memoryFootprintKb(m.memory) / 1024;
    byType[t].n += 1;
  }
  return Object.entries(byType)
    .sort((a, b) => b[1].mb - a[1].mb)
    .map(([k, v]) => `${k}:${Math.round(v.mb * 10) / 10}MB×${v.n}`)
    .join(" | ");
}
