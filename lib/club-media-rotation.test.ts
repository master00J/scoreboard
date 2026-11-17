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

describe("clubmedia met meerdere bestanden", () => {
  const budget = JSON.stringify({ prematch: 0, firstHalf: 120, secondHalf: 120, halftime: 0, postmatch: 0 });
  const a = clubClip({ id: "a", title: "Free Your Seat 1", clubGroup: "Free Your Seat", clubPhaseBudgetJson: budget, createdAt: "2026-11-11T00:00:01.000Z" });
  const b = clubClip({
    id: "b",
    title: "Free Your Seat 2",
    clubGroup: "free your seat",
    clubPhaseBudgetJson: budget,
    sponsorPhaseTagsJson: JSON.stringify(["secondHalf", "extraTime"]),
    createdAt: "2026-11-11T00:00:02.000Z",
  });
  const off = clubClip({ id: "off", clubGroup: "Free Your Seat", clubPhaseBudgetJson: budget, active: false });
  const single = clubClip({ id: "lawijt" });

  it("maakt van een groep één deelnemer met al zijn actieve bestanden", () => {
    const merged = mergeSponsorsWithClubMedia([], [a, single, b, off]);
    expect(merged.map((s) => s.id)).toEqual(["club:group:free your seat", clubRotationSponsorId("lawijt")]);
    const group = merged[0];
    expect(group.rotationKind).toBe("club");
    expect(group.name).toBe("Free Your Seat");
    expect(group.matchFirstHalfSeconds).toBe(120);
    expect(group.media!.map((m) => m.id)).toEqual(["a", "b"]);
    expect(isClubRotationSponsorId(group.id)).toBe(true);
  });

  it("een bestand met eigen fases speelt alleen daar, de andere in alle fases met minuten", () => {
    const [group] = mergeSponsorsWithClubMedia([], [a, b]);
    expect(parseSponsorMediaPhaseTags(group.media![0].sponsorPhaseTagsJson)).toEqual([
      "firstHalf",
      "secondHalf",
      "extraTime",
    ]);
    expect(parseSponsorMediaPhaseTags(group.media![1].sponsorPhaseTagsJson)).toEqual(["secondHalf", "extraTime"]);
  });

  it("losse clubmedia zonder groep blijven precies zoals voorheen", () => {
    expect(mergeSponsorsWithClubMedia([], [single])).toEqual([clubMediaToRotationSponsor(single)]);
  });

  it("een groep zonder actieve bestanden of zonder minuten doet niet mee", () => {
    expect(mergeSponsorsWithClubMedia([], [off])).toEqual([]);
    const noBudget = clubClip({ id: "x", clubGroup: "Leeg", clubPhaseBudgetJson: null });
    expect(mergeSponsorsWithClubMedia([], [noBudget])).toEqual([]);
  });
});
