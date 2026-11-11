import { describe, expect, it } from "vitest";
import { overlayEpisodeKey, safeRotationIndex } from "./display-guards";

describe("safeRotationIndex", () => {
  it("laat een geldige index staan", () => {
    expect(safeRotationIndex(0, 3)).toBe(0);
    expect(safeRotationIndex(2, 3)).toBe(2);
  });

  it("begint vooraan als de lijst korter werd dan de index", () => {
    // Rotatie stond op het laatste van drie items en er is er één verwijderd.
    expect(safeRotationIndex(2, 2)).toBe(0);
    expect(safeRotationIndex(5, 1)).toBe(0);
  });

  it("geeft 0 bij een lege lijst of onzinwaarden", () => {
    expect(safeRotationIndex(3, 0)).toBe(0);
    expect(safeRotationIndex(-1, 4)).toBe(0);
    expect(safeRotationIndex(Number.NaN, 4)).toBe(0);
    expect(safeRotationIndex(1.5, 4)).toBe(0);
  });
});

describe("overlayEpisodeKey", () => {
  const sub = {
    mode: "SUBSTITUTION",
    activeSubInId: "in-1",
    activeSubOutId: "out-1",
    updatedAt: "2026-11-08T14:00:00.000Z",
    timerRunning: false,
  };

  it("verandert niet door klok- of tijdstempelwijzigingen tijdens dezelfde overlay", () => {
    const later = { ...sub, updatedAt: "2026-11-08T14:00:03.000Z", timerRunning: true };
    expect(overlayEpisodeKey(later)).toBe(overlayEpisodeKey(sub));
  });

  it("verandert bij de volgende wissel uit de rij", () => {
    expect(overlayEpisodeKey({ ...sub, activeSubInId: "in-2", activeSubOutId: "out-2" })).not.toBe(
      overlayEpisodeKey(sub),
    );
  });

  it("verandert bij een andere modus, speler, kaartkleur of clip", () => {
    const card = { mode: "CARD", activePlayerId: "p1", activeCardColor: "YELLOW" };
    const base = overlayEpisodeKey(card);
    expect(overlayEpisodeKey({ ...card, mode: "GOAL" })).not.toBe(base);
    expect(overlayEpisodeKey({ ...card, activePlayerId: "p2" })).not.toBe(base);
    expect(overlayEpisodeKey({ ...card, activeCardColor: "RED" })).not.toBe(base);
    expect(overlayEpisodeKey({ ...card, activeMediaId: "m1" })).not.toBe(base);
  });

  it("verandert bij een tweede goal van dezelfde ploeg zonder gekozen scorer", () => {
    const goal = { mode: "GOAL", activeGoalScorerId: null };
    expect(overlayEpisodeKey(goal, { home: 2, away: 0 })).not.toBe(overlayEpisodeKey(goal, { home: 1, away: 0 }));
  });

  it("is leeg zonder stand", () => {
    expect(overlayEpisodeKey(null)).toBe("");
    expect(overlayEpisodeKey(undefined)).toBe("");
  });
});
