import { describe, expect, it } from "vitest";
import {
  billableVisibleSec,
  createVisiblePlayClock,
  markVisiblePlayShown,
  observeVisiblePlayPosition,
  presentSeconds,
  setVisiblePlayPaused,
  visiblePlaySec,
} from "./visible-play-clock";

/** Speelt een video af: positie per tick, zoals timeupdate dat ~4× per seconde meldt. */
function playVideo(
  clock: ReturnType<typeof createVisiblePlayClock>,
  fromMs: number,
  toMs: number,
  positionAt: (ms: number) => number,
) {
  for (let t = fromMs; t <= toMs; t += 250) observeVisiblePlayPosition(clock, positionAt(t), t);
}

describe("visible play clock: images", () => {
  it("telt niets zolang de foto niet geladen is", () => {
    const clock = createVisiblePlayClock("IMAGE");
    expect(billableVisibleSec(clock, 10_000)).toBe(0);
  });

  it("start bij het tonen, niet bij het kiezen", () => {
    const clock = createVisiblePlayClock("IMAGE");
    // Gekozen op t=0, pas op 1,5 s gedecodeerd.
    markVisiblePlayShown(clock, 1_500);
    expect(visiblePlaySec(clock, 10_000)).toBeCloseTo(8.5);
  });

  it("telt een onderbreking niet mee", () => {
    const clock = createVisiblePlayClock("IMAGE");
    markVisiblePlayShown(clock, 0);
    setVisiblePlayPaused(clock, true, 2_000);
    setVisiblePlayPaused(clock, false, 8_000);
    expect(visiblePlaySec(clock, 10_000)).toBeCloseTo(4);
  });

  it("een foto die tijdens een onderbreking laadt, telt pas na de onderbreking", () => {
    const clock = createVisiblePlayClock("IMAGE", true);
    markVisiblePlayShown(clock, 1_000);
    setVisiblePlayPaused(clock, false, 5_000);
    expect(visiblePlaySec(clock, 7_000)).toBeCloseTo(2);
  });
});

describe("visible play clock: videos", () => {
  it("boekt een vastgelopen speelkop niet als volledige clip (audit: 1,21 s van 8 s)", () => {
    const clock = createVisiblePlayClock("VIDEO");
    markVisiblePlayShown(clock, 0, 0);
    // Speelt tot 1,21 s en blijft daar hangen tot de eindtimer na 8 s vuurt.
    playVideo(clock, 0, 8_000, (ms) => Math.min(1.21, ms / 1000));
    expect(billableVisibleSec(clock, 8_000)).toBeCloseTo(1.21, 2);
  });

  it("boekt een normaal afgespeelde clip volledig", () => {
    const clock = createVisiblePlayClock("VIDEO");
    markVisiblePlayShown(clock, 0, 0);
    playVideo(clock, 0, 8_000, (ms) => ms / 1000);
    expect(billableVisibleSec(clock, 8_000)).toBeCloseTo(8, 1);
  });

  it("telt niets voor het eerste getekende frame", () => {
    const clock = createVisiblePlayClock("VIDEO");
    playVideo(clock, 0, 2_000, (ms) => ms / 1000);
    expect(billableVisibleSec(clock, 2_000)).toBe(0);
    markVisiblePlayShown(clock, 2_000, 2);
    playVideo(clock, 2_000, 5_000, (ms) => ms / 1000);
    expect(billableVisibleSec(clock, 5_000)).toBeCloseTo(3, 1);
  });

  it("een seek vooruit telt hoogstens de verstreken tijd", () => {
    const clock = createVisiblePlayClock("VIDEO");
    markVisiblePlayShown(clock, 0, 0);
    observeVisiblePlayPosition(clock, 1, 1_000);
    // In 250 ms van 1 s naar 20 s gesprongen.
    observeVisiblePlayPosition(clock, 20, 1_250);
    expect(billableVisibleSec(clock, 1_250)).toBeLessThan(1.7);
  });

  it("een lus telt opnieuw vanaf het begin", () => {
    const clock = createVisiblePlayClock("VIDEO");
    markVisiblePlayShown(clock, 0, 0);
    playVideo(clock, 0, 4_000, (ms) => (ms / 1000) % 3);
    expect(billableVisibleSec(clock, 4_000)).toBeGreaterThan(3.4);
    expect(billableVisibleSec(clock, 4_000)).toBeLessThanOrEqual(4.01);
  });

  it("telt de vooruitgang tijdens een onderbreking niet", () => {
    const clock = createVisiblePlayClock("VIDEO");
    markVisiblePlayShown(clock, 0, 0);
    playVideo(clock, 0, 2_000, (ms) => ms / 1000);
    setVisiblePlayPaused(clock, true, 2_000);
    // Goal-overlay erboven: de video loopt eronder door.
    playVideo(clock, 2_250, 6_000, (ms) => ms / 1000);
    setVisiblePlayPaused(clock, false, 6_000);
    playVideo(clock, 6_000, 8_000, (ms) => ms / 1000);
    expect(billableVisibleSec(clock, 8_000)).toBeCloseTo(4, 1);
  });

  it("een clip die later een fout geeft, houdt zijn geldige deel", () => {
    const clock = createVisiblePlayClock("VIDEO");
    markVisiblePlayShown(clock, 0, 0);
    playVideo(clock, 0, 5_000, (ms) => ms / 1000);
    // Decoderfout op 5 s: geboekt wordt wat er tot dan zichtbaar was.
    expect(billableVisibleSec(clock, 9_000)).toBeCloseTo(5, 1);
  });
});

describe("presentSeconds", () => {
  it("rondt pas af bij tonen: losse fragmenten van 0,6 s tellen samen, niet elk als 1 s", () => {
    const fragments = [0.6, 0.6, 0.6, 0.6, 0.6];
    const total = fragments.reduce((a, b) => a + b, 0);
    expect(presentSeconds(total)).toBe(3);
    expect(fragments.map(presentSeconds).reduce((a, b) => a + b, 0)).toBe(5);
  });
});
