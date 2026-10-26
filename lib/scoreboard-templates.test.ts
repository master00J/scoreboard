import { describe, expect, it } from "vitest";
import {
  applyTemplateToThemeJson,
  builtInTemplateRows,
  BUILT_IN_TEMPLATES,
  extractVisualTheme,
  sameVisualLayout,
  sanitizeTemplateThemeJson,
  templateMediaKind,
  themeFromExample,
} from "./scoreboard-templates";
import {
  mergeScoreboardTheme,
  reservedContentIsSixteenByNine,
  slotIsSixteenByNine,
  themeForFreeformEdit,
} from "./scoreboard-theme";

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

  it("behoudt scorebord-achtergronden bij een layoutwissel", () => {
    const current = JSON.stringify({
      leftBarWidthPx: 240,
      scoreboardBackgroundPath: "/uploads/board-default.webp",
      fullBackgroundPath: "D:/led/full.png",
      leftFrameBackgroundPath: "/uploads/l-bar.webp",
    });
    const template = JSON.stringify({ layoutMode: "left-l", leftBarWidthPx: 320 });
    const next = JSON.parse(applyTemplateToThemeJson(current, template));
    expect(next.layoutMode).toBe("left-l");
    expect(next.scoreboardBackgroundPath).toBe("/uploads/board-default.webp");
    expect(next.fullBackgroundPath).toBe("D:/led/full.png");
    expect(next.leftFrameBackgroundPath).toBe("/uploads/l-bar.webp");
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
      expect(theme.leftBarWidthPx).toBeGreaterThanOrEqual(180);
      expect(theme.leftBarWidthPx).toBeLessThanOrEqual(520);
      expect(theme.leftColumnOrder).toHaveLength(3);
    }
  });

  it("spannen echte layout-verschillen, niet alleen balkdikte", () => {
    const modes = new Set(builtInTemplateRows().map((row) => mergeScoreboardTheme(row.themeJson).layoutMode));
    expect(modes.has("custom")).toBe(true);
    expect(modes.has("left-l")).toBe(true);
    expect(modes.has("bottom-strip")).toBe(true);
    expect(modes.size).toBeGreaterThanOrEqual(3);
  });

  it("houdt video op 16:9: overlay-vak of gereserveerd contentvlak", () => {
    for (const row of builtInTemplateRows()) {
      const theme = mergeScoreboardTheme(row.themeJson);
      if (theme.layoutMode === "left-l") {
        expect(reservedContentIsSixteenByNine(theme.leftBarWidthPx, theme.bottomBarHeightPx)).toBe(true);
        expect(templateMediaKind(row.themeJson)).toBe("reserved");
      } else {
        expect(templateMediaKind(row.themeJson)).toBe("overlay");
        if (theme.layoutMode === "custom") {
          expect(slotIsSixteenByNine(theme.slots.sponsor)).toBe(true);
        }
      }
    }
  });

  it("hebben stabiele ids zodat updates niet dupliceren", () => {
    const a = builtInTemplateRows().map((r) => r.id);
    const b = builtInTemplateRows().map((r) => r.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    expect(a).toEqual([
      "builtin_standaard",
      "builtin_pro-league",
      "builtin_amateur",
      "builtin_beker",
      "builtin_minimal",
      "builtin_led-strip",
    ]);
  });
});

describe("sameVisualLayout", () => {
  it("ziet een compacte layout en dezelfde indeling voluit als gelijk", () => {
    const compact = sanitizeTemplateThemeJson(JSON.stringify({ scoreColor: "#ff0000" }));
    const full = JSON.stringify({
      ...mergeScoreboardTheme(JSON.stringify({ scoreColor: "#ff0000" })),
      layoutRules: [{ id: "r", sport: "*", phase: "play", templateId: "t" }],
      sponsorRepeatBudgetCycles: true,
    });
    expect(sameVisualLayout(compact, full)).toBe(true);
    expect(sameVisualLayout(null, "{}")).toBe(true);
    // De editor bewaart een auto-indeling met de vakken op de plek van de L-balk.
    expect(sameVisualLayout("{}", JSON.stringify(themeForFreeformEdit(mergeScoreboardTheme(null))))).toBe(true);
  });

  it("ziet een andere achtergrond of kleur als verschil", () => {
    expect(sameVisualLayout("{}", JSON.stringify({ fullBackgroundPath: "uploads/zaal.jpg" }))).toBe(false);
    expect(sameVisualLayout(JSON.stringify({ scoreColor: "#ff0000" }), JSON.stringify({ scoreColor: "#00ff00" }))).toBe(false);
  });
});

describe("themeFromExample", () => {
  const example = (key: string) => BUILT_IN_TEMPLATES.find((tpl) => tpl.key === key)!.theme;
  const club = themeForFreeformEdit(
    mergeScoreboardTheme(
      JSON.stringify({
        scoreColor: "#ffcc00",
        fontFamily: "Impact, sans-serif",
        scoreboardBackgroundPath: "uploads/zaal.jpg",
        layoutMode: "custom",
        elements: {
          sponsor: [
            { id: "sponsor", type: "media", x: 20, y: 0, w: 80, h: 80 },
            { id: "welkom", type: "text", text: "Welkom", x: 30, y: 85, w: 40, h: 10 },
          ],
          full: [{ id: "slogan", type: "text", text: "Hup", x: 40, y: 90, w: 20, h: 8 }],
        },
      }),
    ),
  );

  it("neemt de plaatsing over en houdt de vormgeving van de club", () => {
    const next = themeFromExample(club, example("standaard"));
    expect(next.layoutMode).toBe("custom");
    expect(next.slots.sponsor).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(next.elements.sponsor.find((e) => e.id === "sponsor")).toMatchObject({ x: 0, y: 0, w: 100, h: 100 });
    expect(next.scoreColor).toBe("#ffcc00");
    expect(next.fontFamily).toBe("Impact, sans-serif");
    expect(next.scoreboardBackgroundPath).toBe("uploads/zaal.jpg");
    expect(next.elements.full.some((e) => e.id === "slogan")).toBe(true);
  });

  it("legt eigen elementen bovenop de video", () => {
    const ids = themeFromExample(club, example("minimal")).elements.sponsor.map((e) => e.id);
    expect(ids.indexOf("welkom")).toBeGreaterThan(ids.indexOf("sponsor"));
  });

  it("zet een L-balkvoorbeeld in de L-vorm", () => {
    const next = themeFromExample(club, example("pro-league"));
    expect(next.layoutMode).toBe("left-l");
    expect(next.leftBarWidthPx).toBe(320);
  });
});

