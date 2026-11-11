"use client";

import { sendCommand } from "./use-socket";
import { createRepeatGuard, PERIOD_REPEAT_GUARD_MS } from "./operator-guards";
import type { MatchStatusT } from "./validation/commands";

/**
 * Na een periodewissel verandert de knop van betekenis: "Verlenging" wordt de volgende verlenging.
 * Een dubbelklik sloeg zo de eerste verlenging over. Alle periodeknoppen van de bediening komen
 * hierlangs, dus één wissel per seconde, welke knop het ook was.
 */
const acceptPeriodChange = createRepeatGuard(PERIOD_REPEAT_GUARD_MS);

/**
 * Periodewissel vanuit de bediening. Displaymodus (scorebord + sponsors vs. alleen scorebord)
 * volgt de laatste operatorvoorkeur op de server — niet de licentie.
 */
export async function applyLivePeriod(period: number, _automaticSponsorsAllowed?: boolean) {
  if (!acceptPeriodChange("period")) return { ok: true, result: { unchanged: true } };
  return sendCommand({ type: "sport:setPeriod", period });
}

export async function applyLivePhase(status: MatchStatusT, _automaticSponsorsAllowed?: boolean) {
  return sendCommand({ type: "match:setStatus", status });
}

/** Voetbal-klokpresets (1e/2e helft, verlenging): klok naar 0 van die periode, sponsoring reset. */
export async function applyLivePreset(
  preset: "FIRST_HALF" | "SECOND_HALF" | "ET1" | "ET2",
  _automaticSponsorsAllowed?: boolean,
) {
  return sendCommand({ type: "timer:preset", preset });
}
