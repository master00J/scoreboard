import { describe, expect, it } from "vitest";
import type { MediaItem } from "./types";
import {
  applySponsorPlaybackOrder,
  plannedSecondsForRepeats,
  repeatCountForTargetSeconds,
} from "./sponsor-playback-order";

describe("sponsor media airtime", () => {
  it("rounds up to full media plays so the requested airtime is reached", () => {
    expect(repeatCountForTargetSeconds(35, 120)).toBe(4);
    expect(plannedSecondsForRepeats(35, 4)).toBe(140);
  });

  it("always schedules at least one complete play", () => {
    expect(repeatCountForTargetSeconds(30, 5)).toBe(1);
    expect(plannedSecondsForRepeats(30, 1)).toBe(30);
  });

  it("supports longer airtime targets than the legacy twenty-repeat limit", () => {
    expect(repeatCountForTargetSeconds(10, 600)).toBe(60);
  });
});

describe("uploadvolgorde in het hoofdproces", () => {
  it("sorteert ook als createdAt een Date uit de database is", () => {
    const item = (id: string, createdAt: unknown) =>
      ({ id, active: true, createdAt, type: "VIDEO", durationSec: 5 }) as unknown as MediaItem;
    const media = [item("later", new Date("2026-11-18T12:00:00Z")), item("eerst", new Date("2026-11-17T12:00:00Z"))];
    expect(applySponsorPlaybackOrder(media, null).map((m) => m.id)).toEqual(["eerst", "later"]);
    expect(applySponsorPlaybackOrder(media, JSON.stringify(["onbekend"])).map((m) => m.id)).toEqual(["eerst", "later"]);
  });
});
