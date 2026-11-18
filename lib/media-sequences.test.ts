import { describe, expect, it } from "vitest";
import type { MediaItem, Sponsor } from "./types";
import {
  applyMediaSequences,
  isSequenceRotationSponsorId,
  newSequenceId,
  normalizeMediaSequences,
  parseMediaSequencesJson,
  sequenceRotationSponsorId,
  sequenceStartIndex,
  sequenceToRotationSponsor,
  sequencedMediaIds,
  serializeMediaSequences,
  wholeSequenceSeconds,
  type MediaSequence,
  type SequenceMember,
} from "./media-sequences";
import {
  activeSponsorsForSection,
  buildSponsorAppearancePlan,
  buildSponsorSlotMap,
  holdSecondsForSponsorPhase,
} from "./sponsor-distribution";
import { budgetCapSeconds } from "./sponsor-display-helpers";
import { sponsorPlayLogIdentity } from "./sponsor-telemetry";

function clip(id: string, overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    type: "VIDEO",
    path: `/uploads/${id}.mp4`,
    title: id,
    durationSec: 10,
    sponsorName: null,
    sponsorId: null,
    active: true,
    createdAt: "2026-11-18T00:00:00.000Z",
    ...overrides,
  };
}

function sponsor(id: string, media: MediaItem[], overrides: Partial<Sponsor> = {}): Sponsor {
  return {
    id,
    name: id,
    active: true,
    prematchSeconds: 0,
    matchSeconds: 120,
    matchFirstHalfSeconds: 60,
    matchSecondHalfSeconds: 60,
    halftimeSeconds: 0,
    postmatchSeconds: 0,
    imageDefaultSec: 8,
    createdAt: "2026-11-18T00:00:00.000Z",
    media,
    ...overrides,
  };
}

function sequence(overrides: Partial<MediaSequence> = {}): MediaSequence {
  return {
    id: "s1",
    name: "Kumho + club",
    active: true,
    notes: "",
    mediaIds: ["kumho", "club"],
    budget: { prematch: 0, firstHalf: 60, secondHalf: 0, halftime: 0, postmatch: 0 },
    ...overrides,
  };
}

const kumhoClip = clip("kumho", { sponsorId: "kumho-sponsor", durationSec: 20 });
const kumhoOther = clip("kumho-2", { sponsorId: "kumho-sponsor", durationSec: 15 });
const clubClip = clip("club", { type: "IMAGE", durationSec: 0 });

function members(...items: [MediaItem, number?][]): Map<string, SequenceMember> {
  return new Map(items.map(([media, imageDefaultSec]) => [media.id, { media, imageDefaultSec }]));
}

describe("reeksen opslaan", () => {
  it("leest geldige reeksen en zet een bestand in hoogstens één reeks", () => {
    const parsed = parseMediaSequencesJson(
      JSON.stringify([
        { id: "a", name: " Eerste ", mediaIds: ["x", "y", "x"], budget: { firstHalf: 60 } },
        { id: "b", name: "Tweede", mediaIds: ["y", "z"], active: false },
        { id: "a", name: "dubbel id", mediaIds: ["q"] },
        { id: "bad id!", mediaIds: ["r"] },
        "rommel",
      ]),
    );
    expect(parsed.map((s) => s.id)).toEqual(["a", "b"]);
    expect(parsed[0]).toMatchObject({ name: "Eerste", active: true, mediaIds: ["x", "y"] });
    expect(parsed[0]!.budget.firstHalf).toBe(60);
    expect(parsed[1]).toMatchObject({ active: false, mediaIds: ["z"] });
    expect(parseMediaSequencesJson("{kapot")).toEqual([]);
    expect(parseMediaSequencesJson(null)).toEqual([]);
  });

  it("bewaart niets als er geen reeks is, en leest terug wat het bewaarde", () => {
    expect(serializeMediaSequences([])).toBeNull();
    const saved = serializeMediaSequences([sequence()]);
    expect(normalizeMediaSequences(JSON.parse(saved!))).toEqual([sequence()]);
  });

  it("maakt een uniek id", () => {
    const first = newSequenceId([], 1000);
    expect(newSequenceId([first], 1000)).not.toBe(first);
  });
});

