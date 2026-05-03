import type { Match } from "./types";

/** True when API payload is a real match with both teams (not e.g. `{ error }` or partial JSON). */
export function isFullMatch(data: unknown): data is Match {
  if (!data || typeof data !== "object") return false;
  const m = data as Record<string, unknown>;
  if (typeof m.id !== "string" || typeof m.status !== "string") return false;
  const ht = m.homeTeam;
  const at = m.awayTeam;
  if (!ht || !at || typeof ht !== "object" || typeof at !== "object") return false;
  const h = ht as Record<string, unknown>;
  const a = at as Record<string, unknown>;
  return typeof h.name === "string" && typeof a.name === "string";
}
