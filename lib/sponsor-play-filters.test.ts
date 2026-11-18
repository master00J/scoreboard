import { describe, expect, it } from "vitest";
import {
  proofOfPlayTotals,
  segmentKeyMatchesFilter,
  sponsorPlayPhaseOfSegmentKey,
  sponsorPlaySegmentKeyCondition,
} from "./sponsor-play-filters";
import { sponsorTelemetrySegmentKey } from "./sponsor-telemetry";

describe("sponsorPlaySegmentKeyCondition", () => {
  it("matches a phase at the end of the stored key, not at the start", () => {
    expect(sponsorPlaySegmentKeyCondition("FIRST_HALF")).toEqual({ endsWith: ":FIRST_HALF" });
    expect(segmentKeyMatchesFilter("cm123:FIRST_HALF", "FIRST_HALF")).toBe(true);
    expect(segmentKeyMatchesFilter("cm123:SECOND_HALF", "FIRST_HALF")).toBe(false);
  });

  it("finds post-match plays", () => {
    const key = sponsorTelemetrySegmentKey("cm123", "POST_MATCH", "postmatch");
    expect(key).toBe("cm123:postmatch");
    expect(segmentKeyMatchesFilter(key!, "postmatch")).toBe(true);
    expect(segmentKeyMatchesFilter(key!, "prematch")).toBe(false);
  });

  it("matches every phase written by the telemetry", () => {
    const cases: Array<[string | undefined, Parameters<typeof sponsorTelemetrySegmentKey>[2], string]> = [
      ["PREMATCH", "prematch", "prematch"],
      ["FIRST_HALF", "match", "FIRST_HALF"],
      ["HALF_TIME", "halftime", "halftime"],
      ["SECOND_HALF", "match", "SECOND_HALF"],
      ["EXTRA_TIME", "match", "EXTRA_TIME"],
      ["POST_MATCH", "postmatch", "postmatch"],
    ];
    for (const [status, section, filter] of cases) {
      const key = sponsorTelemetrySegmentKey("m1", status, section)!;
      expect(segmentKeyMatchesFilter(key, filter)).toBe(true);
      expect(sponsorPlayPhaseOfSegmentKey(key)).toBe(filter);
    }
  });

  it("treats a full key as an exact match and empty as no filter", () => {
    expect(sponsorPlaySegmentKeyCondition("m1:halftime")).toEqual({ equals: "m1:halftime" });
    expect(segmentKeyMatchesFilter("m2:halftime", "m1:halftime")).toBe(false);
    expect(sponsorPlaySegmentKeyCondition("")).toBeUndefined();
    expect(sponsorPlaySegmentKeyCondition(undefined)).toBeUndefined();
    expect(segmentKeyMatchesFilter("anything", "")).toBe(true);
  });
});

describe("proofOfPlayTotals", () => {
  it("sums the per-sponsor aggregate", () => {
    const totals = proofOfPlayTotals([
      { plays: 400, actualSec: 6000, expectedSec: 6000 },
      { plays: 200, actualSec: 2000, expectedSec: 4000 },
    ]);
    expect(totals).toEqual({
      totalPlays: 600,
      totalActualSec: 8000,
      totalExpectedSec: 10000,
      avgFulfillmentPercent: 80,
    });
  });

  it("is zero without plays", () => {
    expect(proofOfPlayTotals([])).toEqual({
      totalPlays: 0,
      totalActualSec: 0,
      totalExpectedSec: 0,
      avgFulfillmentPercent: 0,
    });
  });
});
