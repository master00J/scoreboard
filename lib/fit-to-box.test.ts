import { describe, expect, it } from "vitest";
import { FIT_MIN_SCALE, fitScale, fitsWithinBox } from "./fit-to-box";

describe("passend maken", () => {
  it("laat inhoud die past met rust", () => {
    expect(fitScale(100, 200)).toBe(1);
    expect(fitScale(200, 200)).toBe(1);
  });

  it("verkleint precies genoeg", () => {
    expect(fitScale(400, 200)).toBe(0.5);
    expect(fitScale(250, 200)).toBe(0.8);
  });

  it("stopt bij de ondergrens in plaats van onleesbaar te worden", () => {
    // Een vak van 15% breed met een lange regel erin: liever klein dan afgekapt, maar niet
    // oneindig klein — dan is het vak gewoon te smal en moet de club dat zien.
    expect(fitScale(10_000, 100)).toBe(FIT_MIN_SCALE);
  });

  it("raakt niet in de war van onmogelijke metingen", () => {
    for (const [n, a] of [[0, 100], [100, 0], [NaN, 100], [100, Infinity]] as const) {
      expect(fitScale(n, a)).toBe(1);
    }
  });

  it("zegt wanneer een vak echt te klein is", () => {
    expect(fitsWithinBox(100, 200)).toBe(true);
    expect(fitsWithinBox(300, 200)).toBe(true); // verkleind past het nog
    expect(fitsWithinBox(10_000, 100)).toBe(false);
  });
});
