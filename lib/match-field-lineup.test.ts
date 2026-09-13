import { describe, expect, it } from "vitest";
import { applySubstitutionToFieldIds, defaultFieldFromRoster } from "./match-field-lineup";
import { squadOnFieldAndBench } from "./match-squad";

describe("veldopstelling en wissels", () => {
  it("vervangt de uit-speler op dezelfde rotatieplaats", () => {
    const field = ["a", "b", "c", "d", "e", "f"];
    expect(applySubstitutionToFieldIds(field, "c", "g")).toEqual(["a", "b", "g", "d", "e", "f"]);
  });

  it("wijzigt niets als de uit-speler niet op het veld staat", () => {
    const field = ["a", "b", "c"];
    expect(applySubstitutionToFieldIds(field, "z", "g")).toEqual(["a", "b", "c"]);
  });

  it("zet de eerste 6 niet-coaches op het veld bij volleybal", () => {
    const players = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i + 1}`,
      teamId: "t",
      number: i + 1,
      firstName: "A",
      lastName: "X",
      position: null,
      photoPath: null,
      isCoach: false,
      goalMediaId: null,
      goalVideoPath: null,
      subImagePath: null,
      lineupVideoPath: null,
    }));
    expect(defaultFieldFromRoster(players, 6)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    const { onField, bench } = squadOnFieldAndBench("t", players, undefined, 6);
    expect(onField.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(bench).toHaveLength(6);
  });
});
