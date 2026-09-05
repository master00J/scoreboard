import { describe, expect, it } from "vitest";
import {
  matchPlayersById,
  resolveCardColor,
  resolveSubTeam,
  streamShowsEventGraphic,
} from "./stream-match-overlay";
import type { Match, MatchEvent, Player, Team } from "./types";

function player(id: string, teamId: string): Player {
  return {
    id,
    teamId,
    number: 9,
    firstName: "Jan",
    lastName: "Jansen",
    position: null,
    photoPath: null,
    isCoach: false,
    goalMediaId: null,
    goalVideoPath: null,
    subImagePath: null,
    lineupVideoPath: null,
  };
}

function event(partial: Partial<MatchEvent> & Pick<MatchEvent, "type" | "playerInId" | "createdAt">): MatchEvent {
  return {
    id: partial.id ?? partial.createdAt,
    matchId: "m1",
    minute: 12,
    addedTime: 0,
    teamId: "home",
    playerOutId: null,
    note: null,
    ...partial,
  };
}

describe("streamShowsEventGraphic", () => {
  it("kaart en wissel, geen clips", () => {
    expect(streamShowsEventGraphic("CARD")).toBe(true);
    expect(streamShowsEventGraphic("SUBSTITUTION")).toBe(true);
    expect(streamShowsEventGraphic("GOAL")).toBe(false);
    expect(streamShowsEventGraphic("SPONSOR_ROTATION")).toBe(false);
  });
});

describe("resolveCardColor", () => {
  it("kiest de nieuwste kaart van die speler", () => {
    expect(
      resolveCardColor(
        [
          event({ type: "CARD_YELLOW", playerInId: "p1", createdAt: "2026-01-01T00:00:01.000Z" }),
          event({ type: "CARD_RED", playerInId: "p1", createdAt: "2026-01-01T00:00:10.000Z" }),
        ],
        "p1",
      ),
    ).toBe("RED");
  });

  it("neemt geen kaart van een andere speler", () => {
    expect(
      resolveCardColor(
        [event({ type: "CARD_RED", playerInId: "other", createdAt: "2026-01-01T00:00:10.000Z" })],
        "p1",
      ),
    ).toBe("YELLOW");
  });
});

describe("matchPlayersById / resolveSubTeam", () => {
  const home: Team = { id: "home", name: "Thuis", shortName: "THU", logoPath: null, primaryColor: "#000", secondaryColor: "#fff", players: [player("p1", "home")] };
  const away: Team = { id: "away", name: "Uit", shortName: "UIT", logoPath: null, primaryColor: "#111", secondaryColor: "#eee", players: [player("p2", "away")] };
  const match = { id: "m1", homeTeamId: "home", awayTeamId: "away", homeTeam: home, awayTeam: away } as Match;

  it("indexeert beide selecties", () => {
    expect(Object.keys(matchPlayersById(match))).toEqual(["p1", "p2"]);
  });

  it("koppelt de wissel aan het team van de speler", () => {
    expect(resolveSubTeam(match, player("p2", "away"), null)?.id).toBe("away");
  });
});
