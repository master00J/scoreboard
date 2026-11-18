/**
 * Huisstijl van de club voor wie deze build is. Op staging en master staat hier niets (`null`): dan toont
 * het bedieningspaneel het gewone ArenaCue-uiterlijk. Op de RAFC-branches staat hier Royal Antwerp FC.
 *
 * De kleuren staan in `app/globals.css` (blok "Huisstijl RAFC" onderaan).
 */

import { RAFC_LOGO_LIGHT, svgDataUrl } from "./rafc-logos";

export type ClubBrand = {
  id: string;
  /** Logo voor de donkere kop van het bedieningspaneel. */
  headerLogoSrc: string;
};

export const CLUB_BRAND: ClubBrand | null = {
  id: "rafc",
  headerLogoSrc: svgDataUrl(RAFC_LOGO_LIGHT),
};