describe("reeks in de rotatie", () => {
  it("rondt de minuten af op hele reeksen", () => {
    expect(wholeSequenceSeconds(60, 28)).toBe(84);
    expect(wholeSequenceSeconds(56, 28)).toBe(56);
    expect(wholeSequenceSeconds(0, 28)).toBe(0);
  });

  it("wordt één deelnemer met de bestanden in volgorde, en een foto krijgt de duur van zijn sponsor", () => {
    const p = sequenceToRotationSponsor(sequence(), members([kumhoClip], [clubClip, 8]))!;
    expect(p.id).toBe(sequenceRotationSponsorId("s1"));
    expect(isSequenceRotationSponsorId(p.id)).toBe(true);
    expect(p.rotationKind).toBe("sequence");
    expect(p.media!.map((m) => [m.id, m.durationSec])).toEqual([
      ["kumho", 20],
      ["club", 8],
    ]);
    // 60 s gevraagd, reeks duurt 28 s: drie hele reeksen.
    expect(p.matchFirstHalfSeconds).toBe(84);
    expect(p.matchSecondHalfSeconds).toBe(0);
  });

  it("slaat ontbrekende of uitgezette bestanden over en speelt niet zonder minuten of als ze uit staat", () => {
    const p = sequenceToRotationSponsor(sequence({ mediaIds: ["kumho", "weg", "club"] }), members([kumhoClip], [{ ...clubClip, active: false }]))!;
    expect(p.media!.map((m) => m.id)).toEqual(["kumho"]);
    expect(sequenceToRotationSponsor(sequence({ active: false }), members([kumhoClip]))).toBeNull();
    expect(
      sequenceToRotationSponsor(
        sequence({ budget: { prematch: 0, firstHalf: 0, secondHalf: 0, halftime: 0, postmatch: 0 } }),
        members([kumhoClip]),
      ),
    ).toBeNull();
    expect(sequenceToRotationSponsor(sequence(), new Map())).toBeNull();
  });

  it("haalt de bestanden uit de rotatie van hun sponsor; de rest van die sponsor speelt gewoon", () => {
    const kumho = sponsor("kumho-sponsor", [kumhoClip, kumhoOther]);
    const out = applyMediaSequences([kumho], [sequence()], members([kumhoClip], [clubClip, 8]));
    expect(out.map((p) => p.id)).toEqual(["kumho-sponsor", "seq:s1"]);
    expect(out[0]!.media!.map((m) => m.id)).toEqual(["kumho-2"]);
    expect(out[1]!.media!.map((m) => m.id)).toEqual(["kumho", "club"]);
  });

  it("verandert niets aan bestaande rotaties zonder actieve reeks", () => {
    const kumho = sponsor("kumho-sponsor", [kumhoClip, kumhoOther]);
    const list = [kumho];
    expect(applyMediaSequences(list, [], members([kumhoClip]))).toBe(list);
    expect(applyMediaSequences(list, [sequence({ active: false })], members([kumhoClip]))).toBe(list);
    expect(sequencedMediaIds([sequence({ active: false })]).size).toBe(0);
    expect([...sequencedMediaIds([sequence()])]).toEqual(["kumho", "club"]);
  });
});

describe("rooster en scherm met een reeks", () => {
  const seq = sequenceToRotationSponsor(sequence(), members([kumhoClip], [clubClip, 8]))!;
  const other = sponsor("ander", [clip("ander-1", { sponsorId: "ander", durationSec: 30 })], {
    matchFirstHalfSeconds: 60,
  });

  it("plant elke beurt de hele reeks, en zoveel beurten als de afgeronde minuten", () => {
    const active = activeSponsorsForSection([other, seq], "match", "FIRST_HALF");
    const plan = buildSponsorAppearancePlan(active, "match", "FIRST_HALF");
    const seqPlan = plan.find((p) => p.id === seq.id)!;
    expect(seqPlan.appearanceSecs).toEqual([28, 28, 28]);
  });

  it("houdt het slot vast zolang de hele reeks duurt", () => {
    expect(holdSecondsForSponsorPhase([other, seq], "match", "FIRST_HALF", seq.id)).toBe(28);
  });

  it("zet de bestanden van een beurt aaneen in het rooster", () => {
    const map = buildSponsorSlotMap([other, seq], "match", 45 * 60, "FIRST_HALF");
    expect(map.filter((id) => id === seq.id).length).toBeGreaterThan(0);
  });

  it("stopt een reeks niet halverwege door het budgetplafond", () => {
    expect(budgetCapSeconds(seq, 84)).toBe(84 + 14);
    expect(budgetCapSeconds(other, 60)).toBe(60);
  });

  it("begint elke nieuwe beurt bij het eerste bestand", () => {
    expect(sequenceStartIndex(0, 3)).toBe(0);
    expect(sequenceStartIndex(3, 3)).toBe(3);
    expect(sequenceStartIndex(4, 3)).toBe(6);
    expect(sequenceStartIndex(5, 0)).toBe(0);
  });

  it("schrijft een bestand uit een reeks zonder sponsor als clubbestand in het afspeellog", () => {
    expect(sponsorPlayLogIdentity({ sponsorId: "seq:s1", sponsorRowName: null, mediaTitle: "Club" })).toEqual({
      sponsorId: null,
      sponsorName: "Club",
    });
    expect(sponsorPlayLogIdentity({ sponsorId: "kumho-sponsor", sponsorRowName: "Kumho", mediaTitle: "x" })).toEqual({
      sponsorId: "kumho-sponsor",
      sponsorName: "Kumho",
    });
  });
});
