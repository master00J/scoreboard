import { describe, expect, it } from "vitest";
import {
  describePeriod,
  formatSportClock,
  getSportProfile,
  lifecycleStatusForPeriod,
  matchBreakDurationSec,
  normalizeSport,
  periodDurationSecFor,
  periodForLifecycleStatus,
  resetStatsForNewPeriod,
  resetTimeoutsForNewPeriod,
  sportClockSeconds,
  sportMaxPeriod,
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
    expect(lifecycleStatusForPeriod("BASKETBALL", 5)).toBe("EXTRA_TIME");
  });

  it("leidt de periode af uit een status (voetbalflow, mobiel)", () => {
    expect(periodForLifecycleStatus("FOOTBALL", "SECOND_HALF", 1)).toBe(2);
    expect(periodForLifecycleStatus("FOOTBALL", "EXTRA_TIME", 2)).toBe(3);
    expect(periodForLifecycleStatus("FOOTBALL", "EXTRA_TIME", 4)).toBe(4);
    expect(periodForLifecycleStatus("BASKETBALL", "SECOND_HALF", 1)).toBe(3);
    expect(periodForLifecycleStatus("BASKETBALL", "SECOND_HALF", 4)).toBe(4);
    expect(periodForLifecycleStatus("BASKETBALL", "FIRST_HALF", 4)).toBe(2);
  });

  it("reset basketbal-time-outs per helft en per verlenging", () => {
    expect(resetTimeoutsForNewPeriod("BASKETBALL", 1, 2)).toBe(false);
    expect(resetTimeoutsForNewPeriod("BASKETBALL", 2, 3)).toBe(true);
    expect(resetTimeoutsForNewPeriod("BASKETBALL", 4, 5)).toBe(true);
    expect(resetTimeoutsForNewPeriod("BASKETBALL", 5, 6)).toBe(true);
    expect(resetTimeoutsForNewPeriod("FUTSAL", 1, 2)).toBe(true);
    // Futsal: geen time-outs in de verlenging.
    expect(getSportProfile("FUTSAL").timeoutLimitForPeriod(3)).toBe(0);
    expect(getSportProfile("BASKETBALL").timeoutLimitForPeriod(5)).toBe(1);
  });

  it("laat teamfouten doorlopen in de verlenging en reset hockey-straffen nooit", () => {
    expect(resetStatsForNewPeriod("BASKETBALL", 1, 2)).toBe(true);
    expect(resetStatsForNewPeriod("BASKETBALL", 4, 5)).toBe(false);
    expect(resetStatsForNewPeriod("FUTSAL", 1, 2)).toBe(true);
    expect(resetStatsForNewPeriod("FUTSAL", 2, 3)).toBe(false);
    expect(resetStatsForNewPeriod("HOCKEY", 1, 2)).toBe(false);
    expect(resetStatsForNewPeriod("FOOTBALL", 1, 2)).toBe(false);
  });

  it("kent verlenging alleen waar de sport dat heeft", () => {
    expect(sportMaxPeriod("BASKETBALL")).toBe(9);
    expect(sportMaxPeriod("FUTSAL")).toBe(4);
    expect(sportMaxPeriod("FOOTBALL")).toBe(4);
    expect(sportMaxPeriod("HOCKEY")).toBe(4);
    expect(sportMaxPeriod("VOLLEYBALL")).toBe(5);
    expect(describePeriod("BASKETBALL", 5)).toEqual({ kind: "overtime", index: 1 });
    expect(sportPeriodLabel("BASKETBALL", 6)).toBe("VERLENGING 2");
    expect(periodDurationSecFor("BASKETBALL", 5, 600)).toBe(300);
    expect(periodDurationSecFor("BASKETBALL", 2, 600)).toBe(600);
    expect(periodDurationSecFor("FOOTBALL", 3, 2400)).toBe(900);
  });

  it("formatteert de klok per sport (aftellen naar boven, tienden onder de minuut)", () => {
    expect(formatSportClock("FOOTBALL", 125.9)).toBe("02:05");
    expect(formatSportClock("FUTSAL", 0.4)).toBe("00:01");
    expect(formatSportClock("FUTSAL", 0)).toBe("00:00");
    expect(formatSportClock("HOCKEY", 899.2)).toBe("15:00");
    expect(formatSportClock("BASKETBALL", 59.94)).toBe("60.0");
    expect(formatSportClock("BASKETBALL", 9.81)).toBe("9.9");
    expect(formatSportClock("BASKETBALL", 0)).toBe("0.0");
    expect(formatSportClock("BASKETBALL", 61)).toBe("01:01");
  });

  it("kiest de pauzeduur per soort pauze", () => {
    expect(matchBreakDurationSec({ sport: "BASKETBALL", currentPeriod: 1, halfBreakSec: 900 })).toBe(120);
    expect(matchBreakDurationSec({ sport: "BASKETBALL", currentPeriod: 2, halfBreakSec: 900 })).toBe(900);
    expect(matchBreakDurationSec({ sport: "FOOTBALL", currentPeriod: 1, halfBreakSec: 600 })).toBe(600);
    expect(matchBreakDurationSec({ sport: "VOLLEYBALL", currentPeriod: 3, halfBreakSec: 180 })).toBe(180);
    expect(matchBreakDurationSec({ sport: "HOCKEY", currentPeriod: 3, halfBreakSec: 600 })).toBe(120);
  });

  it("activeert alleen bij basketbal een shotclock", () => {
    expect(getSportProfile("BASKETBALL").shotClockPresets).toEqual([24, 14]);
    expect(getSportProfile("FUTSAL").shotClockPresets).toEqual([]);
    expect(getSportProfile("VOLLEYBALL").timerMode).toBe("NONE");
    expect(getSportProfile("HOCKEY").penaltyFollowsClock).toBe(true);
  });
});
