/**
 * Schaal waarmee een tekst binnen zijn vak past. `boost` is de vergroting die het vak al op de tekst
 * zet ("Tekstgrootte"). Past de tekst, dan 1: dan verandert er niets aan het beeld. Anders iets kleiner
 * dan strikt nodig, zodat de tekst niet tegen de rand van het vak plakt.
 */
export const FIT_MARGIN = 0.94;

export function fitScale(
  content: { width: number; height: number },
  box: { width: number; height: number },
  boost = 1,
): number {
  const grow = boost > 0 && Number.isFinite(boost) ? boost : 1;
  if (!(content.width > 0) || !(content.height > 0) || !(box.width > 0) || !(box.height > 0)) return 1;
  const room = Math.min(box.width / (content.width * grow), box.height / (content.height * grow));
  if (room >= 1) return 1;
  return Math.max(0.05, Math.floor(room * FIT_MARGIN * 1000) / 1000);
}
