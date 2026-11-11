/**
 * Wat de licentiecontrole bij het opstarten teruggeeft, voor zover het hier telt.
 *
 * De licentieserver antwoordt bij een echte weigering (onbekende sleutel, ingetrokken, verlopen)
 * met een `reason`. Een storing aan de kant van de server (te veel aanvragen, onderhoud, een
 * gateway-fout) geeft een foutantwoord zónder `reason`.
 */
export type LicenseCheckOutcome =
  | { kind: "ok" }
  | { kind: "network" }
  | { kind: "error"; message: string; reason?: string };

/**
 * Is de licentieserver niet te bereiken of zelf in storing? Dan zegt het antwoord niets over de
 * licentie van de club en geldt dezelfde offline-periode als zonder internet. Vroeger sloot een
 * serverfout op wedstrijddag het bedieningspaneel af, terwijl de licentie gewoon geldig was.
 */
export function licenseServerUnavailable(outcome: LicenseCheckOutcome): boolean {
  if (outcome.kind === "network") return true;
  if (outcome.kind !== "error") return false;
  return typeof outcome.reason !== "string" || outcome.reason.trim() === "";
}
