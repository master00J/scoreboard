import { describe, expect, it } from "vitest";
import { scoreFrameAllowed, shouldShowFullScreenMatchBoard } from "./sponsor-display-helpers";
import type { Match, Playlist, PlaylistSlot } from "./types";

const emptyPlaylists = {} as Record<PlaylistSlot, Playlist | null>;
const match = { status: "FIRST_HALF" } as Match;

describe("shouldShowFullScreenMatchBoard", () => {
  it("toont fullscreen bij de scorebord-modus", () => {
    expect(shouldShowFullScreenMatchBoard(match, "MATCH", [], emptyPlaylists)).toBe(true);
  });

  it("toont fullscreen in een speelhelft zonder sponsorclips", () => {
    expect(shouldShowFullScreenMatchBoard(match, "SPONSOR_ROTATION", [], emptyPlaylists)).toBe(true);
  });

  it("toont fullscreen in de scorebord-fase, L-frame alleen als er een clip speelt", () => {
    expect(
      shouldShowFullScreenMatchBoard(match, "SPONSOR_ROTATION", [], emptyPlaylists, "scoreboard"),
    ).toBe(true);
    expect(
      shouldShowFullScreenMatchBoard(match, "SPONSOR_ROTATION", [], emptyPlaylists, "sponsor"),
    ).toBe(false);
  });
});

describe("scoreFrameAllowed", () => {
  it("zet het L-frame uit in prematch zodat het full-logo niet dubbel door de balk piept", () => {
    expect(
      scoreFrameAllowed({
        mode: "SPONSOR_ROTATION",
        matchStatus: "PREMATCH",
      }),
    ).toBe(false);
  });

  it("houdt het L-frame tijdens de helft als er een paneel naast hoort", () => {
    expect(
      scoreFrameAllowed({
        mode: "SPONSOR_ROTATION",
        matchStatus: "FIRST_HALF",
      }),
    ).toBe(true);
  });

  it("zet het L-frame altijd uit bij goal-intro en spelervideo", () => {
    expect(
      scoreFrameAllowed({
        mode: "GOAL_INTRO_VIDEO",
        matchStatus: "PREMATCH",
      }),
    ).toBe(false);
    expect(
      scoreFrameAllowed({
        mode: "GOAL_INTRO_VIDEO",
        matchStatus: "FIRST_HALF",
      }),
    ).toBe(false);
    expect(
      scoreFrameAllowed({
        mode: "GOAL_PLAYER_VIDEO",
        matchStatus: "FIRST_HALF",
      }),
    ).toBe(false);
  });
});
