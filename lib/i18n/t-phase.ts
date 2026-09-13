import type { TFunction } from "i18next";
import { getSportProfile, sportSponsorBlockLabel } from "../sports";

/** Match-status → vertaalde fase-label (Setup / Prematch / …), sport-aware. */
export function tMatchStatus(
  t: TFunction,
  status: string | null | undefined,
  sport?: unknown,
): string {
  if (!status) return "";
  if (sport != null) {
    const profile = getSportProfile(sport);
    if (status === "HALF_TIME") {
      const key = `phases.break_${profile.id}`;
      const translated = t(key);
      if (translated !== key) return translated;
    }
    if (status === "FIRST_HALF") {
      const key = `phases.blockA_${profile.id}`;
      const translated = t(key);
      if (translated !== key) return translated;
    }
    if (status === "SECOND_HALF") {
      const key = `phases.blockB_${profile.id}`;
      const translated = t(key);
      if (translated !== key) return translated;
    }
  }
  const key = `phases.${status}`;
  const translated = t(key);
  return translated === key ? status.replaceAll("_", " ") : translated;
}

export function tSponsorBlock(
  t: TFunction,
  sport: unknown,
  block: "h1" | "h2" | "halftime",
): string {
  const profile = getSportProfile(sport);
  const key =
    block === "halftime"
      ? `phases.break_${profile.id}`
      : block === "h1"
        ? `phases.blockA_${profile.id}`
        : `phases.blockB_${profile.id}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return sportSponsorBlockLabel(sport, block);
}
