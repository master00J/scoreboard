import { describe, expect, it } from "vitest";
import { sponsorScheduleTime, type SponsorScheduleClock } from "./sponsor-schedule-clock";

function makeRef(initial: Partial<SponsorScheduleClock> = {}): { current: SponsorScheduleClock } {
  return {
    current: {
      key: "",
      adjustedT: 0,
      lastRawT: 0,
      initialized: false,
      wasFrozen: false,
      ...initial,
    },
  };
}

describe("sponsorScheduleTime", () => {
  it("bevriest adjustedT wanneer frozen true", () => {
    const ref = makeRef();
    sponsorScheduleTime(ref, "k1", 0, false, 100);
    sponsorScheduleTime(ref, "k1", 30, false, 100);
    expect(ref.current.adjustedT).toBe(30);
    const frozen = sponsorScheduleTime(ref, "k1", 100, true, 100);
    expect(frozen).toBe(30);
    const still = sponsorScheduleTime(ref, "k1", 200, true, 100);
    expect(still).toBe(30);
  });

  it("loopt op na unfreeze met delta", () => {
    const ref = makeRef();
    sponsorScheduleTime(ref, "k2", 0, false, 100);
    sponsorScheduleTime(ref, "k2", 10, false, 100);
    sponsorScheduleTime(ref, "k2", 20, true, 100);
    expect(ref.current.adjustedT).toBe(10);
    sponsorScheduleTime(ref, "k2", 20, false, 100);
    sponsorScheduleTime(ref, "k2", 35, false, 100);
    expect(ref.current.adjustedT).toBe(25);
  });
});
