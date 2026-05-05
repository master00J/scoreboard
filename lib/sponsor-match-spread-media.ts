import type { MediaItem, SponsorSection } from "@/lib/types";

/**
 * Naast het scorebord wordt sponsortijd gekoppeld aan een per-seconde slotmap.
 * Langere video's worden daardoor voortijdig afgekapt. Voor `section === "match"`
 * gebruiken we daarom bij voorkeur alleen korte clips of stills.
 */
export const MATCH_SPREAD_PANEL_MAX_VIDEO_SEC = 8;

export function mediaAllowedForMatchSpreadPanel(m: MediaItem): boolean {
  if (m.type === "IMAGE") return true;
  if (m.type !== "VIDEO") return true;
  const dur = m.durationSec > 0 ? m.durationSec : 30;
  return dur <= MATCH_SPREAD_PANEL_MAX_VIDEO_SEC;
}

export function filterMediaForSponsorSpreadSection(
  media: MediaItem[],
  section: SponsorSection,
): MediaItem[] {
  if (section !== "match") return media;
  const shortOk = media.filter(mediaAllowedForMatchSpreadPanel);
  return shortOk.length > 0 ? shortOk : media;
}
