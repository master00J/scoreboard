/** Veldbesetting per team (player id's op het veld). */

export function parsePlayerIdArrayJson(raw: string | null | undefined): string[] {
  if (!raw || raw === "") return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export function defaultField11FromRoster(
  players: { id: string; number: number; isCoach: boolean }[],
): string[] {
  return defaultFieldFromRoster(players, 11);
}

export function defaultFieldFromRoster(
  players: { id: string; number: number; isCoach: boolean }[],
  maximum: number,
): string[] {
  const field = players.filter((p) => !p.isCoach);
  field.sort((a, b) => a.number - b.number);
  return field.slice(0, Math.max(1, maximum)).map((p) => p.id);
}

export function applySubstitutionToFieldIds(
  fieldIds: string[],
  playerOutId: string,
  playerInId: string,
): string[] {
  if (playerOutId === playerInId) return [...fieldIds];
  const outIdx = fieldIds.indexOf(playerOutId);
  if (outIdx === -1) return [...fieldIds];
  const next = [...fieldIds];
  const inIdx = next.indexOf(playerInId);
  if (inIdx !== -1 && inIdx !== outIdx) next.splice(inIdx, 1);
  const slot = next.indexOf(playerOutId);
  if (slot === -1) return next;
  next[slot] = playerInId;
  return next;
}
