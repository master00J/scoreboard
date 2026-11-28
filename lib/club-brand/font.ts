import { RAFC_FONT_FAMILY, RAFC_FONT_TTF_BASE64 } from "./rafc-font";

let loading: Promise<void> | null = null;

/**
 * Laadt het lettertype van de club één keer in dit venster. Mislukt het, dan valt de tekst terug op het
 * volgende lettertype in de lijst; het scherm blijft werken.
 */
export function ensureClubFont(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    if (typeof document === "undefined" || typeof FontFace === "undefined") return;
    try {
      const face = new FontFace(RAFC_FONT_FAMILY, `url(data:font/ttf;base64,${RAFC_FONT_TTF_BASE64})`, {
        weight: "200 900",
        style: "normal",
      });
      await face.load();
      document.fonts.add(face);
    } catch {
      /* terugvallen op het systeemlettertype */
    }
  })();
  return loading;
}

/** Lettertype-stack voor de clubvisuals. */
export const CLUB_FONT_STACK = `"${RAFC_FONT_FAMILY}", "Archivo", "Arial Black", system-ui, sans-serif`;
