import { describe, expect, it } from "vitest";
import {
  applyTemplateToThemeJson,
  builtInTemplateRows,
  extractVisualTheme,
  sanitizeTemplateThemeJson,
} from "./scoreboard-templates";
import { mergeScoreboardTheme } from "./scoreboard-theme";

describe("layout-templates bevatten alleen vormgeving", () => {
  it("laat afspeelinstellingen buiten de template", () => {
    const current = JSON.stringify({
      leftBarWidthPx: 320,
      sponsorRepeatBudgetCycles: true,
    });
    const visual = extractVisualTheme(current);
    expect(visual).toHaveProperty("leftBarWidthPx", 320);
    expect(visual).not.toHaveProperty("sponsorRepeatBudgetCycles");
  });

  it("behoudt sponsorgedrag bij het toepassen van een andere layout", () => {
    // De operator heeft doorlopende sponsorcycli aanstaan…
    const current = JSON.stringify({ leftBarWidthPx: 240, sponsorRepeatBudgetCycles: true });
    // …en kiest een layout die daar niets over zegt.
    const template = JSON.stringify({ leftBarWidthPx: 320, fullScorePx: 210 });

    const next = JSON.parse(applyTemplateToThemeJson(current, template));

    expect(next.leftBarWidthPx).toBe(320);
    expect(next.fullScorePx).toBe(210);
    // Regressie: een layoutwissel mag de sponsorrotatie niet stilletjes veranderen.
    expect(next.sponsorRepeatBudgetCycles).toBe(true);
  });

  it("een template kan afspeelgedrag niet injecteren", () => {
    const current = JSON.stringify({ sponsorRepeatBudgetCycles: false });
    const kwaadaardig = JSON.stringify({ leftBarWidthPx: 300, sponsorRepeatBudgetCycles: true });
    const next = JSON.parse(applyTemplateToThemeJson(current, kwaadaardig));
    expect(next.sponsorRepeatBudgetCycles).toBe(false);
  });

  it("sanitize bewaart alleen bekende thema-keys", () => {
    const raw = JSON.stringify({ leftBarWidthPx: 300, onzin: 42, sponsorRepeatBudgetCycles: true });
    const clean = JSON.parse(sanitizeTemplateThemeJson(raw));
    expect(clean).toEqual({ leftBarWidthPx: 300 });
  });

  it("gaat om met ongeldige JSON", () => {
    expect(extractVisualTheme("niet-json")).toEqual({});
    expect(extractVisualTheme(null)).toEqual({});
    expect(JSON.parse(applyTemplateToThemeJson(null, "{}"))).toEqual({});
  });
});

describe("meegeleverde layouts", () => {
  it("leveren allemaal een geldig thema op", () => {
    const rows = builtInTemplateRows();
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows) {
      expect(row.isBuiltIn).toBe(true);
      const theme = mergeScoreboardTheme(row.themeJson);
      // mergeScoreboardTheme clampt; waarden moeten binnen de grenzen vallen.
      expect(theme.leftBarWidthPx).toBeGreaterThanOrEqual(180);
      expect(theme.leftBarWidthPx).toBeLessThanOrEqual(520);
      expect(theme.leftColumnOrder).toHaveLength(3);
    }
  });

  it("hebben stabiele ids zodat updates niet dupliceren", () => {
    const a = builtInTemplateRows().map((r) => r.id);
    const b = builtInTemplateRows().map((r) => r.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});
