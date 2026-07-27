import { describe, expect, it } from "vitest";
import { applyMatchSponsorMediaPin } from "./match-sponsor-rotation-media";
import type { MediaItem, Sponsor } from "./types";

const baseMedia = {
  sponsorId: "sp-ms",
  sponsorName: "Matchsponsor",
  createdAt: "2026-01-01T00:00:00.000Z",
  hideFromLibrary: false,
};

const heylen: MediaItem = {
  ...baseMedia,
  id: "m-heylen",
  title: "Heylen",
  path: "a.mp4",
  type: "VIDEO",
  active: true,
  durationSec: 30,
};
const bb: MediaItem = {
  ...baseMedia,
  id: "m-bb",
  title: "BB",
  path: "b.mp4",
  type: "VIDEO",
  active: true,
  durationSec: 20,
};

const sponsor: Sponsor = {
  id: "sp-ms",
  name: "Matchsponsor",
  active: true,
  prematchSeconds: 120,
  matchSeconds: 0,
  matchFirstHalfSeconds: 0,
  matchSecondHalfSeconds: 0,
  halftimeSeconds: 0,
  postmatchSeconds: 0,
  imageDefaultSec: 10,
  createdAt: "2026-01-01T00:00:00.000Z",
  media: [heylen, bb],
};

describe("applyMatchSponsorMediaPin", () => {
  it("prematch: alleen gekozen matchsponsor-clip", () => {
    const list = applyMatchSponsorMediaPin("prematch", sponsor, [heylen, bb], {
      matchSponsorMediaId: heylen.id,
      matchSponsorMedia: heylen,
      sponsorIdFilter: "sp-ms",
    });
    expect(list).toEqual([heylen]);
  });

  it("prematch-rooster geeft geen pin mee: volledige rotatie blijft staan", () => {
    expect(
      applyMatchSponsorMediaPin("prematch", sponsor, [heylen, bb], {
        matchSponsorMediaId: null,
        matchSponsorMedia: null,
        sponsorIdFilter: "sp-ms",
      }),
    ).toEqual([heylen, bb]);
  });

  it("andere sectie: geen pin", () => {
    expect(
      applyMatchSponsorMediaPin("match", sponsor, [heylen, bb], {
        matchSponsorMediaId: heylen.id,
        matchSponsorMedia: heylen,
        sponsorIdFilter: "sp-ms",
      }),
    ).toEqual([heylen, bb]);
  });
});
