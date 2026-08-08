import type { TFunction } from "i18next";

/** Match-status → vertaalde fase-label (Setup / Prematch / …). */
export function tMatchStatus(t: TFunction, status: string | null | undefined): string {
  if (!status) return "";
  const key = `phases.${status}`;
  const translated = t(key);
  return translated === key ? status.replaceAll("_", " ") : translated;
}
