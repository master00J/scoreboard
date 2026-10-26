import { describe, expect, it } from "vitest";
import { buildScoreboardPreviewMatch } from "./scoreboard-preview-match";
import {
  sportTeamExtraChips,
  sportTeamExtrasCharCount,
  sportTeamExtrasFitFontSize,
} from "./sport-team-extras";

describe("team-extra's op één regel", () => {
  it("zet serve, sets en time-outs in chips zonder ze te splitsen", () => {
    const match = {
      ...buildScoreboardPreviewMatch(),
      sport: "VOLLEYBALL" as const,
      servingSide: "home" as const,
      homeSets: 0,
      homeTimeouts: 0,
      currentPeriod: 1,
    };
    const chips = sportTeamExtraChips(match, "home");
    expect(chips.map((chip) => chip.text)).toEqual(["Serve", "Sets 0", "TO 0/2"]);
    expect(sportTeamExtrasCharCount(chips)).toBe("Serve Sets 0 TO 0/2".length);
  });

  it("kiest een kleinere letter als de regel langer wordt", () => {
    const short = sportTeamExtrasFitFontSize(6, true);
    const long = sportTeamExtrasFitFontSize(22, true);
    expect(short).toContain("cqw");
    expect(long).toContain("cqw");
    const shortCqw = Number(short.match(/(\d+(?:\.\d+)?)cqw/)?.[1]);
    const longCqw = Number(long.match(/(\d+(?:\.\d+)?)cqw/)?.[1]);
    expect(longCqw).toBeLessThan(shortCqw);
  });
});
