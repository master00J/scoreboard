import { describe, expect, it } from "vitest";
import { fitScale } from "./fit-scale";

describe("tekst binnen het vak houden", () => {
  it("laat tekst die past ongemoeid", () => {
    expect(fitScale({ width: 300, height: 100 }, { width: 400, height: 200 })).toBe(1);
    expect(fitScale({ width: 400, height: 200 }, { width: 400, height: 200 })).toBe(1);
  });

  it("krimpt te brede tekst tot hij met wat marge past (zoals 0-13 in het brede clublettertype)", () => {
    const scale = fitScale({ width: 1000, height: 300 }, { width: 820, height: 580 });
    expect(scale).toBeLessThan(0.82);
    expect(1000 * scale).toBeLessThanOrEqual(820);
    expect(1000 * scale).toBeGreaterThan(820 * 0.9);
  });

  it("rekent de vergroting van het vak mee", () => {
    // Past zonder vergroting, maar met 1.53 niet meer.
    expect(fitScale({ width: 200, height: 100 }, { width: 240, height: 216 })).toBe(1);
    const scale = fitScale({ width: 200, height: 100 }, { width: 240, height: 216 }, 1.53);
    expect(200 * 1.53 * scale).toBeLessThanOrEqual(240);
  });

  it("krimpt ook te hoge tekst", () => {
    expect(fitScale({ width: 100, height: 300 }, { width: 400, height: 200 })).toBeLessThan(0.67);
  });

  it("doet niets zolang er nog niets gemeten is", () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 400, height: 200 })).toBe(1);
    expect(fitScale({ width: 100, height: 50 }, { width: 0, height: 0 })).toBe(1);
  });
});
