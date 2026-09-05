import { describe, expect, it } from "vitest";
import {
  autoLeftLatchApplies,
  resolveAutoLeftLayout,
  type AutoLeftLatch,
} from "./auto-left-layout-latch";

function ref(): { current: AutoLeftLatch | null } {
  return { current: null };
}

describe("autoLeftLatchApplies", () => {
  it("geldt tijdens het spel, niet daarbuiten", () => {
    expect(autoLeftLatchApplies("FIRST_HALF")).toBe(true);
    expect(autoLeftLatchApplies("SECOND_HALF")).toBe(true);
    expect(autoLeftLatchApplies("EXTRA_TIME")).toBe(true);
    expect(autoLeftLatchApplies("HALF_TIME")).toBe(false);
    expect(autoLeftLatchApplies("PREMATCH")).toBe(false);
    expect(autoLeftLatchApplies(undefined)).toBe(false);
  });
});

describe("resolveAutoLeftLayout", () => {
  it("laat het L-frame los als er geen clip meer naast hoort", () => {
    const r = ref();
    expect(resolveAutoLeftLayout(r, "m1", "FIRST_HALF", true)).toBe(true);
    expect(resolveAutoLeftLayout(r, "m1", "FIRST_HALF", false)).toBe(false);
    expect(resolveAutoLeftLayout(r, "m1", "FIRST_HALF", false)).toBe(false);
  });

  it("gaat naar L-frame zodra er weer media is", () => {
    const r = ref();
    expect(resolveAutoLeftLayout(r, "m1", "FIRST_HALF", false)).toBe(false);
    expect(resolveAutoLeftLayout(r, "m1", "FIRST_HALF", true)).toBe(true);
    expect(resolveAutoLeftLayout(r, "m1", "FIRST_HALF", false)).toBe(false);
  });

  it("reset bij een nieuwe fase", () => {
    const r = ref();
    resolveAutoLeftLayout(r, "m1", "FIRST_HALF", true);
    // Rust valt buiten de latch: raw wint weer.
    expect(resolveAutoLeftLayout(r, "m1", "HALF_TIME", false)).toBe(false);
    expect(r.current).toBeNull();
    // Tweede helft begint schoon.
    expect(resolveAutoLeftLayout(r, "m1", "SECOND_HALF", false)).toBe(false);
  });

  it("reset bij een andere wedstrijd", () => {
    const r = ref();
    resolveAutoLeftLayout(r, "m1", "FIRST_HALF", true);
    expect(resolveAutoLeftLayout(r, "m2", "FIRST_HALF", false)).toBe(false);
  });

  it("laat fases buiten het spel ongemoeid", () => {
    const r = ref();
    expect(resolveAutoLeftLayout(r, "m1", "PREMATCH", true)).toBe(true);
    expect(resolveAutoLeftLayout(r, "m1", "PREMATCH", false)).toBe(false);
  });
});
