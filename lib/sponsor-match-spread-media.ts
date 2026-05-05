import type { MediaItem, SponsorSection } from "@/lib/types";
import { mediaAllowedForSponsorPhase } from "@/lib/sponsor-media-phases";

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
  matchStatus?: string,
): MediaItem[] {
  const phaseOk = media.filter((m) => mediaAllowedForSponsorPhase(m, section, matchStatus));
  if (phaseOk.length === 0) return [];

  if (section !== "match") return phaseOk;
  const shortOk = phaseOk.filter(mediaAllowedForMatchSpreadPanel);
  return shortOk.length > 0 ? shortOk : phaseOk;
}
