import { describe, expect, it } from "vitest";
import { computePrematchSpreadTiming } from "./prematch-spread-timing";
import type { Sponsor } from "./types";

const sponsors: Sponsor[] = [
  {
    id: "s1",
    name: "Test",
    active: true,
    prematchSeconds: 120,
    halftimeSeconds: 0,
    matchSeconds: 0,
    matchFirstHalfSeconds: 0,
    matchSecondHalfSeconds: 0,
    imageDefaultSec: 10,
    media: [],
    createdAt: "",
  },
];

describe("computePrematchSpreadTiming", () => {
  it("ankert venster op kickoff minus H", () => {
    const kickoffAt = "2030-01-01T20:00:00.000Z";
    const match = { kickoffAt, prematchSpreadWindowSec: 1800 };
    const ko = new Date(kickoffAt).getTime();
    const before = computePrematchSpreadTiming(match, sponsors, ko - 31 * 60_000, null);
    expect(before.beforeWindow).toBe(true);
    expect(before.rosterRunning).toBe(false);

    const mid = computePrematchSpreadTiming(match, sponsors, ko - 15 * 60_000, null);
    expect(mid.beforeWindow).toBe(false);
    expect(mid.rosterRunning).toBe(true);
    expect(mid.elapsedSec).toBeCloseTo(15 * 60, 0);

    const after = computePrematchSpreadTiming(match, sponsors, ko + 1000, null);
    expect(after.timelineComplete).toBe(true);
  });
});
