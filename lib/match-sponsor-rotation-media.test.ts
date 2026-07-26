import { describe, expect, it } from "vitest";
import { applyMatchSponsorMediaPin } from "./match-sponsor-rotation-media";
import type { MediaItem, Sponsor } from "./types";

const heylen: MediaItem = {
  id: "m-heylen",
  title: "Heylen",
  path: "a.mp4",
  type: "VIDEO",
  active: true,
  durationSec: 30,
  hideFromLibrary: false,
};
const bb: MediaItem = {
  id: "m-bb",
  title: "BB",
  path: "b.mp4",
  type: "VIDEO",
  active: true,
  durationSec: 20,
  hideFromLibrary: false,
};

const sponsor: Sponsor = {
  id: "sp-ms",
  name: "Matchsponsor",
  active: true,
  prematchSeconds: 120,
  halftimeSeconds: 0,
  firstHalfSeconds: 0,
  secondHalfSeconds: 0,
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
