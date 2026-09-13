import type { Match, MatchEvent, Player, Team } from "./types";

export function streamShowsEventGraphic(mode: string | undefined): boolean {
  return mode === "CARD" || mode === "SUBSTITUTION";
}

export function matchPlayersById(match: Match | null | undefined): Record<string, Player> {
  const out: Record<string, Player> = {};
  if (!match) return out;
  for (const player of match.homeTeam?.players ?? []) out[player.id] = player;
  for (const player of match.awayTeam?.players ?? []) out[player.id] = player;
  return out;
}

export function resolveCardColor(
  events: MatchEvent[] | undefined,
  playerId: string | null | undefined,
): "YELLOW" | "RED" {
  if (!playerId || !events?.length) return "YELLOW";
  const cards = events.filter(
    (event) =>
      event.playerInId === playerId && (event.type === "CARD_YELLOW" || event.type === "CARD_RED"),
  );
  if (cards.length === 0) return "YELLOW";
  const latest = [...cards].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  return latest?.type === "CARD_RED" ? "RED" : "YELLOW";
}

export function resolveSubTeam(
  match: Match | null | undefined,
  playerIn: Player | null,
  playerOut: Player | null,
): Team | null {
  if (!match) return null;
  const player = playerIn ?? playerOut;
  if (!player) return null;
  return player.teamId === match.homeTeamId ? match.homeTeam : match.awayTeam;
}
