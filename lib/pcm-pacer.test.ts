import { describe, expect, it } from "vitest";
import { createPcmPacer } from "./pcm-pacer";

const RATE = 48000;

describe("createPcmPacer", () => {
  it("levert zonder geluid precies het tempo van de klok", () => {
    const pacer = createPcmPacer({ sampleRate: RATE, startMs: 0 });
    // Een tik om de 40 ms, tien seconden lang: vroeger kwam hier maar de helft van de frames uit.
    let total = 0;
    for (let t = 40; t <= 10_000; t += 40) total += pacer.fill(t);
    expect(total).toBe(RATE * 10);
  });

  it("blijft op tempo als de tikken ongelijk vallen", () => {
    const pacer = createPcmPacer({ sampleRate: RATE, startMs: 1000 });
    let total = 0;
    for (const t of [1037, 1081, 1250, 1251, 1900, 2000]) total += pacer.fill(t);
    expect(total).toBe(RATE);
  });

  it("vult niet bij zolang echt geluid binnen de speling blijft", () => {
    const pacer = createPcmPacer({ sampleRate: RATE, startMs: 0 });
    // Blokken van 2048 frames (42,7 ms) komen op tempo binnen; de speling is 250 ms.
    let silence = 0;
    let audio = 0;
    for (let t = 40; t <= 5_000; t += 40) {
      silence += pacer.fill(t, 250);
      while ((audio + 2048) * 1000 <= t * RATE) audio += pacer.admit(t, 2048);
    }
    expect(silence).toBe(0);
    expect(audio).toBeGreaterThan(RATE * 4.9);
  });

  it("vult wel bij als de bron stilvalt", () => {
    const pacer = createPcmPacer({ sampleRate: RATE, startMs: 0 });
    expect(pacer.admit(100, 4800)).toBe(4800);
    expect(pacer.fill(200, 250)).toBe(0);
    // 400 ms geen geluid: de achterstand is groter dan de speling en wordt in één keer ingehaald.
    expect(pacer.fill(500, 250)).toBe(RATE / 2 - 4800);
    expect(pacer.written()).toBe(RATE / 2);
  });

  it("laat geluid dat te ver voor zou lopen vallen", () => {
    const pacer = createPcmPacer({ sampleRate: RATE, startMs: 0, maxLeadMs: 250 });
    // Op 1 s staat er 1 s stilte; daarna komt er in één klap 1 s opgespaard geluid.
    expect(pacer.fill(1000)).toBe(RATE);
    expect(pacer.admit(1000, RATE)).toBe(RATE / 4);
    expect(pacer.admit(1000, 2048)).toBe(0);
    // Zodra de klok is bijgekomen, mag er weer geluid bij.
    expect(pacer.admit(1100, 2048)).toBe(2048);
  });

  it("verdeelt een lange achterstand over meerdere aanroepen", () => {
    const pacer = createPcmPacer({ sampleRate: RATE, startMs: 0, maxFillMs: 2000 });
    expect(pacer.fill(5000)).toBe(RATE * 2);
    expect(pacer.fill(5000)).toBe(RATE * 2);
    expect(pacer.fill(5000)).toBe(RATE);
    expect(pacer.fill(5000)).toBe(0);
  });

  it("geeft nooit een negatief aantal", () => {
    const pacer = createPcmPacer({ sampleRate: RATE, startMs: 1000 });
    expect(pacer.fill(500)).toBe(0);
    expect(pacer.admit(500, -10)).toBe(0);
  });
});
