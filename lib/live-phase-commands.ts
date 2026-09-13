"use client";

import { sendCommand } from "./use-socket";
import type { MatchStatusT } from "./validation/commands";

/**
 * Eén flow voor elke periodewissel vanuit de bediening (voetbal-fases, quarter/set-knoppen,
 * verlenging): stand + klok via de server, daarna de displaymodus zoals bij voetbal:
 * speelperiodes tonen automatisch «scorebord + sponsors» als de licentie dat toelaat.
 */
export async function applyLivePeriod(period: number, automaticSponsorsAllowed: boolean) {
  const result = await sendCommand({ type: "sport:setPeriod", period });
  if (!result.ok) return result;
  return sendCommand({
    type: "display:setMode",
    mode: automaticSponsorsAllowed ? "SPONSOR_ROTATION" : "MATCH",
  });
}

export async function applyLivePhase(status: MatchStatusT, automaticSponsorsAllowed: boolean) {
  const result = await sendCommand({ type: "match:setStatus", status });
  if (!result.ok) return result;
  const liveHalfWithSponsors =
    automaticSponsorsAllowed &&
    (status === "FIRST_HALF" || status === "SECOND_HALF" || status === "EXTRA_TIME");
  return sendCommand({
    type: "display:setMode",
    mode: liveHalfWithSponsors ? "SPONSOR_ROTATION" : "MATCH",
  });
}

/** Voetbal-klokpresets (1e/2e helft, verlenging) inclusief displaymodus. */
export async function applyLivePreset(
  preset: "FIRST_HALF" | "SECOND_HALF" | "ET1" | "ET2",
  automaticSponsorsAllowed: boolean,
) {
  const result = await sendCommand({ type: "timer:preset", preset });
  if (!result.ok) return result;
  return sendCommand({
    type: "display:setMode",
    mode: automaticSponsorsAllowed ? "SPONSOR_ROTATION" : "MATCH",
  });
}
