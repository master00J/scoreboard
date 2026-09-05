import { describe, expect, it, vi } from "vitest";
import { applySponsorSpreadTick } from "./sponsor-spread-tick";
import { streamSponsorInterrupted, streamSponsorTimelineSeconds } from "./stream-sponsor-schedule";

describe("streamSponsorInterrupted", () => {
  it("bevriest bij goal/kaart/wissel, niet bij rust", () => {
    expect(streamSponsorInterrupted("GOAL")).toBe(true);
    expect(streamSponsorInterrupted("CARD")).toBe(true);
    expect(streamSponsorInterrupted("HALFTIME")).toBe(false);
    expect(streamSponsorInterrupted("FULLTIME")).toBe(false);
  });
});

describe("streamSponsorTimelineSeconds", () => {
  it("gebruikt helft- en rustduur", () => {
    const match = { halfDurationSec: 1200, halfBreakSec: 900, prematchSpreadWindowSec: 600 };
    expect(streamSponsorTimelineSeconds("match", match, [])).toBe(1200);
    expect(streamSponsorTimelineSeconds("halftime", match, [])).toBe(900);
    expect(streamSponsorTimelineSeconds("prematch", match, [])).toBe(600);
  });
});

describe("applySponsorSpreadTick", () => {
  it("voert compute maar één keer uit per tick-key", () => {
    const cache: { current: { key: string; value: number } | null } = { current: null };
    const compute = vi.fn(() => 1);
    expect(applySponsorSpreadTick(cache, "t1", compute)).toBe(1);
    expect(applySponsorSpreadTick(cache, "t1", compute)).toBe(1);
    expect(compute).toHaveBeenCalledTimes(1);
    applySponsorSpreadTick(cache, "t2", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
