import { describe, expect, it } from "vitest";
import { isSponsorPlaybackInterrupted } from "./sponsor-playback-interruption";

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
});
