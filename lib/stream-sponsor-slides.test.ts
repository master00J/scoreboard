import { describe, expect, it } from "vitest";
import { streamSponsorSlidesForSlot } from "./stream-sponsor-slides";
import type { MediaItem, Sponsor } from "./types";
import type { StreamSponsorSlotView } from "./use-stream-sponsor-slot";

function item(partial: Partial<MediaItem> & Pick<MediaItem, "id" | "type" | "path">): MediaItem {
  return {
    title: partial.title ?? partial.id,
    durationSec: partial.durationSec ?? 0,
    sponsorName: "ACME",
    sponsorId: "sp1",
    active: partial.active ?? true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function slot(current: Sponsor | null, section: StreamSponsorSlotView["section"] = "halftime"): StreamSponsorSlotView {
  return {
    sponsors: current ? [current] : [],
    section,
    current,
    interrupted: false,
    matchStatus: section === "halftime" ? "HALF_TIME" : "FIRST_HALF",
    activeScheduledCue: null,
    dismissActiveScheduledCue: () => undefined,
  };
}

function sponsor(media: MediaItem[]): Sponsor {
  return {
    id: "sp1",
    name: "ACME",
    active: true,
    prematchSeconds: 60,
    matchSeconds: 60,
    matchFirstHalfSeconds: 30,
    matchSecondHalfSeconds: 30,
    halftimeSeconds: 60,
    postmatchSeconds: 60,
    imageDefaultSec: 8,
    sponsorPlaybackOrderJson: null,
    sponsorPlaybackRepeatsJson: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    media,
  };
}

describe("streamSponsorSlidesForSlot", () => {
  it("neemt 16:9 video én afbeelding mee (niet alleen logo's)", () => {
    const slides = streamSponsorSlidesForSlot(
      slot(
        sponsor([
          item({ id: "v1", type: "VIDEO", path: "/uploads/spot.mp4", durationSec: 20 }),
          item({ id: "i1", type: "IMAGE", path: "/uploads/spot.jpg" }),
        ]),
      ),
      null,
    );
    expect(slides).toHaveLength(2);
    expect(slides[0]).toMatchObject({ type: "VIDEO", src: "/uploads/spot.mp4", durationSec: 20 });
    expect(slides[1]).toMatchObject({ type: "IMAGE", src: "/uploads/spot.jpg", durationSec: 8 });
  });

  it("slaat items zonder pad over", () => {
    const slides = streamSponsorSlidesForSlot(
      slot(sponsor([item({ id: "empty", type: "IMAGE", path: "" })])),
      null,
    );
    expect(slides).toEqual([]);
  });
});
