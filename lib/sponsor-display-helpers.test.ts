import { describe, expect, it } from "vitest";
import {
  applySponsorBudgetCapToSpreadPhase,
  scoreFrameAllowed,
  shouldShowFullScreenMatchBoard,
  liveSponsorBesideVisible,
  isExclusiveFullscreenDisplayMode,
} from "./sponsor-display-helpers";
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

describe("liveSponsorBesideVisible", () => {
  it("verbergt het L-frame zonder lopende clip", () => {
    expect(
      liveSponsorBesideVisible({
        mounted: true,
        phase: "scoreboard",
        interruptOverlay: false,
        previewFollowClip: false,
        scheduledCue: false,
      }),
    ).toBe(false);
  });

  it("toont het L-frame tijdens een sponsorclip of overlay", () => {
    expect(
      liveSponsorBesideVisible({
        mounted: true,
        phase: "sponsor",
        interruptOverlay: false,
        previewFollowClip: false,
        scheduledCue: false,
      }),
    ).toBe(true);
    expect(
      liveSponsorBesideVisible({
        mounted: true,
        phase: "scoreboard",
        interruptOverlay: true,
        previewFollowClip: false,
        scheduledCue: false,
      }),
    ).toBe(true);
  });

  it("verbergt het L-frame tijdens team- of spelerintro", () => {
    expect(
      liveSponsorBesideVisible({
        mounted: true,
        phase: "sponsor",
        interruptOverlay: false,
        previewFollowClip: false,
        scheduledCue: true,
        exclusiveFullscreen: true,
      }),
    ).toBe(false);
  });

  it("blijft uit als de rotatie niet gemount is", () => {
    expect(
      liveSponsorBesideVisible({
        mounted: false,
        phase: "sponsor",
        interruptOverlay: true,
        previewFollowClip: true,
        scheduledCue: true,
      }),
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

  it("houdt team-intro fullscreen, ook tijdens een speelset", () => {
    expect(isExclusiveFullscreenDisplayMode("TEAM_INTRO")).toBe(true);
    expect(isExclusiveFullscreenDisplayMode("PLAYER_INTRO")).toBe(true);
    expect(
      scoreFrameAllowed({
        mode: "TEAM_INTRO",
        matchStatus: "FIRST_HALF",
      }),
    ).toBe(false);
  });
});

describe("applySponsorBudgetCapToSpreadPhase", () => {
  const capOpts = {
    sponsors: [],
    section: "match" as const,
    matchStatus: "FIRST_HALF",
    slotMap: [] as (string | null)[],
    slotT: 10,
    sponsorLedger: null,
    ledgerMatchesSegment: false,
    nowMs: 0,
  };

  it("stopt de sponsorfase als er geen budget meer is", () => {
    expect(
      applySponsorBudgetCapToSpreadPhase(
        { phase: "sponsor", sponsorFilterId: "sp-1" },
        { ...capOpts, cycleBudgetForever: false },
      ),
    ).toEqual({ phase: "scoreboard", sponsorFilterId: null });
  });

  it("blijft draaien als herhalen van het budget aan staat", () => {
    expect(
      applySponsorBudgetCapToSpreadPhase(
        { phase: "sponsor", sponsorFilterId: "sp-1" },
        { ...capOpts, cycleBudgetForever: true },
      ),
    ).toEqual({ phase: "sponsor", sponsorFilterId: "sp-1" });
  });
});
