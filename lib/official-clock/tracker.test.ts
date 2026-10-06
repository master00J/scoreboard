import { describe, expect, it } from "vitest";
import { ClockTracker } from "./tracker";

describe("ClockTracker", () => {
  it("knows nothing before the first reading", () => {
    const tracker = new ClockTracker();
    expect(tracker.estimate(1000)).toBeNull();
  });

  it("trusts the console when it says whether the clock runs", () => {
    const tracker = new ClockTracker();
    tracker.update({ seconds: 600, resolution: 1, running: false }, 0, "down");
    expect(tracker.estimate(500)).toMatchObject({ running: false, shown: 600, value: 600 });
    tracker.update({ seconds: 600, resolution: 1, running: true }, 1000, "down");
    // Loopt volgens de console, nog geen tik gezien: we weten alleen wat er staat.
    expect(tracker.estimate(1200)).toMatchObject({ running: true, shown: 600, value: 600 });
    tracker.update({ seconds: 599, resolution: 1, running: true }, 1800, "down");
    // Op de tik was de stand precies 599; 0,4 seconden later is dat 598,6.
    expect(tracker.estimate(2200)?.value).toBeCloseTo(598.6, 3);
    tracker.update({ seconds: 599, resolution: 1, running: false }, 2300, "down");
    expect(tracker.estimate(2300)).toMatchObject({ running: false, shown: 599, value: 599 });
  });

  it("never estimates past what the console shows", () => {
    const tracker = new ClockTracker();
    tracker.update({ seconds: 15, resolution: 1, running: true }, 0, "down");
    tracker.update({ seconds: 14, resolution: 1, running: true }, 1000, "down");
    const late = tracker.estimate(2400);
    expect(late?.value).toBeGreaterThan(13);
    expect(late?.value).toBeLessThanOrEqual(14);
  });

  it("infers running from ticks when the console does not say", () => {
    const tracker = new ClockTracker();
    tracker.update({ seconds: 24, resolution: 1 }, 0, "down");
    expect(tracker.estimate(100)?.running).toBe(false);
    tracker.update({ seconds: 23, resolution: 1 }, 900, "down");
    expect(tracker.estimate(1000)).toMatchObject({ running: true, shown: 23 });
    // Dezelfde stand blijft binnenkomen: na ruim een seconde staat de klok stil.
    for (let at = 1000; at <= 2300; at += 100) tracker.update({ seconds: 23, resolution: 1 }, at, "down");
    expect(tracker.estimate(2300)?.running).toBe(false);
  });

  it("does not call a reset a tick", () => {
    const tracker = new ClockTracker();
    tracker.update({ seconds: 20, resolution: 1 }, 0, "down");
    tracker.update({ seconds: 19, resolution: 1 }, 1000, "down");
    expect(tracker.estimate(1100)?.running).toBe(true);
    tracker.update({ seconds: 24, resolution: 1 }, 1500, "down");
    expect(tracker.estimate(1600)).toMatchObject({ running: false, shown: 24, value: 24 });
    // Een sprong naar beneden (24 → 14) is ook geen tik.
    tracker.update({ seconds: 14, resolution: 1 }, 1700, "down");
    expect(tracker.estimate(1800)?.running).toBe(false);
  });

  it("keeps running through a gap in the feed but stops on a frozen value", () => {
    const tracker = new ClockTracker();
    tracker.update({ seconds: 30, resolution: 1, running: true }, 0, "down");
    tracker.update({ seconds: 29, resolution: 1, running: true }, 1000, "down");
    // Twee seconden geen berichten (netwerk hapert): de console zei "loopt", dus we tellen door.
    expect(tracker.estimate(3000)?.running).toBe(true);
    expect(tracker.estimate(3000)?.ageSec).toBe(2);
    // Berichten komen weer, maar de stand staat al die tijd op 29: de vlag klopt niet meer.
    tracker.update({ seconds: 29, resolution: 1, running: true }, 3100, "down");
    expect(tracker.estimate(3100)?.running).toBe(false);
    tracker.update({ seconds: 28, resolution: 1, running: true }, 3200, "down");
    expect(tracker.estimate(3200)?.running).toBe(true);
  });

  it("holds a flagless clock stopped when another clock proves it", () => {
    const tracker = new ClockTracker();
    tracker.update({ seconds: 12, resolution: 1 }, 0, "down");
    tracker.update({ seconds: 11, resolution: 1 }, 1000, "down");
    expect(tracker.estimate(1200)?.running).toBe(true);
    expect(tracker.estimate(1200, { heldStopped: true })?.running).toBe(false);
  });

  it("follows tenths and the switch from whole seconds to tenths", () => {
    const tracker = new ClockTracker();
    tracker.update({ seconds: 61, resolution: 1 }, 0, "down");
    tracker.update({ seconds: 60, resolution: 1 }, 1000, "down");
    tracker.update({ seconds: 59.9, resolution: 0.1 }, 1100, "down");
    expect(tracker.estimate(1100)).toMatchObject({ running: true, shown: 59.9, resolution: 0.1 });
    // Stappen van twee tienden (console die vijf keer per seconde stuurt) tellen ook als tikken.
    tracker.update({ seconds: 59.7, resolution: 0.1 }, 1300, "down");
    expect(tracker.estimate(1300)?.running).toBe(true);
  });

  it("counts up for sports whose clock counts up", () => {
    const tracker = new ClockTracker();
    tracker.update({ seconds: 10, resolution: 1, running: true }, 0, "up");
    tracker.update({ seconds: 11, resolution: 1, running: true }, 1000, "up");
    const estimate = tracker.estimate(1500);
    expect(estimate?.direction).toBe("up");
    expect(estimate?.value).toBeCloseTo(11.5, 3);
    expect(tracker.estimate(3000)?.value).toBeLessThan(12);
  });

  it("starts fresh after a reset", () => {
    const tracker = new ClockTracker();
    tracker.update({ seconds: 10, resolution: 1, running: true }, 0, "down");
    tracker.reset();
    expect(tracker.estimate(100)).toBeNull();
  });
});
