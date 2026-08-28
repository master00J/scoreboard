import type { MatchEvent, Player } from "@/lib/types";

/**
 * Bepaalt per team wie "op het veld" staat vs. wisselbank, op basis van:
 * - start: eerste 11 niet-coaches (op rugnummer), rest bank;
 * - daarna chronologische SUB-events (player uit → bank, player in → veld).
 */
export function squadOnFieldAndBench(
  teamId: string,
  players: Player[],
  events: MatchEvent[] | undefined,
): { onField: Player[]; bench: Player[] } {
  const squad = players.filter((p) => !p.isCoach && p.teamId === teamId);
  const sorted = [...squad].sort((a, b) => a.number - b.number);

  const onField = new Set<string>();
  const bench = new Set<string>();

  if (sorted.length <= 11) {
    for (const p of sorted) onField.add(p.id);
  } else {
    for (const p of sorted.slice(0, 11)) onField.add(p.id);
    for (const p of sorted.slice(11)) bench.add(p.id);
  }

  const subEvents = [...(events ?? [])]
    .filter(
      (e) =>
        e.type === "SUB" &&
        e.teamId === teamId &&
        e.playerOutId &&
        e.playerInId,
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const ev of subEvents) {
    const outId = ev.playerOutId!;
    const inId = ev.playerInId!;
    if (onField.has(outId)) {
      onField.delete(outId);
      bench.add(outId);
    }
    if (bench.has(inId)) {
      bench.delete(inId);
      onField.add(inId);
    } else if (!onField.has(inId) && !bench.has(inId)) {
      // speler stond nog niet in model (zeldzaam): toch op veld zetten
      onField.add(inId);
    }
  }

  const onFieldList = sorted.filter((p) => onField.has(p.id));
  const benchList = sorted.filter((p) => bench.has(p.id));
  return { onField: onFieldList, bench: benchList };
}
