import { describe, expect, it } from "vitest";
import { mergeScoreboardTheme, scoreboardFrameKind } from "./scoreboard-theme";

const themeFor = (layoutMode: string) =>
  mergeScoreboardTheme(JSON.stringify({ layoutMode }));

describe("welke indeling het scherm tekent", () => {
  it("volgt het thema", () => {
    expect(scoreboardFrameKind(themeFor("custom"), true)).toBe("custom");
    expect(scoreboardFrameKind(themeFor("bottom-strip"), true)).toBe("strip");
    expect(scoreboardFrameKind(themeFor("left-l"), true)).toBe("left");
    expect(scoreboardFrameKind(themeFor("auto"), true)).toBe("left");
  });

  it("hangt niet af van of het frame nu getoond mag worden", () => {
    // Dit is de fout die een club dagen kostte: bij IDLE, rust, een intro of een wissel viel
    // de keuze terug op de L-balk, en een sponsorclip ging dan over zijn score heen staan
    // in plaats van in het vak dat hij zelf had neergezet.
    const custom = themeFor("custom");
    for (const autoLeft of [true, false]) {
      expect(scoreboardFrameKind(custom, autoLeft)).toBe("custom");
    }
  });
});
