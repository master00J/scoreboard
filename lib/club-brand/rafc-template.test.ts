import { describe, expect, it } from "vitest";
import { mergeScoreboardTheme } from "../scoreboard-theme";
import { mediaClipSpan, normalizeElementStyle, setMediaFit, taperClipPath } from "../scoreboard-elements";
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
    // Videovak over de volle breedte: clip als 16:9 links, de rest rood (geen zwarte rand).
    expect(sponsor.get("sponsor")).toMatchObject({
      x: 0,
      y: 0,
      w: 100,
      h: 80,
      style: { background: RAFC_RED, mediaFit: "left" },
    });
    // Klok staat in het midden van de clip (80% breed), niet van het scherm.
    const clip = mediaClipSpan(sponsor.get("sponsor")!, "left", 16 / 9);
    expect(clip.width).toBeCloseTo(80, 1);
    const clock = sponsor.get("clock")!;
    expect(clock.x + clock.w / 2).toBeCloseTo(clip.left + clip.width / 2, 0);
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

  it("bewaart links, midden of rechts voor de clip in het videovak en negeert de rest", () => {
    expect(normalizeElementStyle({ mediaFit: "right" })).toEqual({ mediaFit: "right" });
    expect(normalizeElementStyle({ mediaFit: "center" })).toEqual({ mediaFit: "center" });
    expect(normalizeElementStyle({ mediaFit: "boven" })).toBeUndefined();
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

describe("clip links of rechts in het videovak", () => {
  const theme = mergeScoreboardTheme(JSON.stringify(RAFC_SCOREBOARD_THEME));
  const sponsor = theme.elements.sponsor;

  it("schuift score, klok en logo's mee met de clip, maar laat de balk over de hele breedte staan", () => {
    const moved = new Map(setMediaFit(sponsor, "sponsor", "right", 16 / 9).map((e) => [e.id, e]));
    const before = new Map(sponsor.map((e) => [e.id, e]));
    expect(moved.get("sponsor")?.style?.mediaFit).toBe("right");
    expect(moved.get("sponsor")?.style?.background).toBe(RAFC_RED);
    for (const id of ["clock", "home", "away", "homeScore", "awayScore", "rafc-clock-tab"]) {
      expect(moved.get(id)!.x).toBeCloseTo(before.get(id)!.x + 20, 1);
    }
    expect(moved.get("rafc-bar")!.x).toBe(0);
    // Terug naar links zet alles weer op de oude plek.
    const back = setMediaFit([...moved.values()], "sponsor", "left", 16 / 9);
    expect(back.map((e) => [e.id, e.x])).toEqual(sponsor.map((e) => [e.id, e.x]));
  });

  it("schuift niets van of naar vullen en haalt de keuze weg bij vullen", () => {
    const fill = setMediaFit(sponsor, "sponsor", undefined, 16 / 9);
    expect(fill.find((e) => e.id === "sponsor")?.style).toEqual({ background: RAFC_RED });
    expect(fill.map((e) => e.x)).toEqual(sponsor.map((e) => e.x));
  });
});
