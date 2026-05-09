import type { MediaItem } from "@/lib/types";

/** JSON-array van media-id's in gewenste volgorde voor sponsorrotatie. */
export function parseSponsorPlaybackOrderJson(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/**
 * Sorteert actieve sponsor-media volgens operator-volgorde; onbekende id's vallen achteraan (createdAt).
 */
export function applySponsorPlaybackOrder(
  media: MediaItem[],
  orderJson: string | null | undefined,
): MediaItem[] {
  const list = media.filter((m) => m.active);
  const ids = parseSponsorPlaybackOrderJson(orderJson);
  if (ids.length === 0) {
    return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  const byId = new Map(list.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const out: MediaItem[] = [];
  for (const id of ids) {
    const m = byId.get(id);
    if (m) {
      out.push(m);
      seen.add(id);
    }
  }
  const rest = list.filter((m) => !seen.has(m.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return [...out, ...rest];
}
