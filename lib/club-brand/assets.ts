import { CLUB_BRAND } from "./index";

/**
 * Beelden die bij de huisstijl van de club horen en in de app zelf zitten (geen bestand op schijf).
 * Een beeldelement in "Scherm indelen" verwijst ernaar met `brand:<naam>`, bv. `brand:league`.
 * Zonder clubstijl of onbekende naam: leeg, dan toont het element niets.
 */
export function clubBrandAsset(ref: string): string {
  if (!CLUB_BRAND) return "";
  switch (ref) {
    case "brand:league":
      return CLUB_BRAND.leagueLogoSrc ?? "";
    case "brand:crest":
      return CLUB_BRAND.headerLogoSrc;
    default:
      return "";
  }
}
