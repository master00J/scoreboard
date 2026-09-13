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

  it("zet sponsorrotatie met wedstrijd terug naar MATCH i.p.v. opnieuw te starten", () => {
    expect(
      startupDisplayStatePatch({
        matchId: "match-1",
        mode: "SPONSOR_ROTATION",
        activeMediaId: "clip-5",
      }),
    ).toEqual({ mode: "MATCH", activeMediaId: null });
  });

  it("laat een lopende MATCH ongemoeid", () => {
    expect(
      startupDisplayStatePatch({
        matchId: "match-1",
        mode: "MATCH",
        activeMediaId: null,
      }),
    ).toBeNull();
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
