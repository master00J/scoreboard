import { prisma } from "../lib/prisma";
import {
  applySubstitutionToFieldIds,
  defaultFieldFromRoster,
  parsePlayerIdArrayJson,
} from "../lib/match-field-lineup";
import { getSportProfile } from "../lib/sports";

export type SubPair = { teamId: string; playerOutId: string; playerInId: string };

/** Na team-check: uit moet op veld staan, in niet (als opstelling bekend is). */
/**
 * Valideert een hele wissellijst tegen de actuele veldbezetting in de DB en past elke stap
 * toe op een kopie — zo worden batches geweigerd als een tweede wissel dezelfde uit-speler
 * gebruikt nadat die bij de eerste al van het veld is.
 */
export async function validateSubPairsSequential(
  matchId: string,
  pairs: SubPair[],
): Promise<void> {
  if (pairs.length === 0) return;
  const m = await prisma.match.findUnique({ where: { id: matchId } });
  if (!m) throw new Error("Match not found");

  let home = parsePlayerIdArrayJson(m.homeFieldPlayerIdsJson);
  let away = parsePlayerIdArrayJson(m.awayFieldPlayerIdsJson);

  for (const pair of pairs) {
    const field =
      pair.teamId === m.homeTeamId ? home : pair.teamId === m.awayTeamId ? away : null;
    if (field === null) {
      throw new Error("Team hoort niet bij deze wedstrijd");
    }
    if (field.length === 0) continue;

    if (!field.includes(pair.playerOutId)) {
      throw new Error(
        "Uit speler staat niet in de huidige veldopstelling (controleer meerdere wissels tegelijk)",
      );
    }
    if (field.includes(pair.playerInId)) {
      throw new Error("In speler staat al op het veld — kies een wisselspeler");
    }

    const next = applySubstitutionToFieldIds(field, pair.playerOutId, pair.playerInId);
    if (pair.teamId === m.homeTeamId) home = next;
    else away = next;
  }
}

export async function validateSubPairAgainstField(
  matchId: string,
  pair: SubPair,
): Promise<void> {
  const m = await prisma.match.findUnique({ where: { id: matchId } });
  if (!m) throw new Error("Match not found");
  const raw =
    pair.teamId === m.homeTeamId
      ? m.homeFieldPlayerIdsJson
      : pair.teamId === m.awayTeamId
        ? m.awayFieldPlayerIdsJson
        : null;
  if (!raw) return;
  const field = parsePlayerIdArrayJson(raw);
  if (field.length === 0) return;
  if (!field.includes(pair.playerOutId)) {
    throw new Error("Uit speler staat niet in de huidige veldopstelling");
  }
  if (field.includes(pair.playerInId)) {
    throw new Error("In speler staat al op het veld — kies een wisselspeler");
  }
}

export async function ensureDefaultMatchFieldLineups(matchId: string): Promise<void> {
  const m = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      homeTeam: { include: { players: { orderBy: { number: "asc" } } } },
      awayTeam: { include: { players: { orderBy: { number: "asc" } } } },
    },
  });
  if (!m) return;
  const home = parsePlayerIdArrayJson(m.homeFieldPlayerIdsJson);
  const away = parsePlayerIdArrayJson(m.awayFieldPlayerIdsJson);
  if (home.length > 0 && away.length > 0) return;
  const maximum = getSportProfile(m.sport).fieldPlayers;

  const nuHome =
    home.length > 0 ? home : defaultFieldFromRoster(m.homeTeam.players ?? [], maximum);
  const nuAway =
    away.length > 0 ? away : defaultFieldFromRoster(m.awayTeam.players ?? [], maximum);

  await prisma.match.update({
    where: { id: matchId },
    data: {
      homeFieldPlayerIdsJson: JSON.stringify(nuHome),
      awayFieldPlayerIdsJson: JSON.stringify(nuAway),
    },
  });
}

export async function applySubToFieldRoster(
  matchId: string,
  pair: { teamId: string; playerOutId: string; playerInId: string },
): Promise<void> {
  const m = await prisma.match.findUnique({ where: { id: matchId } });
  if (!m) return;
  const key =
    pair.teamId === m.homeTeamId
      ? "homeFieldPlayerIdsJson"
      : pair.teamId === m.awayTeamId
        ? "awayFieldPlayerIdsJson"
        : null;
  if (!key) return;

  const raw = key === "homeFieldPlayerIdsJson" ? m.homeFieldPlayerIdsJson : m.awayFieldPlayerIdsJson;
  let ids = parsePlayerIdArrayJson(raw);
  if (ids.length === 0) return;

  ids = applySubstitutionToFieldIds(ids, pair.playerOutId, pair.playerInId);
  await prisma.match.update({
    where: { id: matchId },
    data: { [key]: JSON.stringify(ids) },
  });
}
