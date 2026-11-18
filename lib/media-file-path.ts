/**
 * Een opgeslagen mediapad naar het echte bestand op deze pc.
 *
 * Twee soorten paden staan in de database:
 *  - "/uploads/naam.mp4": in de uploads-map van de app (ook wat een teruggezette back-up schrijft);
 *  - een volledig pad ("C:\Clips\goal.mp4"), gekozen in de bestandsdialoog.
 *
 * Afspelen, controleren en omzetten gebruiken allemaal deze vertaling, zodat een clip die het
 * scherm kan tonen ook gecontroleerd en omgezet wordt. Geen `node:path`: ook de renderer gebruikt dit.
 */
export function resolveStoredMediaPath(
  stored: string | null | undefined,
  uploadsDir: string | null | undefined,
): string | null {
  const value = stored?.trim();
  if (!value) return null;
  if (!value.startsWith("/uploads/")) return value;
  const root = uploadsDir?.trim().replace(/[\\/]+$/, "");
  if (!root) return null;
  const parts = value.slice("/uploads/".length).split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "..")) return null;
  const sep = root.includes("\\") || /^[A-Za-z]:/.test(root) ? "\\" : "/";
  return `${root}${sep}${parts.join(sep)}`;
}
