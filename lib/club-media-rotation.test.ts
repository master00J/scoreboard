import { describe, expect, it } from "vitest";
import type { MediaItem, Sponsor } from "./types";
import {
  CLUB_ROTATION_ID_PREFIX,
  clubMediaToRotationSponsor,
  clubPhaseBudgetTotalSeconds,
  clubRotationSponsorId,
  isClubRotationSponsorId,
  mergeSponsorsWithClubMedia,
  parseClubPhaseBudgetJson,
  serializeClubPhaseBudgetJson,
} from "./club-media-rotation";
import { parseSponsorMediaPhaseTags } from "./sponsor-media-phases";

function clubClip(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "lawijt",
    type: "IMAGE",
    path: "/uploads/lawijt.jpg",
    title: "Café Lawijt",
    durationSec: 15,
    sponsorName: null,
    sponsorId: null,
    active: true,
    clubPhaseBudgetJson: JSON.stringify({
      prematch: 180,
      firstHalf: 0,
      secondHalf: 0,
      halftime: 180,
      postmatch: 180,
    }),
    createdAt: "2026-11-11T00:00:00.000Z",
    ...overrides,
  };
}

describe("club phase budget json", () => {
  it("leest seconden per fase en negeert rommel", () => {
    expect(parseClubPhaseBudgetJson(null)).toEqual({
      prematch: 0,
      firstHalf: 0,
      secondHalf: 0,
      halftime: 0,
      postmatch: 0,
    });
    expect(parseClubPhaseBudgetJson(`{"prematch":180,"halftime":"90"}`).prematch).toBe(180);
    expect(parseClubPhaseBudgetJson(`{"prematch":180,"halftime":"90"}`).halftime).toBe(90);
    expect(parseClubPhaseBudgetJson("niet-json").prematch).toBe(0);
    expect(serializeClubPhaseBudgetJson({ ...parseClubPhaseBudgetJson(null), prematch: 60 })).toBe(
      JSON.stringify({
        prematch: 60,
        firstHalf: 0,
        secondHalf: 0,
        halftime: 0,
        postmatch: 0,
      }),
    );
    expect(serializeClubPhaseBudgetJson(parseClubPhaseBudgetJson(null))).toBeNull();
  });
});

describe("clubMediaToRotationSponsor", () => {
  it("maakt een rotatie-deelnemer met dezelfde minuten als een sponsor", () => {
    const sponsor = clubMediaToRotationSponsor(clubClip());
    expect(sponsor).not.toBeNull();
    expect(sponsor!.id).toBe(`${CLUB_ROTATION_ID_PREFIX}lawijt`);
    expect(sponsor!.rotationKind).toBe("club");
    expect(sponsor!.prematchSeconds).toBe(180);
    expect(sponsor!.halftimeSeconds).toBe(180);
    expect(sponsor!.postmatchSeconds).toBe(180);
    expect(sponsor!.matchFirstHalfSeconds).toBe(0);
    expect(sponsor!.media).toHaveLength(1);
    expect(sponsor!.media![0]!.durationSec).toBe(15);
    const tags = parseSponsorMediaPhaseTags(sponsor!.media![0]!.sponsorPhaseTagsJson);
    expect(tags).toEqual(["prematch", "halftime", "postmatch"]);
  });

  it("zet 2e helft ook klaar voor verlenging", () => {
    const sponsor = clubMediaToRotationSponsor(
      clubClip({
        clubPhaseBudgetJson: JSON.stringify({ secondHalf: 120 }),
      }),
    );
    const tags = parseSponsorMediaPhaseTags(sponsor!.media![0]!.sponsorPhaseTagsJson);
    expect(tags).toEqual(["secondHalf", "extraTime"]);
    expect(sponsor!.matchSecondHalfSeconds).toBe(120);
  });

  it("negeert gekoppelde, inactieve of lege clubmedia", () => {
    expect(clubMediaToRotationSponsor(clubClip({ sponsorId: "s1" }))).toBeNull();
    expect(clubMediaToRotationSponsor(clubClip({ active: false }))).toBeNull();
    expect(clubMediaToRotationSponsor(clubClip({ hideFromLibrary: true }))).toBeNull();
    expect(clubMediaToRotationSponsor(clubClip({ clubPhaseBudgetJson: null }))).toBeNull();
  });
});

describe("mergeSponsorsWithClubMedia", () => {
  it("zet clubmedia achter de echte sponsors in dezelfde lijst", () => {
    const commercial: Sponsor = {
      id: "circus",
      name: "Circus",
      active: true,
      prematchSeconds: 0,
      matchSeconds: 360,
      matchFirstHalfSeconds: 180,
      matchSecondHalfSeconds: 180,
      halftimeSeconds: 0,
      postmatchSeconds: 0,
      imageDefaultSec: 15,
      createdAt: "2026-01-01T00:00:00.000Z",
      media: [],
    };
    const merged = mergeSponsorsWithClubMedia([commercial], [clubClip()]);
    expect(merged.map((s) => s.id)).toEqual(["circus", clubRotationSponsorId("lawijt")]);
    expect(clubPhaseBudgetTotalSeconds(parseClubPhaseBudgetJson(clubClip().clubPhaseBudgetJson))).toBe(540);
    expect(isClubRotationSponsorId(merged[1]!.id)).toBe(true);
  });
});
