import { describe, expect, it } from "vitest";
import { mergeScoreboardTheme } from "../scoreboard-theme";
import { normalizeElementStyle, taperClipPath } from "../scoreboard-elements";
import { RAFC_RED, RAFC_SCOREBOARD_THEME } from "./rafc-template";
import { clubBrandAsset } from "./assets";

describe("RAFC-indeling als gewone elementen", () => {
  const theme = mergeScoreboardTheme(JSON.stringify(RAFC_SCOREBOARD_THEME));

  it("blijft na het inlezen een vrije indeling met hun lettertype, zonder schaduw en met brede klokcijfers", () => {
    expect(theme.layoutMode).toBe("custom");
    expect(theme.fontFamily).toContain("Zalando Sans Expanded");
    expect(theme.textShadows).toBe(false);
    expect(theme.clockDigitEm).toBe(0.9);
    expect(theme.plainDigits).toBe(true);
    expect(theme.fullShowPeriod).toBe(false);
  });

  it("houdt de vlakken, de stand, het competitielogo en de klassieke vakken", () => {
    const full = theme.elements.full;
    const byId = new Map(full.map((e) => [e.id, e]));
    expect(byId.get("rafc-bg")).toMatchObject({ type: "shape", x: 0, y: 0, w: 100, h: 100, style: { background: RAFC_RED } });
    expect(byId.get("rafc-league-tab")?.style?.taper).toBe(6.6);
    expect(byId.get("rafc-clock-tab")?.style?.taper).toBe(-6.1);
    expect(byId.get("rafc-league-logo")).toMatchObject({ type: "image", src: "brand:league" });
    expect(byId.get("rafc-score")?.type).toBe("scoreLine");
    for (const id of ["home", "away", "homeScore", "awayScore", "clock", "shotClock"]) expect(byId.has(id)).toBe(true);
    expect(byId.get("homeScore")?.hidden).toBe(true);
    // Het rode vlak ligt onderaan.
    expect(full[0]?.id).toBe("rafc-bg");
    const sponsor = new Map(theme.elements.sponsor.map((e) => [e.id, e]));
    expect(sponsor.get("sponsor")).toMatchObject({ x: 0, y: 0, w: 80, h: 80 });
    // Zijbalk vult de rest van de breedte naast de 16:9-clip, zonder zwarte rand.
    expect(sponsor.get("rafc-side")).toMatchObject({ type: "shape", x: 80, y: 0, w: 20, h: 80 });
    expect(sponsor.get("rafc-side-crest")).toMatchObject({ type: "image", src: "brand:crest" });
    expect(sponsor.get("rafc-bar")).toMatchObject({ y: 80, h: 20 });
  });

  it("leest het competitielogo uit de app", () => {
    expect(clubBrandAsset("brand:league")).toMatch(/^data:image\/svg\+xml/);
    expect(clubBrandAsset("brand:crest")).toMatch(/^data:image\/svg\+xml/);
    expect(clubBrandAsset("brand:onbekend")).toBe("");
  });
});

describe("schuine vlakken", () => {
  it("bewaart een schuinte binnen de grenzen en laat recht weg", () => {
    expect(normalizeElementStyle({ taper: 6.64 })).toEqual({ taper: 6.6 });
    expect(normalizeElementStyle({ taper: -80 })).toEqual({ taper: -45 });
    expect(normalizeElementStyle({ taper: 0 })).toBeUndefined();
  });

  it("tekent een trapezium dat onderaan of bovenaan smaller is", () => {
    expect(taperClipPath(10)).toBe("polygon(0% 0%, 100% 0%, 90% 100%, 10% 100%)");
    expect(taperClipPath(-10)).toBe("polygon(10% 0%, 90% 0%, 100% 100%, 0% 100%)");
  });

  it("verandert niets aan een bestaande indeling zonder de nieuwe opties", () => {
    const plain = mergeScoreboardTheme(null);
    expect(plain.textShadows).toBe(true);
    expect(plain.clockDigitEm).toBe(0.65);
  });
});
