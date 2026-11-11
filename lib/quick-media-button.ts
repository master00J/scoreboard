export const MAX_QUICK_MEDIA_BUTTON_LABEL_LENGTH = 36;
/** Zoveel vastgepinde knoppen onthoudt de desktop-app hooguit voor bediening van buiten de regie. */
export const MAX_QUICK_MEDIA_BUTTONS = 64;

/** Wat een snelle knop van een media-item nodig heeft. */
type QuickButtonMedia = { title: string; quickButtonLabel?: string | null };

export function normalizeQuickMediaButtonLabel(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.slice(0, MAX_QUICK_MEDIA_BUTTON_LABEL_LENGTH);
}

export function quickMediaButtonLabel(media: QuickButtonMedia): string {
  return normalizeQuickMediaButtonLabel(media.quickButtonLabel ?? "") ?? media.title;
}

/**
 * De vastgepinde media van de regie, in haar volgorde. De lijst komt uit het regievenster, dus
 * alles wat geen gewone media-id is valt weg.
 */
export function parseQuickMediaButtonIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(item) || ids.includes(item)) continue;
    ids.push(item);
    if (ids.length >= MAX_QUICK_MEDIA_BUTTONS) break;
  }
  return ids;
}

/**
 * De snelle knoppen zoals de regie ze toont: in de volgorde waarin ze vastgepind zijn, zonder
 * media die verwijderd, uitgezet of verborgen zijn, met het eigen label als dat er is.
 */
export function quickMediaButtons<T extends QuickButtonMedia & { id: string }>(
  pinnedIds: string[],
  media: T[],
): { id: string; label: string }[] {
  const byId = new Map(media.map((item) => [item.id, item]));
  const buttons: { id: string; label: string }[] = [];
  for (const id of pinnedIds) {
    const item = byId.get(id);
    if (!item || buttons.some((button) => button.id === id)) continue;
    buttons.push({ id, label: quickMediaButtonLabel(item) });
  }
  return buttons;
}
