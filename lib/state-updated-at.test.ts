import { describe, expect, it } from "vitest";
import { nextStateUpdatedAt } from "./state-updated-at";

describe("nextStateUpdatedAt", () => {
  it("neemt de systeemklok als die verder staat dan de vorige stempel", () => {
    const prev = new Date("2026-11-08T14:00:00.000Z");
    const now = Date.parse("2026-11-08T14:00:05.000Z");
    expect(nextStateUpdatedAt(prev, now).getTime()).toBe(now);
  });

  it("blijft oplopen als de systeemklok terugspringt", () => {
    const prev = new Date("2026-11-08T14:00:00.000Z");
    const jumpedBack = Date.parse("2026-11-08T13:00:00.000Z");
    const first = nextStateUpdatedAt(prev, jumpedBack);
    expect(first.getTime()).toBe(prev.getTime() + 1);
    const second = nextStateUpdatedAt(first, jumpedBack + 250);
    expect(second.getTime()).toBe(prev.getTime() + 2);
  });

  it("loopt ook op bij twee schrijfacties in dezelfde milliseconde", () => {
    const prev = new Date(1_000);
    expect(nextStateUpdatedAt(prev, 1_000).getTime()).toBe(1_001);
  });

  it("valt terug op de systeemklok zonder vorige stempel", () => {
    expect(nextStateUpdatedAt(null, 5_000).getTime()).toBe(5_000);
    expect(nextStateUpdatedAt(undefined, 5_000).getTime()).toBe(5_000);
    expect(nextStateUpdatedAt(new Date(Number.NaN), 5_000).getTime()).toBe(5_000);
  });
});
