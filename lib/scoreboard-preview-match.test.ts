import { describe, expect, it } from "vitest";
import { DEFAULT_SCOREBOARD_THEME, mergeScoreboardTheme } from "./scoreboard-theme";
import type { Match } from "./types";
import {
  SCOREBOARD_PREVIEW_AWAY,
  SCOREBOARD_PREVIEW_HOME,
  buildScoreboardPreviewMatch,
  layoutPreviewMatch,
  layoutPreviewMeta,
  layoutPreviewReplacesIdle,
  sportPreviewShotClock,
  teamFromHomeBranding,
  themeForPreviewSport,
  withLayoutPreviewMeta,
} from "./scoreboard-preview-match";

describe("probeer op scherm zonder wedstrijd", () => {
  it("zet de proefindeling over het idle-logo", () => {
    expect(layoutPreviewReplacesIdle('{"layoutMode":"custom"}', "IDLE")).toBe(true);
    expect(layoutPreviewReplacesIdle('{"layoutMode":"custom"}', "SPONSOR_ROTATION")).toBe(true);
    expect(layoutPreviewReplacesIdle(null, "IDLE")).toBe(false);
    expect(layoutPreviewReplacesIdle('{"layoutMode":"custom"}', "BLACKOUT")).toBe(false);
  });

  it("gebruikt het thuislogo van de club in de voorbeeldwedstrijd", () => {
    const match = buildScoreboardPreviewMatch({
      home: teamFromHomeBranding({
        name: "Antwerp",
        logoPath: "/crest.png",
        primaryColor: "#ffffff",
      }),
    });
    expect(match.homeTeam.logoPath).toBe("/crest.png");
    expect(match.homeTeam.name).toBe("Antwerp");
    expect(match.homeScore).toBe(1);
    expect(match.awayScore).toBe(0);
  });
});

describe("probeer op scherm toont wat het canvas toont", () => {
  const payload = { ...DEFAULT_SCOREBOARD_THEME, layoutMode: "auto" };

  it("neemt het vlak en de sport van de editor mee", () => {
    const json = JSON.stringify(withLayoutPreviewMeta(payload, { surface: "full", sport: "volleyball" }));
    expect(layoutPreviewMeta(json)).toEqual({ surface: "full", sport: "VOLLEYBALL" });
  });

  it("toont bij een proef zonder vlak het sponsorvlak, zoals voorheen", () => {
    expect(layoutPreviewMeta(JSON.stringify(payload))).toEqual({ surface: "sponsor", sport: null });
    expect(layoutPreviewMeta("{kapot")).toEqual({ surface: "sponsor", sport: null });
    expect(layoutPreviewMeta('{"previewSurface":"elders","previewSport":"CURLING"}')).toEqual({
      surface: "sponsor",
      sport: null,
    });
  });

  it("laat de indeling zelf ongemoeid", () => {
    const json = JSON.stringify(withLayoutPreviewMeta(payload, { surface: "full", sport: "FOOTBALL" }));
    const { previewSurface, previewSport, ...theme } = mergeScoreboardTheme(json) as unknown as Record<string, unknown>;
    expect([previewSurface, previewSport]).toEqual(["full", "FOOTBALL"]);
    expect(theme).toEqual(mergeScoreboardTheme(JSON.stringify(payload)));
  });

  it("gebruikt de lopende wedstrijd alleen bij dezelfde sport", () => {
    const home = SCOREBOARD_PREVIEW_HOME;
    const away = SCOREBOARD_PREVIEW_AWAY;
    const live: Match = { ...buildScoreboardPreviewMatch(), id: "live", sport: "VOLLEYBALL", homeScore: 25 };
    const same = layoutPreviewMatch({ live, sport: "VOLLEYBALL", home, away });
    expect(same.live).toBe(true);
    expect(same.match.id).toBe("live");
    expect(same.match.homeScore).toBe(25);

    const other = layoutPreviewMatch({ live, sport: "BASKETBALL", home, away });
    expect(other.live).toBe(false);
    expect(other.match.sport).toBe("BASKETBALL");
    expect(other.match.homeFouls).toBeGreaterThan(0);

    const none = layoutPreviewMatch({ live: null, sport: "VOLLEYBALL", home, away });
    expect(none.live).toBe(false);
    expect(none.match.setHistory?.length).toBeGreaterThan(0);
  });

  it("verbergt klok en extra tijd zoals het stadionscherm", () => {
    const theme = { ...DEFAULT_SCOREBOARD_THEME, showClock: true, fullShowAddedTime: true };
    expect(themeForPreviewSport(theme, "VOLLEYBALL").showClock).toBe(false);
    expect(themeForPreviewSport(theme, "FOOTBALL").showClock).toBe(true);
    expect(themeForPreviewSport(theme, "BASKETBALL").fullShowAddedTime).toBe(false);
    expect(sportPreviewShotClock("BASKETBALL")).toBe(14);
    expect(sportPreviewShotClock("FOOTBALL")).toBe(0);
  });
});
