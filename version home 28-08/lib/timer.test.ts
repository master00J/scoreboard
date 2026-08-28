import { describe, expect, it } from "vitest";
import {
  computeElapsedSeconds,
  computeShotClockSeconds,
  pauseShotClockAt,
  runFrom,
  runShotClockFrom,
  stopAt,
} from "./timer";

describe("computeElapsedSeconds", () => {
  it("geeft base terug wanneer timer niet loopt", () => {
    expect(
      computeElapsedSeconds(
        { timerRunning: false, timerStartedAt: null, timerBaseSec: 120 },
        1_700_000_000_000,
      ),
    ).toBe(120);
  });

  it("telt op wanneer timer loopt", () => {
    const started = new Date("2024-01-01T12:00:00.000Z");
    const now = started.getTime() + 5000;
    expect(
      computeElapsedSeconds(
        { timerRunning: true, timerStartedAt: started, timerBaseSec: 10 },
        now,
      ),
    ).toBe(15);
  });
});

describe("stopAt / runFrom", () => {
  it("stopAt zet base en stopt", () => {
    const s = stopAt(333);
    expect(s.timerRunning).toBe(false);
    expect(s.timerStartedAt).toBeNull();
    expect(s.timerBaseSec).toBe(333);
  });

  it("runFrom start vanaf gegeven seconde", () => {
    const d = new Date("2025-06-01T10:00:00.000Z");
    const r = runFrom(42, d);
    expect(r.timerRunning).toBe(true);
    expect(r.timerBaseSec).toBe(42);
    expect(r.timerStartedAt?.getTime()).toBe(d.getTime());
  });
});

describe("shotclock", () => {
  it("telt onafhankelijk af en stopt visueel op nul", () => {
    const started = new Date("2026-01-01T12:00:00.000Z");
    expect(
      computeShotClockSeconds(
        {
          shotClockRunning: true,
          shotClockStartedAt: started,
          shotClockBaseSec: 24,
        },
        started.getTime() + 10_000,
      ),
    ).toBe(14);
    expect(
      computeShotClockSeconds(
        {
          shotClockRunning: true,
          shotClockStartedAt: started,
          shotClockBaseSec: 14,
        },
        started.getTime() + 20_000,
      ),
    ).toBe(0);
  });

  it("kan starten en gepauzeerd worden", () => {
    const started = new Date("2026-01-01T12:00:00.000Z");
    expect(runShotClockFrom(24, started)).toEqual({
      shotClockRunning: true,
      shotClockStartedAt: started,
      shotClockBaseSec: 24,
    });
    expect(pauseShotClockAt(13.2)).toEqual({
      shotClockRunning: false,
      shotClockStartedAt: null,
      shotClockBaseSec: 14,
    });
  });
});
