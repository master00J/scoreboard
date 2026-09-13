import type { MediaItem } from "@/lib/types";

export const MAX_QUICK_MEDIA_BUTTON_LABEL_LENGTH = 36;

export function normalizeQuickMediaButtonLabel(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.slice(0, MAX_QUICK_MEDIA_BUTTON_LABEL_LENGTH);
}

export function quickMediaButtonLabel(
  media: Pick<MediaItem, "title" | "quickButtonLabel">,
): string {
  return normalizeQuickMediaButtonLabel(media.quickButtonLabel ?? "") ?? media.title;
}
