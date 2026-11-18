/**
 * Hoe de livestream reageert als een sponsorbestand hapert (fout, vastgelopen of te vroeg "klaar").
 * Een hapering kan tijdelijk zijn (schijf even traag, decoder die opnieuw moet starten), dus het
 * bestand krijgt eerst een nieuwe poging. Pas als het opnieuw misgaat, slaat de stream het over tot
 * de media van die sponsor verandert.
 */

/** Aantal nieuwe pogingen per vertoning voordat een bestand wordt overgeslagen. */
export const STREAM_MEDIA_RETRIES = 1;

export type StreamMediaFailureAction = "retry" | "skip";

/** `failures` = hoeveel keer dit bestand in deze vertoning al haperde, deze keer inbegrepen. */
export function streamMediaFailureAction(failures: number): StreamMediaFailureAction {
  return failures > STREAM_MEDIA_RETRIES ? "skip" : "retry";
}
