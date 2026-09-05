import { describe, expect, it } from "vitest";
import {
  computeElapsedSeconds,
  computeShotClockSeconds,
  pauseShotClockAt,
  resolveLiveElapsedSeconds,
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

  it("blijft op de base als now achter startedAt loopt", () => {
    const started = new Date("2024-01-01T12:00:00.200Z");
    expect(
      computeElapsedSeconds(
        { timerRunning: true, timerStartedAt: started, timerBaseSec: 21 },
        started.getTime() - 180,
      ),
    ).toBe(21);
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

describe("resolveLiveElapsedSeconds", () => {
  it("volgt DisplayState wanneer het startanker geldig is", () => {
    const started = "2024-01-01T12:00:00.000Z";
    const now = Date.parse(started) + 5000;
    expect(
      resolveLiveElapsedSeconds(
        { timerRunning: true, timerStartedAt: started, timerBaseSec: 0 },
        null,
        now,
      ),
    ).toBe(5);
  });

  it("gebruikt de tick als timerRunning aan staat zonder startanker", () => {
    const now = 1_700_000_005_000;
    expect(
      resolveLiveElapsedSeconds(
        { timerRunning: true, timerStartedAt: null, timerBaseSec: 0 },
        { elapsed: 5, running: true, startedAt: null, baseSec: 0, serverNow: now },
        now,
      ),
    ).toBe(5);
  });

  it("negeert een stale lopende tick na pauze", () => {
    const now = 1_700_000_010_000;
    expect(
      resolveLiveElapsedSeconds(
        { timerRunning: false, timerStartedAt: null, timerBaseSec: 20 },
        { elapsed: 21.4, running: true, startedAt: null, baseSec: 20, serverNow: now - 800 },
        now,
      ),
    ).toBe(20);
  });

  it("zakt niet onder de base als now achter startedAt loopt", () => {
    const started = "2024-01-01T12:00:00.200Z";
    const now = Date.parse(started) - 180;
    expect(
      resolveLiveElapsedSeconds(
        { timerRunning: true, timerStartedAt: started, timerBaseSec: 21 },
        null,
        now,
      ),
    ).toBe(21);
  });
});
