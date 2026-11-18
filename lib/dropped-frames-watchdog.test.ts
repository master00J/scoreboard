import { describe, expect, it } from "vitest";
import { evaluateDroppedFrames, type FrameQualityReading } from "./dropped-frames-watchdog";

const r = (total: number, dropped: number): FrameQualityReading => ({
  totalVideoFrames: total,
  droppedVideoFrames: dropped,
});

describe("evaluateDroppedFrames", () => {
  it("triggers when nearly every frame in the window is dropped (total already includes drops)", () => {
    const start = evaluateDroppedFrames(null, r(100, 10));
    expect(start.fault).toBe(false);
    // 200 new frames, 190 of them dropped: 95%. The old formula gave 190 / 390 = 49%.
    const check = evaluateDroppedFrames(start.baseline, r(300, 200));
    expect(check.ratio).toBeCloseTo(0.95);
    expect(check.fault).toBe(true);
  });

  it("can reach the threshold on cumulative counters from a zero baseline", () => {
    const check = evaluateDroppedFrames(r(0, 0), r(150, 140));
    expect(check.fault).toBe(true);
    expect(check.windowFrames).toBe(150);
    expect(check.windowDropped).toBe(140);
  });

  it("does not trigger on a healthy video", () => {
    const check = evaluateDroppedFrames(r(0, 0), r(300, 12));
    expect(check.fault).toBe(false);
    expect(check.ratio).toBeCloseTo(0.04);
  });

  it("keeps collecting until the window has enough frames", () => {
    const base = r(50, 0);
    const early = evaluateDroppedFrames(base, r(100, 50));
    expect(early.fault).toBe(false);
    expect(early.ratio).toBeNull();
    expect(early.baseline).toBe(base);
    const later = evaluateDroppedFrames(early.baseline, r(200, 145));
    expect(later.fault).toBe(true);
  });

  it("judges the current window, not the healthy start of the clip", () => {
    // 3000 good frames first, then 200 frames of which 190 dropped.
    const healthy = evaluateDroppedFrames(r(0, 0), r(3000, 10));
    expect(healthy.fault).toBe(false);
    const bad = evaluateDroppedFrames(healthy.baseline, r(3200, 200));
    expect(bad.fault).toBe(true);
    // Cumulative over the whole clip this would only be 200 / 3200 = 6%.
  });

  it("starts a new window when the counters go backwards (new source)", () => {
    const check = evaluateDroppedFrames(r(500, 400), r(20, 0));
    expect(check.fault).toBe(false);
    expect(check.baseline).toEqual(r(20, 0));
  });

  it("ignores invalid readings", () => {
    const check = evaluateDroppedFrames(r(10, 0), r(Number.NaN, 5));
    expect(check.fault).toBe(false);
    expect(check.baseline).toEqual(r(10, 0));
  });
});
