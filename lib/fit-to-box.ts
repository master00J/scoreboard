/**
 * Inhoud passend maken binnen zijn vak.
 *
 * De vakken van een vrije indeling staan in percentages, maar lettergroottes stonden met
 * vuistregels per teken (`min(14cqh, 4.6cqw, 22px)`). Zo'n regel heeft altijd een randgeval: een
 * lange teamnaam, een andere taal, een ander lettertype, een smal vak. Een club zette zijn
 * scorevakken 15% breed en zag "SETS 0 TO 0/2" halverwege afgekapt worden — het vak heeft
 * `overflow: hidden`, dus wat niet paste verdween zonder enige melding.
 *
 * Meten kent die randgevallen niet. Deze functie zegt met welke factor de inhoud nog net past.
 */

/** Niet verder verkleinen dan dit; daaronder is het toch onleesbaar en is het vak gewoon te klein. */
export const FIT_MIN_SCALE = 0.45;

export function fitScale(
  needed: number,
  available: number,
  minScale: number = FIT_MIN_SCALE,
): number {
  if (!Number.isFinite(needed) || !Number.isFinite(available)) return 1;
  if (needed <= 0 || available <= 0) return 1;
  if (needed <= available) return 1;
  return Math.max(minScale, available / needed);
}

/**
 * Past de inhoud nog binnen het vak, al is het verkleind?
 *
 * Nee betekent dat de club het vak echt groter moet maken. Dat hoort hij te zien in de editor,
 * niet pas op de wand tijdens een wedstrijd.
 */
export function fitsWithinBox(
  needed: number,
  available: number,
  minScale: number = FIT_MIN_SCALE,
): boolean {
  if (!Number.isFinite(needed) || !Number.isFinite(available)) return true;
  if (needed <= 0 || available <= 0) return true;
  return needed * minScale <= available || needed <= available;
}
