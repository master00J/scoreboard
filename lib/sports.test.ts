import { describe, expect, it } from "vitest";
import {
  getSportProfile,
  lifecycleStatusForPeriod,
  normalizeSport,
  resetTimeoutsForNewPeriod,
  sportClockSeconds,
  sportPeriodLabel,
} from "./sports";

describe("multisport-profielen", () => {
  it("houdt bestaande wedstrijden achterwaarts compatibel als voetbal", () => {
    expect(normalizeSport(undefined)).toBe("FOOTBALL");
    expect(getSportProfile("FOOTBALL").timerMode).toBe("COUNT_UP");
    expect(sportClockSeconds("FOOTBALL", 123, 2700)).toBe(123);
  });

  it("gebruikt sportspecifieke periodes en aftellende klokken", () => {
    expect(getSportProfile("FUTSAL").defaultPeriodDurationSec).toBe(1200);
    expect(sportClockSeconds("FUTSAL", 75, 1200)).toBe(1125);
    expect(sportClockSeconds("BASKETBALL", 601, 600)).toBe(0);
    expect(sportPeriodLabel("VOLLEYBALL", 3)).toBe("SET 3");
    expect(sportPeriodLabel("HOCKEY", 4)).toBe("QUARTER 4");
  });

  it("projecteert meerdere periodes op de bestaande sponsorhelften", () => {
    expect(lifecycleStatusForPeriod("BASKETBALL", 1)).toBe("FIRST_HALF");
    expect(lifecycleStatusForPeriod("BASKETBALL", 2)).toBe("FIRST_HALF");
    expect(lifecycleStatusForPeriod("BASKETBALL", 3)).toBe("SECOND_HALF");
    expect(lifecycleStatusForPeriod("BASKETBALL", 4)).toBe("SECOND_HALF");
  });

  it("reset basketbal-time-outs alleen tussen beide helften", () => {
    expect(resetTimeoutsForNewPeriod("BASKETBALL", 1, 2)).toBe(false);
    expect(resetTimeoutsForNewPeriod("BASKETBALL", 2, 3)).toBe(true);
    expect(resetTimeoutsForNewPeriod("FUTSAL", 1, 2)).toBe(true);
  });

  it("activeert alleen bij basketbal een shotclock", () => {
    expect(getSportProfile("BASKETBALL").shotClockPresets).toEqual([24, 14]);
    expect(getSportProfile("FUTSAL").shotClockPresets).toEqual([]);
    expect(getSportProfile("VOLLEYBALL").timerMode).toBe("NONE");
  });
});
