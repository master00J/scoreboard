import { describe, expect, it } from "vitest";
import { computeElapsedSeconds, runFrom, stopAt } from "./timer";

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
