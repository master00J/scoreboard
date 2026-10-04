/** Statussen waarin de operator niet met een wedstrijd bezig is: nog instellen of al afgelopen. */
const IDLE_STATUSES = new Set(["SETUP", "FULL_TIME", "POST_MATCH"]);

/**
 * True vanaf de voorbeschouwing tot het eindsignaal van een open wedstrijd. In die tijd mag
 * het bedieningspaneel niets tonen dat de operator onderbreekt of knoppen verschuift.
 * Een onbekende status (bv. een nieuwe sportfase) telt als bezig: liever te stil dan te storend.
 */
export function isMatchInPlay(match: { status: string; closedAt?: string | null } | null | undefined): boolean {
  if (!match || match.closedAt) return false;
  return !IDLE_STATUSES.has(match.status);
}
