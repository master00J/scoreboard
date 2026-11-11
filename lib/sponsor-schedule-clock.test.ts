import { describe, expect, it } from "vitest";
import {
  createSponsorScheduleClock,
  sponsorScheduleLagSec,
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

describe("sponsorScheduleLagSec", () => {
  it("geeft 0 zolang niets het rooster heeft stilgezet", () => {
    const ref = makeRef();
    expect(sponsorScheduleLagSec(ref.current, 40, false)).toBe(0);
    sponsorScheduleTime(ref, "half", 0, false, 2700);
    sponsorScheduleTime(ref, "half", 60, false, 2700);
    expect(sponsorScheduleLagSec(ref.current, 60, false)).toBe(0);
    // Tussen twee ticks loopt het rooster gewoon mee met de klok.
    expect(sponsorScheduleLagSec(ref.current, 60.3, false)).toBeCloseTo(0);
  });

  it("telt elke onderbreking op: een cue van 15 s om de 2 minuten", () => {
    const ref = makeRef();
    // Elke seconde een tick, zoals de HUD en het scherm doen; de cue loopt [start, start + 15).
    for (let raw = 0; raw <= 400; raw++) {
      const inCue = raw >= 120 && raw % 120 < 15;
      sponsorScheduleTime(ref, "half", raw, inCue, 2700);
    }
    const lag = sponsorScheduleLagSec(ref.current, 400, false);
    expect(lag).toBe(400 - ref.current.adjustedT);
    // Drie cues van 15 s; per cue gaat ook de tick aan de rand verloren.
    expect(lag).toBeGreaterThanOrEqual(45);
    expect(lag).toBeLessThanOrEqual(48);
    expect(sponsorScheduleLagSec(ref.current, 400.4, false)).toBeCloseTo(lag);
  });

  it("groeit mee terwijl de onderbreking nog loopt en verzet de klok niet", () => {
    const ref = makeRef();
    sponsorScheduleTime(ref, "half", 0, false, 2700);
    sponsorScheduleTime(ref, "half", 100, false, 2700);
    sponsorScheduleTime(ref, "half", 104, true, 2700);
    expect(sponsorScheduleLagSec(ref.current, 110, true)).toBe(10);
    expect(ref.current.adjustedT).toBe(100);
    expect(ref.current.lastRawT).toBe(104);
    // Onderbreking voorbij, eerstvolgende tick is er nog niet: het rooster staat nog op 100.
    expect(sponsorScheduleLagSec(ref.current, 112, false)).toBe(12);
  });
});
