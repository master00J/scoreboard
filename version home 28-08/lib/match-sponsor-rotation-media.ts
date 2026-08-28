import type { MediaItem, Sponsor, SponsorSection } from "./types";

/**
 * Prematch: keuze in Setup → Aftrap (matchSponsorMediaId) bepaalt welke clip
 * voor die sponsor draait, niet de volledige sponsor-medialijst.
 */
export function applyMatchSponsorMediaPin(
  section: SponsorSection,
  sponsor: Sponsor,
  mediaList: MediaItem[],
  opts: {
    matchSponsorMediaId?: string | null;
    matchSponsorMedia?: MediaItem | null;
    sponsorIdFilter?: string | null;
  },
): MediaItem[] {
  const { matchSponsorMediaId, matchSponsorMedia, sponsorIdFilter } = opts;
  if (section !== "prematch") return mediaList;
  if (!matchSponsorMediaId || !matchSponsorMedia?.active) return mediaList;

  const linkedOnSponsor = (sponsor.media ?? []).some(
    (m) => m.id === matchSponsorMediaId && m.active,
  );
  const pinnedForSlot = sponsorIdFilter != null && sponsorIdFilter === sponsor.id;
  if (!linkedOnSponsor && !pinnedForSlot) return mediaList;

  return [matchSponsorMedia];
}
