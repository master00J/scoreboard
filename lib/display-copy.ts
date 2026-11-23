/**
 * Kleinere kopieën van video's voor het stadionscherm.
 *
 * Een HD-ledscherm (1280x720) toont een Full HD-video toch maar op 720 lijnen. Met deze optie maakt de app
 * van elke grotere video een 720p-kopie, en speelt het stadionscherm die kopie: minder decodeerwerk voor de
 * pc en een nette verkleining (lanczos) in plaats van live schalen. De livestream en het afspeellog gebruiken
 * gewoon het origineel; de kopie is alleen een andere weergave van hetzelfde media-item.
 *
 * De kopie hoort bij één versie van het origineel (`displayCopyKey`). Wordt het origineel vervangen of
 * omgezet, dan klopt de sleutel niet meer en speelt het scherm weer het origineel tot er een nieuwe kopie is.
 */

/** Hoogtes die de club kan kiezen. Null = origineel afspelen. */
export const DISPLAY_COPY_HEIGHTS = [720] as const;
export type DisplayCopyHeight = (typeof DISPLAY_COPY_HEIGHTS)[number];

export function normalizeDisplayCopyHeight(value: unknown): DisplayCopyHeight | null {
  const n = typeof value === "number" ? value : Number(value);
  return (DISPLAY_COPY_HEIGHTS as readonly number[]).includes(n) ? (n as DisplayCopyHeight) : null;
}

/** Een kopie loont pas als het origineel duidelijk hoger is (niet voor een 720p- of 768p-bestand). */
export function needsDisplayCopy(sourceHeight: number, target: DisplayCopyHeight): boolean {
  return Number.isFinite(sourceHeight) && sourceHeight > target * 1.1;
}

/** Sleutel van een kopie: doelhoogte plus de versie van het origineel (pad, grootte, wijzigingstijd). */
export function displayCopyKey(target: DisplayCopyHeight, sourceVersionKey: string): string {
  return `${target}|${sourceVersionKey}`;
}

/** Sleutel voor een origineel dat niet hoger is dan het doel: geen kopie nodig, niet opnieuw proberen. */
export function displayCopyNotNeededKey(target: DisplayCopyHeight, sourceVersionKey: string): string {
  return `${target}|small|${sourceVersionKey}`;
}

export type DisplayCopyRow = {
  path: string;
  type: string;
  displayCopyPath: string | null;
  displayCopyKey: string | null;
};

/**
 * Welke kopie het stadionscherm per origineel pad speelt. Alleen kopieën voor de gekozen hoogte en de
 * huidige versie van het origineel tellen; `currentKey` geeft die versie (null als het bestand ontbreekt).
 */
export function displayCopyMap(
  rows: DisplayCopyRow[],
  target: DisplayCopyHeight | null,
  currentKey: (path: string) => string | null,
  copyExists: (path: string) => boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (target == null) return out;
  for (const row of rows) {
    if (row.type !== "VIDEO" || !row.displayCopyPath || !row.displayCopyKey) continue;
    const key = currentKey(row.path);
    if (!key || row.displayCopyKey !== displayCopyKey(target, key)) continue;
    if (!copyExists(row.displayCopyPath)) continue;
    out[row.path] = row.displayCopyPath;
  }
  return out;
}

/** Hoeveel video's klaar zijn: een geldige kopie, of een origineel dat geen kopie nodig heeft. */
export function displayCopyProgress(
  rows: DisplayCopyRow[],
  target: DisplayCopyHeight | null,
  currentKey: (path: string) => string | null,
  copyExists: (path: string) => boolean,
): { ready: number; total: number } {
  if (target == null) return { ready: 0, total: 0 };
  const videos = rows.filter((r) => r.type === "VIDEO");
  const copies = displayCopyMap(videos, target, currentKey, copyExists);
  let ready = 0;
  for (const row of videos) {
    const key = currentKey(row.path);
    if (copies[row.path] || (key && row.displayCopyKey === displayCopyNotNeededKey(target, key))) ready += 1;
  }
  return { ready, total: videos.length };
}

// --- In het venster van het stadionscherm -------------------------------------------------------

let activeCopies: Record<string, string> = {};

/**
 * Zet de kopieën die `mediaUrl` in dit venster gebruikt. Alleen het stadionscherm roept dit op; de
 * livestream en het bedieningspaneel spelen dus altijd het origineel.
 */
export function setDisplayMediaCopies(copies: Record<string, string>): void {
  activeCopies = { ...copies };
}

/** Het pad dat dit venster afspeelt: de kopie als die er is, anders het origineel. */
export function displayCopyFor(storedPath: string): string {
  return activeCopies[storedPath] ?? storedPath;
}
