import { describe, expect, it } from "vitest";
import {
  externalCaptureCoversDisplay,
  isSponsorPlaybackInterrupted,
} from "./sponsor-playback-interruption";

describe("isSponsorPlaybackInterrupted", () => {
  it.each([
    "SPONSOR",
    "GOAL",
    "GOAL_INTRO_VIDEO",
    "GOAL_PLAYER_VIDEO",
    "SUBSTITUTION",
    "CARD",
    "TEAM_INTRO",
    "PLAYER_INTRO",
    "BLACKOUT",
    "CUSTOM",
  ] as const)("onderbreekt en herstart sponsorcontent voor %s", (mode) => {
    expect(isSponsorPlaybackInterrupted(mode, false)).toBe(true);
  });

  it("onderbreekt ook voor een ingeplande mediacue", () => {
    expect(isSponsorPlaybackInterrupted("SPONSOR_ROTATION", true)).toBe(true);
  });

  it.each(["MATCH", "SPONSOR_ROTATION", "IDLE"] as const)(
    "behandelt %s niet als een tijdelijke media-onderbreking",
    (mode) => {
      expect(isSponsorPlaybackInterrupted(mode, false)).toBe(false);
    },
  );

  it("pauzeert de rotatie zolang externe capture het scherm bedekt", () => {
    expect(isSponsorPlaybackInterrupted("SPONSOR_ROTATION", false, true)).toBe(true);
    expect(isSponsorPlaybackInterrupted("SPONSOR_ROTATION", false, false)).toBe(false);
  });
});

describe("externalCaptureCoversDisplay", () => {
  it("bedekt het scherm bij live capture met bron", () => {
    expect(
      externalCaptureCoversDisplay({
        externalCaptureToDisplay: true,
        externalCaptureSourceId: "window:1",
        mode: "SPONSOR_ROTATION",
      }),
    ).toBe(true);
  });

  it("bedekt niets zonder bron of zonder live-schakeling", () => {
    expect(
      externalCaptureCoversDisplay({
        externalCaptureToDisplay: true,
        externalCaptureSourceId: null,
        mode: "SPONSOR_ROTATION",
      }),
    ).toBe(false);
    expect(
      externalCaptureCoversDisplay({
        externalCaptureToDisplay: false,
        externalCaptureSourceId: "window:1",
        mode: "SPONSOR_ROTATION",
      }),
    ).toBe(false);
  });

  it("telt niet tijdens BLACKOUT — dan is het scherm zwart, niet bedekt door capture", () => {
    expect(
      externalCaptureCoversDisplay({
        externalCaptureToDisplay: true,
        externalCaptureSourceId: "window:1",
        mode: "BLACKOUT",
      }),
    ).toBe(false);
  });

  it("is veilig bij ontbrekende state", () => {
    expect(externalCaptureCoversDisplay(null)).toBe(false);
    expect(externalCaptureCoversDisplay(undefined)).toBe(false);
  });
});
