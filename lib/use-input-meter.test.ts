import { describe, expect, it } from "vitest";
import { meterFillPercent } from "./use-input-meter";

describe("meterFillPercent", () => {
  it("blijft 0 bij stilte", () => {
    expect(meterFillPercent(0)).toBe(0);
    expect(meterFillPercent(0.0001)).toBe(0);
  });

  it("gaat richting 100 bij voller signaal", () => {
    expect(meterFillPercent(0.05)).toBeGreaterThan(10);
    expect(meterFillPercent(1)).toBe(100);
  });
});
