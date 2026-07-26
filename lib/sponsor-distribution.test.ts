import { describe, expect, it } from "vitest";
import type { MediaItem, Sponsor } from "./types";
import {
  buildSponsorAppearancePlan,
  buildSponsorSlotMap,
  holdSecondsCappedBySlotRun,
  sponsorAppearanceIndexAt,
  sponsorScreenSecondsConsumed,
} from "./sponsor-distribution";

function media(id: string, durationSec: number): MediaItem {
  return {
    id,
    sponsorId: "sp",
    type: "VIDEO",
    url: `/${id}.mp4`,
    durationSec,
    active: true,
    createdAt: `2026-01-01T00:00:${id.padStart(2, "0")}.000Z`,
  } as unknown as MediaItem;
}

function sponsor(prematchSeconds: number, clips: number[]): Sponsor {
  return {
    id: "sp",
    name: "Matchsponsor",
    active: true,
    prematchSeconds,
    halftimeSeconds: 0,
    matchSeconds: 0,
    imageDefaultSec: 10,
    media: clips.map((sec, i) => media(String(i + 1), sec)),
    sponsorPlaybackOrderJson: null,
    sponsorPlaybackRepeatsJson: null,
  } as unknown as Sponsor;
}

describe("sponsor appearance plan — één vertoning = één clip", () => {
  it("vult het budget met opeenvolgende clips uit de rotatie", () => {
    // 3 clips van 20s, budget 120s → 6 vertoningen van 20s, samen precies 120s.
    const plan = buildSponsorAppearancePlan([sponsor(120, [20, 20, 20])], "prematch");
    expect(plan).toHaveLength(1);
    expect(plan[0]!.appearances).toBe(6);
    expect(plan[0]!.appearanceSecs).toEqual([20, 20, 20, 20, 20, 20]);
    expect(plan[0]!.appearanceSecs.reduce((a, b) => a + b, 0)).toBe(120);
  });

  it("kapt nooit een clip af: de laatste mag over het budget uitlopen", () => {
    // 30,20,10,30 = 90 < 100 → er is nog budget, dus clip 5 (20s) start ook en speelt
    // helemaal uit → 110. Afkappen op 100 mag niet.
    const plan = buildSponsorAppearancePlan([sponsor(100, [30, 20, 10])], "prematch");
    expect(plan[0]!.appearanceSecs).toEqual([30, 20, 10, 30, 20]);
    expect(plan[0]!.appearanceSecs.reduce((a, b) => a + b, 0)).toBe(110);
  });

  it("start geen nieuwe clip meer zodra het budget precies op is", () => {
    // 20+20+20 = 60 = budget → stoppen, niet nog een vierde clip starten.
    const plan = buildSponsorAppearancePlan([sponsor(60, [20, 20, 20])], "prematch");
    expect(plan[0]!.appearanceSecs).toEqual([20, 20, 20]);
  });

  it("toont een geboekte sponsor volledig ook als het budget kleiner is dan de clip", () => {
    const plan = buildSponsorAppearancePlan([sponsor(5, [20])], "prematch");
    expect(plan[0]!.appearanceSecs).toEqual([20]);
  });
});

describe("hold per vertoning volgt de rotatie", () => {
  it("geeft clip 1, dan clip 2, dan clip 3 terug voor opeenvolgende slots", () => {
    const s = sponsor(120, [30, 20, 10]);
    const map = buildSponsorSlotMap([s], "prematch", 120);

    // Startseconden van de eerste drie vertoningen op de slotmap.
    const starts: number[] = [];
    let prev: string | null = null;
    for (let i = 0; i < map.length; i++) {
      const cur = map[i] ?? null;
      if (cur === "sp" && prev !== "sp") starts.push(i);
      prev = cur;
    }
    expect(starts.length).toBeGreaterThanOrEqual(3);

    expect(sponsorAppearanceIndexAt(map, "sp", starts[0]!)).toBe(0);
    expect(sponsorAppearanceIndexAt(map, "sp", starts[1]!)).toBe(1);
    expect(sponsorAppearanceIndexAt(map, "sp", starts[2]!)).toBe(2);

    expect(holdSecondsCappedBySlotRun([s], "prematch", undefined, "sp", map, starts[0]!)).toBe(30);
    expect(holdSecondsCappedBySlotRun([s], "prematch", undefined, "sp", map, starts[1]!)).toBe(20);
    expect(holdSecondsCappedBySlotRun([s], "prematch", undefined, "sp", map, starts[2]!)).toBe(10);
  });
});

describe("verbruikte schermtijd blijft in de buurt van het budget", () => {
  it("overschrijdt het budget niet meer met een veelvoud bij meerdere clips", () => {
    // Regressie: hold was een volledige pass (60s) terwijl het rooster met 20s rekende,
    // waardoor deze sponsor 3× zijn geboekte schermtijd kreeg.
    const s = sponsor(120, [20, 20, 20]);
    const map = buildSponsorSlotMap([s], "prematch", 120);
    const consumed = sponsorScreenSecondsConsumed(map, [s], "prematch", undefined, 120, "sp");
    expect(consumed).toBeGreaterThan(0);
    // Hoogstens één lopende clip overschot — nooit een veelvoud van het budget.
    expect(consumed).toBeLessThanOrEqual(120 + 20);
  });
});
