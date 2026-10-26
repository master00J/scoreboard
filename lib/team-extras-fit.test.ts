import { describe, expect, it } from "vitest";
import { teamExtrasFitCqw, teamExtrasPartFitPx, teamExtrasWidthEm } from "./team-extras-fit";

describe("regel onder de score", () => {
  it("rekent het SERVE-label breder dan gewone tekst", () => {
    const plain = teamExtrasWidthEm([{ text: "Serve" }]);
    expect(teamExtrasWidthEm([{ text: "Serve", badge: true }])).toBeGreaterThan(plain);
  });

  it("geeft een kleinere letter als de regel langer is", () => {
    const away = teamExtrasFitCqw([{ text: "Sets 0" }, { text: "TO 0/2" }], 84)!;
    const home = teamExtrasFitCqw([{ text: "Serve", badge: true }, { text: "Sets 0" }, { text: "TO 0/2" }], 84)!;
    expect(home).toBeLessThan(away);
    // Zonder SERVE blijft de oude grens van 8cqw de kleinste: daar verandert niets.
    expect(away).toBeGreaterThan(8);
  });

  it("houdt in een smalle balk elk onderdeel binnen de breedte", () => {
    const parts = [{ text: "Serve", badge: true }, { text: "Sets 0" }, { text: "TO 0/2" }];
    expect(teamExtrasPartFitPx(parts, 272, 29)).toBe(29);
    expect(teamExtrasPartFitPx(parts, 120, 29)).toBeLessThan(29);
  });

  it("geeft niets als er geen regel is", () => {
    expect(teamExtrasFitCqw([], 84)).toBeNull();
  });
});
