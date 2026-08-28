import { describe, expect, it } from "vitest";
import {
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
