/**
 * L-frame alleen als er nu iets naast het scorebord hoort.
 *
 * Eerder bleef het L-frame een hele speelhelft hangen, ook als er geen clip meer
 * speelde. Dan verscheen het volledige scorebord in het videovak — dubbel.
 * `raw` wint daarom altijd: geen clip ⇒ fullscreen scorebord.
 */

export type AutoLeftLatch = {
  /** Fasesleutel waarvoor de latch geldt (`matchId|status`). */
  key: string;
  /** True zodra het L-frame in deze fase minstens één keer actief was. */
  engaged: boolean;
};

export type AutoLeftLatchRef = { current: AutoLeftLatch | null };

export function autoLeftLatchKey(
  matchId: string | undefined,
  status: string | undefined,
): string {
  return `${matchId ?? "none"}|${status ?? "none"}`;
}

/**
 * Fases waarin de vorm stabiel moet blijven: het lopende spel. Buiten deze fases
 * (rust, voor/na de wedstrijd) mag `auto` gewoon per moment kiezen.
 */
export function autoLeftLatchApplies(status: string | undefined): boolean {
  return status === "FIRST_HALF" || status === "SECOND_HALF" || status === "EXTRA_TIME";
}

/**
 * Effectieve `autoLeft`. Geen clip ⇒ geen L-frame, ook niet midden in de helft.
 * Latch blijft bestaan zodat een latere “houd vast”-variant de API niet breekt.
 */
export function resolveAutoLeftLayout(
  ref: AutoLeftLatchRef,
  matchId: string | undefined,
  status: string | undefined,
  raw: boolean,
): boolean {
  if (!autoLeftLatchApplies(status)) {
    ref.current = null;
    return raw;
  }
  ref.current = { key: autoLeftLatchKey(matchId, status), engaged: raw };
  return raw;
}
