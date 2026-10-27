import { describe, expect, it } from "vitest";
import { FrameClock } from "./frame-clock";

describe("vast beeldritme voor de livestream", () => {
  it("vraagt niets zolang er nog geen beeld verstuurd is", () => {
    const clock = new FrameClock(30);
    expect(clock.started).toBe(false);
    expect(clock.behind(1_000)).toBe(0);
  });

  it("volgt de klok: na 1 s precies 30 beeldjes, ook als de app onregelmatig schildert", () => {
    const clock = new FrameClock(30);
    clock.start(0);
    // Onregelmatige schildermomenten: soms twee kort na elkaar, soms een gat van 120 ms.
    for (const now of [0, 10, 12, 140, 150, 400, 401, 402, 700, 999]) {
      while (clock.behind(now) > 0) clock.markSent();
    }
    expect(clock.framesSent).toBe(30);
  });

  it("haalt een achterstand in met herhaalde beeldjes in plaats van ze weg te gooien", () => {
    const clock = new FrameClock(30);
    clock.start(0);
    clock.markSent();
    // De hoofddraad hing een halve seconde: 15 beeldjes achter, die moeten er allemaal nog in.
    expect(clock.behind(500)).toBe(15);
    while (clock.behind(500) > 0) clock.markSent();
    expect(clock.framesSent).toBe(16);
    expect(clock.behind(500)).toBe(0);
  });

  it("blijft na een uur gelijk met de klok (geen afronding die oploopt)", () => {
    const clock = new FrameClock(30);
    clock.start(1_000);
    const hour = 3_600_000;
    for (let t = 1_000; t <= 1_000 + hour; t += 17) {
      while (clock.behind(t) > 0) clock.markSent();
    }
    while (clock.behind(1_000 + hour) > 0) clock.markSent();
    expect(clock.framesSent).toBe(clock.due(1_000 + hour));
    expect(Math.abs(clock.framesSent - 30 * 3_600)).toBeLessThanOrEqual(1);
  });

  it("start maar één keer", () => {
    const clock = new FrameClock(25);
    clock.start(100);
    clock.start(5_000);
    expect(clock.due(100)).toBe(1);
  });
});
