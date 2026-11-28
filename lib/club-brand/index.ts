/**
 * Huisstijl van de club voor wie deze build is. Op staging en master staat hier niets (`null`): dan toont
 * het bedieningspaneel het gewone ArenaCue-uiterlijk. Op de RAFC-branches staat hier Royal Antwerp FC.
 *
 * De kleuren van het bedieningspaneel staan in `app/globals.css` (blok "Huisstijl RAFC" onderaan).
 * Het stadionscherm in clubstijl staat in `app/display/_modes/rafc/`.
 */

import { PRO_LEAGUE_LOGO_RED } from "./league-logo";
import { RAFC_LOGO_LIGHT, svgDataUrl } from "./rafc-logos";
import { RAFC_SCOREBOARD_THEME } from "./rafc-template";
import type { ScoreboardTheme } from "../scoreboard-theme";

export type ClubBrand = {
  id: string;
  /** Logo voor de donkere kop van het bedieningspaneel. */
  headerLogoSrc: string;
  /**
   * Scorebord, kaarten en wissels op het stadionscherm in de stijl van de club. De club kan dit in de
   * instellingen uitzetten; dan toont het scherm de gewone indelingen.
   */
  stadiumStyle: "rafc" | null;
  /** Competitielogo bovenaan het grote scorebord (data-URL of pad); null = geen logo-vak. */
  leagueLogoSrc: string | null;
  /**
   * Schermindeling van de club: staat bovenaan de bibliotheek van "Scherm indelen" en is de indeling
   * van een database die er nog geen heeft.
   */
  layoutTemplate: { key: string; name: string; label: string; theme: ScoreboardTheme } | null;
};

export const CLUB_BRAND: ClubBrand | null = {
  id: "rafc",
  headerLogoSrc: svgDataUrl(RAFC_LOGO_LIGHT),
  stadiumStyle: "rafc",
  leagueLogoSrc: svgDataUrl(PRO_LEAGUE_LOGO_RED),
  layoutTemplate: {
    key: "rafc-2627",
    name: "RAFC 26/27",
    label: "Huisstijl Royal Antwerp FC: groot en klein scorebord",
    theme: RAFC_SCOREBOARD_THEME,
  },
};
