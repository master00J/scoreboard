/**
 * Welke afbeeldingen het mediavak tekent tijdens een wissel, onderaan eerst.
 *
 * Een nieuw `<img>` is één of twee beelden leeg tot de afbeelding gedecodeerd is. Op het
 * stadionscherm gaf dat een zwarte flits in het vak bij elke sponsorwissel, en de live preview
 * (een opname van dat venster) bleef soms op dat zwarte beeld hangen tot de volgende wissel.
 * Daarom blijft het vorige beeld staan tot het nieuwe klaar is en erboven geschilderd is.
 */

/** Het nieuwe beeld is geladen en gedecodeerd: leg het boven het huidige. Nooit meer dan twee. */
export function imageLayersAfterDecoded(layers: readonly string[], src: string): string[] {
  const top = layers[layers.length - 1];
  if (top === src) return [...layers];
  return top == null ? [src] : [top, src];
}

/** Het bovenste beeld staat op het scherm: wat eronder lag mag weg. */
export function imageLayersAfterPainted(layers: readonly string[], src: string): string[] {
  const top = layers[layers.length - 1];
  return top === src ? [src] : [...layers];
}
