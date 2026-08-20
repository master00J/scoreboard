import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLOTS,
  SLOT_PRESETS,
  largestSixteenByNineSlot,
  mergeScoreboardTheme,
  scoreboardUsesCustom,
  scoreboardUsesLeftFrame,
  scoreboardUsesStrip,
  slotIsSixteenByNine,
} from "./scoreboard-theme";

describe("scoreboard theme personalization", () => {
  it("zet nieuwe zichtbaarheid en layout op defaults", () => {
    const theme = mergeScoreboardTheme(null);
    expect(theme.layoutMode).toBe("auto");
    expect(theme.showLogos).toBe(true);
    expect(theme.showScores).toBe(true);
    expect(theme.showClock).toBe(true);
    expect(theme.fullTeamStackOrder).toBe("logo-name-score");
    expect(theme.slots.sponsor.w).toBeGreaterThan(20);
  });

  it("bewaart vrije plaatsing", () => {
    const theme = mergeScoreboardTheme(
      JSON.stringify({
        layoutMode: "custom",
        slots: { home: { x: 5, y: 5, w: 20, h: 30 } },
      }),
    );
    expect(scoreboardUsesCustom(theme)).toBe(true);
    expect(theme.slots.home).toEqual({ x: 5, y: 5, w: 20, h: 30 });
    expect(theme.slots.sponsor.w).toBeGreaterThan(8);
  });

  it("leest een opgeslagen layoutMode", () => {
    const theme = mergeScoreboardTheme(JSON.stringify({ layoutMode: "bottom-strip", showLogos: false }));
    expect(theme.layoutMode).toBe("bottom-strip");
    expect(theme.showLogos).toBe(false);
    expect(scoreboardUsesStrip(theme)).toBe(true);
    expect(scoreboardUsesLeftFrame(theme, true)).toBe(false);
    const full = mergeScoreboardTheme(JSON.stringify({ layoutMode: "full" }));
    expect(scoreboardUsesLeftFrame(full, true)).toBe(true);
  });

  it("houdt het standaard sponsvak en presets op 16:9 (canvas-%)", () => {
    expect(slotIsSixteenByNine(DEFAULT_SLOTS.sponsor)).toBe(true);
    for (const preset of SLOT_PRESETS) {
      expect(slotIsSixteenByNine(preset.slots.sponsor)).toBe(true);
    }
    expect(largestSixteenByNineSlot({ x: 22, y: 28, w: 56, h: 68 })).toEqual({
      x: 22,
      y: 34,
      w: 56,
      h: 56,
    });
  });

  it("L-frame wint alleen in auto als de runtime dat vraagt", () => {
    const auto = mergeScoreboardTheme(JSON.stringify({ layoutMode: "auto" }));
    expect(scoreboardUsesLeftFrame(auto, false)).toBe(false);
    expect(scoreboardUsesLeftFrame(auto, true)).toBe(true);
    const left = mergeScoreboardTheme(JSON.stringify({ layoutMode: "left-l" }));
    expect(scoreboardUsesLeftFrame(left, false)).toBe(true);
  });
});
