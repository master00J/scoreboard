import { describe, expect, it } from "vitest";
import { resolveStreamOverlayClip, streamOverlayClipAllowed, streamShowsDisplayClip } from "./stream-program-clip";
import type { MediaItem } from "./types";

function media(id: string, path = `/uploads/${id}.mp4`): MediaItem {
  return {
    id,
    type: "VIDEO",
    path,
    title: id,
    durationSec: 12,
    sponsorName: null,
    sponsorId: null,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("streamShowsDisplayClip", () => {
  it("alleen losse LED-clips, geen score/kaart-graphics", () => {
    expect(streamShowsDisplayClip("GOAL_INTRO_VIDEO")).toBe(true);
    expect(streamShowsDisplayClip("GOAL_PLAYER_VIDEO")).toBe(true);
    expect(streamShowsDisplayClip("SPONSOR")).toBe(true);
    expect(streamShowsDisplayClip("GOAL")).toBe(false);
    expect(streamShowsDisplayClip("CARD")).toBe(false);
    expect(streamShowsDisplayClip("SPONSOR_ROTATION")).toBe(false);
  });
});

describe("resolveStreamOverlayClip", () => {
  it("kiest de geplande cue boven een LED-clip", () => {
    const clip = resolveStreamOverlayClip({
      scheduled: media("cue"),
      displayMode: "GOAL_PLAYER_VIDEO",
      displayMedia: media("goal"),
    });
    expect(clip?.id).toBe("cue");
  });

  it("toont LED-clip als er geen cue is", () => {
    const clip = resolveStreamOverlayClip({
      scheduled: null,
      displayMode: "GOAL_INTRO_VIDEO",
      displayMedia: media("intro"),
    });
    expect(clip?.id).toBe("intro");
    expect(clip?.src).toBe("/uploads/intro.mp4");
  });

  it("geen clip tijdens gewone rotatie", () => {
    expect(
      resolveStreamOverlayClip({
        scheduled: null,
        displayMode: "SPONSOR_ROTATION",
        displayMedia: media("unused"),
      }),
    ).toBeNull();
  });
});

describe("streamOverlayClipAllowed", () => {
  it("auto speeltijd: geen reclame, wel goal-video", () => {
    expect(
      streamOverlayClipAllowed({
        phase: "play",
        layoutMode: "auto",
        displayMode: "SPONSOR",
        fromScheduledCue: false,
      }),
    ).toBe(false);
    expect(
      streamOverlayClipAllowed({
        phase: "play",
        layoutMode: "auto",
        displayMode: "SPONSOR_ROTATION",
        fromScheduledCue: true,
      }),
    ).toBe(false);
    expect(
      streamOverlayClipAllowed({
        phase: "play",
        layoutMode: "auto",
        displayMode: "GOAL_PLAYER_VIDEO",
        fromScheduledCue: false,
      }),
    ).toBe(true);
  });

  it("pauze en handmatig: clips wel", () => {
    expect(
      streamOverlayClipAllowed({
        phase: "break",
        layoutMode: "auto",
        displayMode: "SPONSOR",
        fromScheduledCue: true,
      }),
    ).toBe(true);
    expect(
      streamOverlayClipAllowed({
        phase: "play",
        layoutMode: "manual",
        displayMode: "SPONSOR",
        fromScheduledCue: true,
      }),
    ).toBe(true);
  });
});
