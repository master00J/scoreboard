import { describe, expect, it } from "vitest";
import { buildRecurringCueTimes } from "./scheduled-media-recurrence";

describe("scheduled media recurrence", () => {
  it("creates an inclusive series on the match clock", () => {
    expect(buildRecurringCueTimes(10 * 60, 40 * 60, 5)).toEqual([
      600, 900, 1200, 1500, 1800, 2100, 2400,
    ]);
  });

  it("rejects invalid ranges and intervals below thirty seconds", () => {
    expect(buildRecurringCueTimes(600, 300, 5)).toEqual([]);
    expect(buildRecurringCueTimes(0, 600, 0.25)).toEqual([]);
  });

  it("caps accidentally large series", () => {
    expect(buildRecurringCueTimes(0, 10_000, 0.5, 3)).toEqual([0, 30, 60]);
  });
});
