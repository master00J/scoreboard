import { describe, expect, it } from "vitest";
import { shownCardColor } from "./card-display";

describe("kaart op het stadionscherm", () => {
  it("toont een eerste gele of rode kaart zoals gegeven", () => {
    expect(shownCardColor("YELLOW", 0)).toBe("YELLOW");
    expect(shownCardColor("RED", 0)).toBe("RED");
    expect(shownCardColor("GREEN", 2)).toBe("GREEN");
  });

  it("toont geel en rood samen bij een tweede gele kaart", () => {
    expect(shownCardColor("YELLOW", 1)).toBe("YELLOW_RED");
    expect(shownCardColor("RED", 1)).toBe("YELLOW_RED");
  });

  it("toont geel en rood samen als de operator tweede gele kaart aanvinkte", () => {
    expect(shownCardColor("YELLOW", 0, true)).toBe("YELLOW_RED");
    expect(shownCardColor("RED", 0, true)).toBe("YELLOW_RED");
    expect(shownCardColor("GREEN", 0, true)).toBe("GREEN");
  });
});
