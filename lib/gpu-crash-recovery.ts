/**
 * Wat te doen als het grafische proces crasht.
 *
 * - "reload": beide vensters herladen (de gewone herstelstap).
 * - "reload-and-flag": herladen, en software-decode klaarzetten voor de volgende start.
 * - "relaunch": meteen herstarten met software-decode, omdat herladen niet hielp.
 */
export type GpuCrashAction = "reload" | "reload-and-flag" | "relaunch";

export const GPU_CRASH_STREAK_WINDOW_MS = 120_000;

export function nextGpuCrashStep(input: {
  /** Speelde er een sponsorvideo toen het misging? Alleen dan helpt software-decode. */
  sponsorVideoContext: boolean;
  /**
   * Draait déze sessie al met software-decode? Niet: staat de vlag op schijf. Die wordt bij de
   * eerste crash geschreven en geldt pas na een herstart; wie daarnaar keek, kwam bij een tweede
   * crash nooit meer aan de herstart toe en bleef crashen op dezelfde video.
   */
  softwareDecodeThisSession: boolean;
  nowMs: number;
  lastCrashAtMs: number;
  streak: number;
}): { action: GpuCrashAction; streak: number; lastCrashAtMs: number } {
  if (!input.sponsorVideoContext || input.softwareDecodeThisSession) {
    return { action: "reload", streak: input.streak, lastCrashAtMs: input.lastCrashAtMs };
  }
  const recent = input.lastCrashAtMs > 0 && input.nowMs - input.lastCrashAtMs < GPU_CRASH_STREAK_WINDOW_MS;
  const streak = recent ? input.streak + 1 : 1;
  return {
    action: streak >= 2 ? "relaunch" : "reload-and-flag",
    streak,
    lastCrashAtMs: input.nowMs,
  };
}
