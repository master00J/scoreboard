import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLOTS,
  SLOT_PRESETS,
  bottomBarForSixteenByNine,
  largestSixteenByNineSlot,
  mergeScoreboardTheme,
  reservedContentIsSixteenByNine,
  scoreboardUsesCustom,
  scoreboardUsesLeftFrame,
  scoreboardUsesStrip,
  slotIsSixteenByNine,
  slotsFromTheme,
  themeForFreeformEdit,
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

  it("bewaart vrije plaatsing en splitst oude teamvakken in logo + score", () => {
    const theme = mergeScoreboardTheme(
      JSON.stringify({
        layoutMode: "custom",
        slots: { home: { x: 5, y: 5, w: 20, h: 30 } },
      }),
    );
    expect(scoreboardUsesCustom(theme)).toBe(true);
    expect(theme.slots.home.x).toBe(5);
    expect(theme.slots.home.y).toBe(5);
    expect(theme.slots.home.h).toBeLessThan(30);
    expect(theme.slots.homeScore.y).toBeGreaterThanOrEqual(theme.slots.home.y + theme.slots.home.h);
    expect(theme.slots.sponsor.w).toBeGreaterThan(8);
  });

  it("houdt aparte scorevakken zoals opgeslagen", () => {
    const theme = mergeScoreboardTheme(
      JSON.stringify({
        slots: {
          home: { x: 5, y: 5, w: 20, h: 22 },
          homeScore: { x: 6, y: 40, w: 18, h: 12 },
        },
      }),
    );
    expect(theme.slots.home).toEqual({ x: 5, y: 5, w: 20, h: 22 });
    expect(theme.slots.homeScore).toEqual({ x: 6, y: 40, w: 18, h: 12 });
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

  it("leidt de onderbalk af zodat het L-contentvlak 16:9 blijft", () => {
    expect(bottomBarForSixteenByNine(320)).toBe(180);
    expect(reservedContentIsSixteenByNine(320, 180)).toBe(true);
    expect(reservedContentIsSixteenByNine(320, 300)).toBe(false);
  });

  it("zet een L-balk om naar sleepbare vakken links + 16:9-video", () => {
    const theme = mergeScoreboardTheme(
      JSON.stringify({ layoutMode: "left-l", leftBarWidthPx: 320, bottomBarHeightPx: 180 }),
    );
    const slots = slotsFromTheme(theme);
    expect(slots.home.x).toBe(0);
    expect(slots.away.x).toBe(0);
    expect(slots.clock.x).toBe(0);
    expect(slots.sponsor.x).toBeGreaterThan(10);
    expect(slotIsSixteenByNine(slots.sponsor)).toBe(true);
    const edit = themeForFreeformEdit(theme);
    expect(edit.layoutMode).toBe("custom");
    expect(edit.contentAreaBg).toBe(theme.frameColorMid);
  });

  it("bewaart vakken van het volledige scorebord", () => {
    const theme = mergeScoreboardTheme(
      JSON.stringify({ fullSlots: { home: { x: 10, y: 10, w: 25, h: 40 } } }),
    );
    expect(theme.fullSlots.home).toEqual({ x: 10, y: 10, w: 25, h: 27 });
    expect(theme.fullSlots.homeScore.y).toBeGreaterThanOrEqual(theme.fullSlots.home.y + theme.fullSlots.home.h);
    expect(theme.fullSlots.clock.w).toBeGreaterThan(8);
    expect(theme.fullSlots.away.x).toBeGreaterThan(0);
  });

  it("bewaart achtergrondpaden voor fullscreen en L-balk", () => {
    const theme = mergeScoreboardTheme(
      JSON.stringify({
        fullBackgroundPath: "D:/led/full.png",
        leftFrameBackgroundPath: "/uploads/l-bar.webp",
      }),
    );
    expect(theme.fullBackgroundPath).toBe("D:/led/full.png");
    expect(theme.leftFrameBackgroundPath).toBe("/uploads/l-bar.webp");
  });

  it("negeert lege of ongeldige achtergrondpaden", () => {
    const theme = mergeScoreboardTheme(
      JSON.stringify({
        fullBackgroundPath: "  ",
        leftFrameBackgroundPath: "line\nbreak",
      }),
    );
    expect(theme.fullBackgroundPath).toBe("");
    expect(theme.leftFrameBackgroundPath).toBe("");
  });

  it("houdt custom-vakken bij freeform-edit", () => {
    const theme = mergeScoreboardTheme(
      JSON.stringify({
        layoutMode: "custom",
        contentAreaBg: "#111111",
        slots: { home: { x: 8, y: 8, w: 20, h: 30 } },
      }),
    );
    const edit = themeForFreeformEdit(theme);
    expect(edit.layoutMode).toBe("custom");
    expect(edit.contentAreaBg).toBe("#111111");
    expect(edit.slots.home.x).toBe(8);
    expect(edit.slots.home.y).toBe(8);
    expect(edit.slots.homeScore.y).toBeGreaterThanOrEqual(edit.slots.home.y + edit.slots.home.h);
  });

  it("L-frame wint alleen in auto als de runtime dat vraagt", () => {
    const auto = mergeScoreboardTheme(JSON.stringify({ layoutMode: "auto" }));
    expect(scoreboardUsesLeftFrame(auto, false)).toBe(false);
    expect(scoreboardUsesLeftFrame(auto, true)).toBe(true);
    const left = mergeScoreboardTheme(JSON.stringify({ layoutMode: "left-l" }));
    expect(scoreboardUsesLeftFrame(left, false)).toBe(true);
  });
});
