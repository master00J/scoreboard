/**
 * De regel onder de score (service, sets, time-outs, fouten) moet op één lijn passen. Liep ze over
 * twee regels, dan was het vak te klein en vielen de score en de time-outs half weg.
 */

/** Gemiddelde breedte van een vette hoofdletter of cijfer, in em (iets ruim). */
const CHAR_EM = 0.72;
/** Ruimte tussen de onderdelen, in em (zoals de `gap` van de regel). */
const GAP_EM = 0.28;
/** Binnenmarge links en rechts van een label als SERVE of BONUS, in em. */
const BADGE_EM = 0.8;

export type TeamExtrasPart = { text: string; badge?: boolean };

/** Breedte van de hele regel in em. */
export function teamExtrasWidthEm(parts: readonly TeamExtrasPart[]): number {
  if (parts.length === 0) return 0;
  const text = parts.reduce((sum, part) => sum + part.text.length * CHAR_EM + (part.badge ? BADGE_EM : 0), 0);
  return text + (parts.length - 1) * GAP_EM;
}

/**
 * Lettergrootte in `cqw` waarbij de regel binnen `availableCqw` van de vakbreedte past.
 * `null` als er niets te tonen is.
 */
export function teamExtrasFitCqw(parts: readonly TeamExtrasPart[], availableCqw: number): number | null {
  const em = teamExtrasWidthEm(parts);
  if (em <= 0) return null;
  return Math.round((availableCqw / em) * 100) / 100;
}

/**
 * Lettergrootte in px waarbij geen enkel onderdeel breder is dan `widthPx`. De regel mag dan wel
 * over meer lijnen lopen, maar een onderdeel valt nooit buiten het vak.
 */
export function teamExtrasPartFitPx(parts: readonly TeamExtrasPart[], widthPx: number, fontPx: number): number {
  const widest = parts.reduce((max, part) => Math.max(max, teamExtrasWidthEm([part])), 0);
  if (widest <= 0) return fontPx;
  return Math.max(10, Math.min(fontPx, Math.floor(widthPx / widest)));
}

/** Lijnhoogte van de regel ten opzichte van de lettergrootte (labels hebben wat marge boven en onder). */
export const TEAM_EXTRAS_LINE_EM = 1.2;
