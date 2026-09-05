import { mediaUrl } from "./media-url";
import { applyMatchSponsorMediaPin } from "./match-sponsor-rotation-media";
import { filterMediaForSponsorSpreadSection } from "./sponsor-match-spread-media";
import { buildSponsorRotationMediaList } from "./sponsor-playback-order";
import type { StreamSponsorSlotView } from "./use-stream-sponsor-slot";
import type { Match, MediaItem } from "./types";

export type StreamSponsorSlide = {
  id: string;
  src: string;
  title: string;
  sponsorName: string;
  durationSec: number;
  type: MediaItem["type"];
};

export function streamSponsorSlidesForSlot(
  slot: StreamSponsorSlotView,
  match: Match | null,
): StreamSponsorSlide[] {
  const sponsor = slot.current;
  if (!sponsor) return [];
  const base = buildSponsorRotationMediaList(
    filterMediaForSponsorSpreadSection((sponsor.media ?? []).filter((m) => m.active), slot.section, slot.matchStatus),
    sponsor.sponsorPlaybackOrderJson,
    sponsor.sponsorPlaybackRepeatsJson,
  );
  const media = applyMatchSponsorMediaPin(slot.section, sponsor, base, {
    matchSponsorMediaId: match?.matchSponsorMediaId,
    matchSponsorMedia: match?.matchSponsorMedia ?? null,
    sponsorIdFilter: sponsor.id,
  });
  return media
    .filter((item) => item.path)
    .map((item) => ({
      id: `${sponsor.id}:${item.id}`,
      src: mediaUrl(item.path),
      title: item.title || sponsor.name,
      sponsorName: sponsor.name,
      durationSec:
        item.type === "VIDEO"
          ? Math.max(5, item.durationSec || 30)
          : Math.max(5, item.durationSec || sponsor.imageDefaultSec || 8),
      type: item.type,
    }));
}
