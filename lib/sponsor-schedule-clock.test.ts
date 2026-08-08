import { describe, expect, it } from "vitest";
import {
  createSponsorScheduleClock,
  sponsorScheduleTime,
  type SponsorScheduleClock,
} from "./sponsor-schedule-clock";

function makeRef(initial: Partial<SponsorScheduleClock> = {}): { current: SponsorScheduleClock } {
  return {
    current: {
      ...createSponsorScheduleClock(),
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

  it("hard-reset bij terugspringen (Set time / preset)", () => {
    const ref = makeRef();
    sponsorScheduleTime(ref, "half", 120, false, 2700);
    expect(ref.current.hardReset).toBe(true);
    sponsorScheduleTime(ref, "half", 125, false, 2700);
    expect(ref.current.hardReset).toBe(false);
    expect(ref.current.adjustedT).toBe(125);

    const t = sponsorScheduleTime(ref, "half", 0, false, 2700);
    expect(t).toBe(0);
    expect(ref.current.hardReset).toBe(true);
    expect(ref.current.adjustedT).toBe(0);
  });

  it("hard-reset bij grote vooruitsprong, niet bij kleine lag", () => {
    const ref = makeRef();
    sponsorScheduleTime(ref, "half", 10, false, 2700);
    sponsorScheduleTime(ref, "half", 13, false, 2700);
    expect(ref.current.hardReset).toBe(false);
    expect(ref.current.adjustedT).toBe(13);

    sponsorScheduleTime(ref, "half", 600, false, 2700);
    expect(ref.current.hardReset).toBe(true);
    expect(ref.current.adjustedT).toBe(600);
  });

  it("geen hard-reset bij vooruitsprong tijdens freeze (interrupt)", () => {
    const ref = makeRef();
    sponsorScheduleTime(ref, "half", 50, false, 2700);
    sponsorScheduleTime(ref, "half", 200, true, 2700);
    expect(ref.current.hardReset).toBe(false);
    expect(ref.current.adjustedT).toBe(50);
  });
});
