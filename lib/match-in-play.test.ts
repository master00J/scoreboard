import { describe, expect, it } from "vitest";
import { isMatchInPlay } from "./match-in-play";

describe("isMatchInPlay", () => {
  it("is bezig van voorbeschouwing tot en met verlenging", () => {
    for (const status of ["PREMATCH", "FIRST_HALF", "HALF_TIME", "SECOND_HALF", "EXTRA_TIME"]) {
      expect(isMatchInPlay({ status, closedAt: null }), status).toBe(true);
    }
  });

  it("is niet bezig zonder wedstrijd, bij instellen, na afloop of na afsluiten", () => {
    expect(isMatchInPlay(null)).toBe(false);
    expect(isMatchInPlay(undefined)).toBe(false);
    for (const status of ["SETUP", "FULL_TIME", "POST_MATCH"]) {
      expect(isMatchInPlay({ status, closedAt: null }), status).toBe(false);
    }
    expect(isMatchInPlay({ status: "SECOND_HALF", closedAt: "2026-10-03T20:00:00.000Z" })).toBe(false);
  });

  it("telt een onbekende fase als bezig", () => {
    expect(isMatchInPlay({ status: "QUARTER_3" })).toBe(true);
  });
});
