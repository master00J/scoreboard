import type { MediaItem } from "@/lib/types";

const REPEAT_MIN = 1;
const REPEAT_MAX = 20;

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

/** JSON-object mediaId → herhalingen per doorloop van de unieke clip-lijst. */
export function parseSponsorPlaybackRepeatsJson(raw: string | null | undefined): Record<string, number> {
  if (!raw?.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, number> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const n = typeof val === "number" ? val : Number(val);
      if (Number.isFinite(n)) out[k] = clampRepeat(n);
    }
    return out;
  } catch {
    return {};
  }
}

export function clampRepeat(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(REPEAT_MAX, Math.max(REPEAT_MIN, Math.round(n)));
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

/**
 * Unieke volgorde + per clip N opeenvolgende plays in de rotatie (cursor loopt over deze uitgebreide lijst).
 */
export function buildSponsorRotationMediaList(
  media: MediaItem[],
  orderJson: string | null | undefined,
  repeatsJson: string | null | undefined,
): MediaItem[] {
  const ordered = applySponsorPlaybackOrder(media, orderJson);
  const repeats = parseSponsorPlaybackRepeatsJson(repeatsJson);
  const out: MediaItem[] = [];
  for (const m of ordered) {
    const n = clampRepeat(repeats[m.id] ?? 1);
    for (let i = 0; i < n; i++) {
      out.push(m);
    }
  }
  return out;
}
