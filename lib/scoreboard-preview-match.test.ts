import { describe, expect, it } from "vitest";
import {
  buildScoreboardPreviewMatch,
  layoutPreviewReplacesIdle,
  teamFromHomeBranding,
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
