/**
 * Kleine vangnetten voor het stadionscherm. Een fout hier staat tijdens een wedstrijd op de wand,
 * dus elke functie geeft altijd iets bruikbaars terug.
 */

/**
 * Welk item een rotatie toont. De lijst kan korter worden terwijl de rotatie loopt (een item wordt
 * verwijderd of uitgezet); een index die er dan buiten valt, begint weer vooraan in plaats van een
 * item te lezen dat niet meer bestaat.
 */
export function safeRotationIndex(index: number, length: number): number {
  if (!Number.isInteger(length) || length <= 0) return 0;
  if (!Number.isInteger(index) || index < 0 || index >= length) return 0;
  return index;
}

type OverlayEpisodeState = {
  mode?: string | null;
  activePlayerId?: string | null;
  activeGoalScorerId?: string | null;
  activeCardColor?: string | null;
  activeMediaId?: string | null;
  activeSubInId?: string | null;
  activeSubOutId?: string | null;
};

/**
 * Herkent één vertoning van een tijdelijke overlay (goal, kaart, wissel, rust, einde).
 *
 * De timer die zo'n overlay weer weghaalt, mag alleen opnieuw beginnen als er een nieuwe vertoning
 * start: een andere modus, een andere speler of clip, of een gewijzigde score (twee goals kort na
 * elkaar). Hij hing vroeger aan `updatedAt`, en die verandert bij elke klokstart, shotclock-reset
 * of sponsormelding: bij druk klokgebruik bleef een fullscreen wissel daardoor staan.
 */
export function overlayEpisodeKey(
  state: OverlayEpisodeState | null | undefined,
  score?: { home?: number | null; away?: number | null } | null,
): string {
  if (!state) return "";
  return [
    state.mode ?? "",
    state.activePlayerId ?? "",
    state.activeGoalScorerId ?? "",
    state.activeCardColor ?? "",
    state.activeMediaId ?? "",
    state.activeSubInId ?? "",
    state.activeSubOutId ?? "",
    score?.home ?? "",
    score?.away ?? "",
  ].join("|");
}
