/** Zelfde regels als `sanitizeMediaPath` in livestream.ts, hier herhaald om geen circulaire import. */
const MEDIA_PATH_RE = /\.(mp4|webm|mov|avi|mkv|m4v|jpg|jpeg|png|gif|webp)$/i;

function sanitizePlaylistPath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 1000 || /[\r\n"]/.test(trimmed)) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !/^[a-zA-Z]:[\\/]/.test(trimmed)) return "";
  if (!MEDIA_PATH_RE.test(trimmed)) return "";
  return trimmed;
}

function isVideoPlaylistPath(filePath: string): boolean {
  return /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(filePath);
}

/** Maximaal aantal items in één livestream-afspeellijst. */
export const PLAYLIST_ITEM_LIMIT = 50;
/** Standaard hoe lang een afbeelding in beeld blijft. */
export const PLAYLIST_IMAGE_DURATION_SEC = 8;
export const PLAYLIST_DURATION_MAX = 3600;

export type LivestreamPlaylistItem = {
  id: string;
  path: string;
  /**
   * Seconden in beeld. Bij een video is 0: het hele bestand. Bij een afbeelding altijd minstens 1.
   */
  durationSec: number;
};

export function defaultPlaylistDurationSec(path: string): number {
  return isVideoPlaylistPath(path) ? 0 : PLAYLIST_IMAGE_DURATION_SEC;
}

export function sanitizePlaylistDurationSec(raw: unknown, path: string): number {
  const fallback = defaultPlaylistDurationSec(path);
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  if (isVideoPlaylistPath(path)) return Math.min(PLAYLIST_DURATION_MAX, Math.max(0, rounded));
  return Math.min(PLAYLIST_DURATION_MAX, Math.max(1, rounded));
}

export function createPlaylistItem(partial?: Partial<LivestreamPlaylistItem>): LivestreamPlaylistItem | null {
  const path = sanitizePlaylistPath(partial?.path);
  if (!path) return null;
  const id =
    typeof partial?.id === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(partial.id)
      ? partial.id
      : `p${Math.random().toString(36).slice(2, 10)}`;
  return { id, path, durationSec: sanitizePlaylistDurationSec(partial?.durationSec, path) };
}

export function mergePlaylistItems(raw: unknown): LivestreamPlaylistItem[] {
  if (!Array.isArray(raw)) return [];
  const out: LivestreamPlaylistItem[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const created = createPlaylistItem(item as Partial<LivestreamPlaylistItem>);
    if (!created) continue;
    if (seen.has(created.id)) created.id = `p${Math.random().toString(36).slice(2, 10)}`;
    seen.add(created.id);
    out.push(created);
    if (out.length >= PLAYLIST_ITEM_LIMIT) break;
  }
  return out;
}

export function playlistItemsFromPaths(paths: string[]): LivestreamPlaylistItem[] {
  return mergePlaylistItems(paths.map((path) => ({ path })));
}

export function appendPlaylistItems(
  current: LivestreamPlaylistItem[],
  extra: LivestreamPlaylistItem[],
): LivestreamPlaylistItem[] {
  return mergePlaylistItems([...current, ...extra]);
}

export function movePlaylistItem(
  items: LivestreamPlaylistItem[],
  id: string,
  delta: 1 | -1,
): LivestreamPlaylistItem[] {
  const index = items.findIndex((item) => item.id === id);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= items.length) return items;
  const copy = [...items];
  const [row] = copy.splice(index, 1);
  copy.splice(next, 0, row);
  return copy;
}

/** Volgende item, of `null` als de lijst klaar is en niet herhaalt. */
export function nextPlaylistIndex(index: number, length: number, loop: boolean): number | null {
  if (length <= 0) return null;
  const next = index + 1;
  if (next < length) return next;
  return loop ? 0 : null;
}

/**
 * Hoe lang dit item blijft staan. `null` = video tot het einde (of tot de gebruiker een duur zette).
 */
export function playlistHoldMs(item: LivestreamPlaylistItem): number | null {
  if (isVideoPlaylistPath(item.path) && item.durationSec <= 0) return null;
  const sec = item.durationSec > 0 ? item.durationSec : PLAYLIST_IMAGE_DURATION_SEC;
  return sec * 1000;
}
