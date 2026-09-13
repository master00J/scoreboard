import { describe, expect, it } from "vitest";
import { DEFAULT_STREAM_BREAK_LAYOUT, DEFAULT_STREAM_MANUAL_LAYOUT, DEFAULT_STREAM_PLAY_LAYOUT } from "./livestream";
import { resolveStreamProgramLayout, streamProgramPhase, summarizeStreamLayout } from "./stream-program-layout";

const auto = {
  layoutMode: "auto" as const,
  sponsors: true,
  manualPhaseSplit: false,
  manualLayout: DEFAULT_STREAM_MANUAL_LAYOUT,
  manualPlayLayout: DEFAULT_STREAM_PLAY_LAYOUT,
  manualBreakLayout: DEFAULT_STREAM_BREAK_LAYOUT,
};

const manualUnified = {
  ...auto,
  layoutMode: "manual" as const,
  manualPhaseSplit: false,
  manualLayout: {
    ...DEFAULT_STREAM_MANUAL_LAYOUT,
    score: false,
    sponsors: true,
    sponsorStyle: "logos" as const,
  },
};

describe("streamProgramPhase", () => {
  it("speeltijd tijdens helft/verlenging", () => {
    expect(streamProgramPhase("FIRST_HALF")).toBe("play");
    expect(streamProgramPhase("SECOND_HALF")).toBe("play");
    expect(streamProgramPhase("EXTRA_TIME")).toBe("play");
  });

  it("pauze bij rust en voor/na", () => {
    expect(streamProgramPhase("HALF_TIME")).toBe("break");
    expect(streamProgramPhase("PREMATCH")).toBe("break");
    expect(streamProgramPhase("FULL_TIME")).toBe("break");
  });
});

describe("resolveStreamProgramLayout", () => {
  it("auto: wedstrijd = camera + score, geen sponsor over het beeld", () => {
    const layout = resolveStreamProgramLayout(auto, "FIRST_HALF");
    expect(layout.phase).toBe("play");
    expect(layout.showScore).toBe(true);
    expect(layout.showSponsorStrip).toBe(false);
    expect(layout.showSponsorBreak).toBe(false);
  });

  it("auto: sponsors-vlag verandert speeltijd niet", () => {
    const on = resolveStreamProgramLayout(auto, "FIRST_HALF");
    const off = resolveStreamProgramLayout({ ...auto, sponsors: false }, "FIRST_HALF");
    expect(on.showSponsorStrip).toBe(false);
    expect(off.showSponsorStrip).toBe(false);
    expect(on.showScore).toBe(true);
  });

  it("auto: rust = sponsors fullscreen, geen score", () => {
    const layout = resolveStreamProgramLayout(auto, "HALF_TIME");
    expect(layout.phase).toBe("break");
    expect(layout.showScore).toBe(false);
    expect(layout.showSponsorBreak).toBe(true);
  });

  it("auto: sponsors uit = ook geen break-overlay", () => {
    expect(resolveStreamProgramLayout({ ...auto, sponsors: false }, "HALF_TIME").showSponsorBreak).toBe(false);
  });

  it("manual unified: volgt manualLayout", () => {
    const layout = resolveStreamProgramLayout(manualUnified, "FIRST_HALF");
    expect(layout.showScore).toBe(false);
    expect(layout.showSponsorStrip).toBe(true);
  });

  it("manual split: wedstrijd vs pauze", () => {
    const settings = {
      ...auto,
      layoutMode: "manual" as const,
      manualPhaseSplit: true,
      manualPlayLayout: DEFAULT_STREAM_PLAY_LAYOUT,
      manualBreakLayout: { ...DEFAULT_STREAM_BREAK_LAYOUT, score: true, sponsorStyle: "lowerthird" as const },
    };
    expect(resolveStreamProgramLayout(settings, "FIRST_HALF").showScore).toBe(true);
    expect(resolveStreamProgramLayout(settings, "HALF_TIME").sponsorStripStyle).toBe("lowerthird");
    expect(resolveStreamProgramLayout(settings, "HALF_TIME").showSponsorBreak).toBe(false);
  });
});

describe("summarizeStreamLayout", () => {
  it("auto prematch = fullscreen sponsors, geen score", () => {
    expect(summarizeStreamLayout(auto, "PREMATCH")).toEqual({
      phase: "break",
      score: false,
      sponsors: "fullscreen",
    });
  });

  it("auto helft = score, geen sponsors", () => {
    expect(summarizeStreamLayout(auto, "FIRST_HALF")).toEqual({
      phase: "play",
      score: true,
      sponsors: "off",
    });
  });
});
