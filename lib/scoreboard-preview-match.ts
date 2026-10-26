import type { AppSettings, Match, Team } from "./types";

/** Zelfde voorbeeldcijfers als in Scherm indelen, zodat het stadionscherm het canvas volgt. */
export const SCOREBOARD_PREVIEW_ELAPSED = 512;
export const SCOREBOARD_PREVIEW_ADDED_TIME = 2;

export const SCOREBOARD_PREVIEW_HOME: Team = {
  id: "preview-home",
  name: "Thuis",
  shortName: "THU",
  logoPath: null,
  primaryColor: "#2563eb",
  secondaryColor: "#1e3a8a",
};

export const SCOREBOARD_PREVIEW_AWAY: Team = {
  id: "preview-away",
  name: "Uit",
  shortName: "UIT",
  logoPath: null,
  primaryColor: "#dc2626",
  secondaryColor: "#7f1d1d",
};

function previewTeam(partial: Team | null | undefined, fallback: Team): Team {
  if (!partial) return fallback;
  return partial;
}

/** Clublogo uit instellingen, zodat een proef zonder wedstrijd niet het standaardschild toont. */
export function teamFromHomeBranding(
  branding: AppSettings["homeTeamBranding"] | null | undefined,
  fallback: Team = SCOREBOARD_PREVIEW_HOME,
): Team {
  if (!branding?.name && !branding?.logoPath) return fallback;
  return {
    id: "preview-home",
    name: branding.name || fallback.name,
    shortName: (branding.name || fallback.shortName).slice(0, 3).toUpperCase(),
    logoPath: branding.logoPath ?? null,
    primaryColor: branding.primaryColor ?? fallback.primaryColor,
    secondaryColor: branding.secondaryColor ?? fallback.secondaryColor,
  };
}

export function buildScoreboardPreviewMatch(opts?: {
  home?: Team | null;
  away?: Team | null;
}): Match {
  const home = previewTeam(opts?.home, SCOREBOARD_PREVIEW_HOME);
  const away = previewTeam(opts?.away, SCOREBOARD_PREVIEW_AWAY);
  return {
    id: "preview",
    homeTeamId: home.id,
    awayTeamId: away.id,
    homeTeam: home,
    awayTeam: away,
    kickoffAt: null,
    halfDurationSec: 2700,
    halfBreakSec: 900,
    sport: "FOOTBALL",
    currentPeriod: 1,
    periodDurationSec: 2700,
    homeTimeouts: 0,
    awayTimeouts: 0,
    homeFouls: 0,
    awayFouls: 0,
    homeSets: 0,
    awaySets: 0,
    status: "FIRST_HALF",
    homeScore: 1,
    awayScore: 0,
    createdAt: new Date().toISOString(),
  };
}

/**
 * "Probeer op scherm" moet het idle-logo vervangen. Blackout blijft zwart.
 */
export function layoutPreviewReplacesIdle(
  themePreviewJson: string | null | undefined,
  mode: string,
): boolean {
  if (!themePreviewJson) return false;
  return mode !== "BLACKOUT";
}
