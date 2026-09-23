import { describe, expect, it } from "vitest";
import { startupDisplayStatePatch } from "./display-startup";
import { idleMayPlayPrematchSponsors } from "./sponsor-display-helpers";

describe("startupDisplayStatePatch", () => {
  it("zet achtergebleven sponsorrotatie zonder wedstrijd terug naar IDLE", () => {
    expect(
      startupDisplayStatePatch({
        matchId: null,
        mode: "SPONSOR_ROTATION",
        activeMediaId: "clip-1",
      }),
    ).toEqual({ mode: "IDLE", activeMediaId: null });
  });

  it("wist een losse sponsorclip zonder wedstrijd", () => {
    expect(
      startupDisplayStatePatch({
        matchId: null,
        mode: "SPONSOR",
        activeMediaId: "clip-2",
      }),
    ).toEqual({ mode: "IDLE", activeMediaId: null });
  });

  it("laat leeg IDLE zonder media ongemoeid", () => {
    expect(
      startupDisplayStatePatch({
        matchId: null,
        mode: "IDLE",
        activeMediaId: null,
      }),
    ).toBeNull();
  });

  it("wist achtergebleven media in IDLE zonder wedstrijd", () => {
    expect(
      startupDisplayStatePatch({
        matchId: null,
        mode: "IDLE",
        activeMediaId: "clip-3",
      }),
    ).toEqual({ mode: "IDLE", activeMediaId: null });
  });

  it("houdt BLACKOUT zonder wedstrijd, maar wist media", () => {
    expect(
      startupDisplayStatePatch({
        matchId: null,
        mode: "BLACKOUT",
        activeMediaId: "clip-4",
      }),
    ).toEqual({ mode: "BLACKOUT", activeMediaId: null });
  });

  it("houdt scorebord + sponsors tijdens een speelhelft", () => {
    expect(
      startupDisplayStatePatch({
        matchId: "match-1",
        mode: "SPONSOR_ROTATION",
        activeMediaId: null,
        preferSponsorRotation: true,
        matchStatus: "FIRST_HALF",
      }),
    ).toBeNull();
  });

  it("herstelt scorebord + sponsors als de vorige sessie naar MATCH was gezet", () => {
    expect(
      startupDisplayStatePatch({
        matchId: "match-1",
        mode: "MATCH",
        activeMediaId: null,
        preferSponsorRotation: true,
        matchStatus: "FIRST_HALF",
      }),
    ).toEqual({ mode: "SPONSOR_ROTATION", activeMediaId: null });
  });

  it("houdt alleen-scorebord als de operator dat koos", () => {
    expect(
      startupDisplayStatePatch({
        matchId: "match-1",
        mode: "MATCH",
        activeMediaId: null,
        preferSponsorRotation: false,
        matchStatus: "FIRST_HALF",
      }),
    ).toBeNull();
  });

  it("wist een losse clip en gaat terug naar de voorkeur", () => {
    expect(
      startupDisplayStatePatch({
        matchId: "match-1",
        mode: "SPONSOR",
        activeMediaId: "clip-5",
        preferSponsorRotation: true,
        matchStatus: "FIRST_HALF",
      }),
    ).toEqual({ mode: "SPONSOR_ROTATION", activeMediaId: null });
  });

  it("houdt rust-sponsors als de operator scorebord + sponsors koos", () => {
    expect(
      startupDisplayStatePatch({
        matchId: "match-1",
        mode: "SPONSOR_ROTATION",
        activeMediaId: null,
        preferSponsorRotation: true,
        matchStatus: "HALF_TIME",
      }),
    ).toBeNull();
  });

  it("wist een highlight tijdens rust en gaat terug naar de rotatie", () => {
    expect(
      startupDisplayStatePatch({
        matchId: "match-1",
        mode: "SPONSOR",
        activeMediaId: "clip-highlight",
        preferSponsorRotation: true,
        matchStatus: "HALF_TIME",
      }),
    ).toEqual({ mode: "SPONSOR_ROTATION", activeMediaId: null });
  });

  it("wist een achtergebleven goal- of kaartoverlay na herstart", () => {
    expect(
      startupDisplayStatePatch({
        matchId: "match-1",
        mode: "GOAL_PLAYER_VIDEO",
        activeMediaId: "clip-goal",
        preferSponsorRotation: true,
        matchStatus: "FIRST_HALF",
      }),
    ).toEqual({ mode: "SPONSOR_ROTATION", activeMediaId: null });
    expect(
      startupDisplayStatePatch({
        matchId: "match-1",
        mode: "CARD",
        activeMediaId: null,
        preferSponsorRotation: false,
        matchStatus: "FIRST_HALF",
      }),
    ).toEqual({ mode: "MATCH", activeMediaId: null });
  });
});

describe("idleMayPlayPrematchSponsors", () => {
  it("is uit zonder wedstrijd", () => {
    expect(idleMayPlayPrematchSponsors(null)).toBe(false);
    expect(idleMayPlayPrematchSponsors(undefined)).toBe(false);
  });

  it("is aan met een geladen wedstrijd", () => {
    expect(idleMayPlayPrematchSponsors({ id: "m1" })).toBe(true);
  });
});
