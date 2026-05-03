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
  const field = players.filter((p) => !p.isCoach);
  field.sort((a, b) => a.number - b.number);
  return field.slice(0, 11).map((p) => p.id);
}

export function applySubstitutionToFieldIds(
  fieldIds: string[],
  playerOutId: string,
  playerInId: string,
): string[] {
  const next = fieldIds.filter((id) => id !== playerOutId);
  if (!next.includes(playerInId)) next.push(playerInId);
  return next;
}
