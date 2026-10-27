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

  it("stuurt een vers beeld meteen, ook net vóór zijn beurt, en herhaalt alleen bij een gat", () => {
    const clock = new FrameClock(30);
    // Schilderen op 30 Hz met wat speling; de timer tikt grof (zoals op Windows).
    const paints = Array.from({ length: 300 }, (_, i) => i * (1000 / 30) + ((i * 7) % 11) - 5);
    let repeats = 0;
    let fresh = 0;
    let overwritten = 0;
    let pending = false;
    let next = 0;
    // Zoals de pomp: een vers beeld wacht als "laatste beeld" tot het mag; een nieuwer overschrijft het.
    const pump = (now: number) => {
      while (true) {
        if (!clock.started) {
          if (!pending) return;
          clock.start(now);
        }
        if (!clock.shouldSend(now, pending)) return;
        clock.markSent();
        if (pending) {
          fresh++;
          pending = false;
        } else {
          repeats++;
        }
      }
    };
    for (let now = 0; now <= 10_000; now += 1) {
      while (next < paints.length && paints[next] <= now) {
        next++;
        if (pending) overwritten++;
        pending = true;
        pump(now);
      }
      if (now % 16 === 0) pump(now);
    }
    // Vrijwel elk geschilderd beeld komt in de stream; de klok hoeft bijna niets te herhalen.
    expect(fresh).toBeGreaterThanOrEqual(295);
    expect(overwritten).toBeLessThanOrEqual(5);
    expect(repeats).toBeLessThanOrEqual(5);
  });

  it("loopt hooguit één beeldje voor op de klok", () => {
    const clock = new FrameClock(30);
    clock.start(0);
    let sent = 0;
    while (clock.shouldSend(0, true)) {
      clock.markSent();
      sent++;
    }
    expect(sent).toBe(2);
  });

  it("start maar één keer", () => {
    const clock = new FrameClock(25);
    clock.start(100);
    clock.start(5_000);
    expect(clock.due(100)).toBe(1);
  });
});
