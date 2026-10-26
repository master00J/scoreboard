import type { ResolvedScoreboardTheme } from "./scoreboard-theme";
import { SPORT_TYPES, getSportProfile, normalizeSport, resolveDisplayShowClock, type SportType } from "./sports";
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

/** Het vlak dat de editor toont: het scorebord naast een sponsorclip, of het volledige scorebord. */
export type LayoutPreviewSurface = "sponsor" | "full";

export type LayoutPreviewMeta = { surface: LayoutPreviewSurface; sport: SportType | null };

/**
 * "Probeer op scherm" stuurt mee welk vlak en welke sport de editor toont. Zonder dat tekende het
 * stadionscherm altijd het sponsorvlak, ook als de club het volledige scorebord aan het indelen was.
 */
export function withLayoutPreviewMeta(
  payload: Record<string, unknown>,
  meta: { surface: LayoutPreviewSurface; sport?: string | null },
): Record<string, unknown> {
  return {
    ...payload,
    previewSurface: meta.surface,
    previewSport: meta.sport ? normalizeSport(meta.sport) : null,
  };
}

/** Een proef zonder vlak (van een oudere editor) blijft het sponsorvlak tonen, zoals voorheen. */
export function layoutPreviewMeta(json: string | null | undefined): LayoutPreviewMeta {
  const fallback: LayoutPreviewMeta = { surface: "sponsor", sport: null };
  if (!json) return fallback;
  try {
    const raw = JSON.parse(json) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return fallback;
    const sport =
      typeof raw.previewSport === "string" && SPORT_TYPES.includes(raw.previewSport.toUpperCase() as SportType)
        ? normalizeSport(raw.previewSport)
        : null;
    return { surface: raw.previewSurface === "full" ? "full" : "sponsor", sport };
  } catch {
    return fallback;
  }
}

/** Voorbeeldwedstrijd per sport, zodat sets, fouten, time-outs en shotclock te zien zijn. */
export function sportPreviewMatch(home: Team, away: Team, sport: SportType): Match {
  const base: Match = { ...buildScoreboardPreviewMatch({ home, away }), sport };
  switch (sport) {
    case "BASKETBALL":
      return {
        ...base,
        currentPeriod: 2,
        periodDurationSec: 600,
        homeScore: 34,
        awayScore: 31,
        homeFouls: 3,
        awayFouls: 5,
        homeTimeouts: 1,
        awayTimeouts: 2,
        possessionArrow: "home",
      };
    case "FUTSAL":
      return { ...base, currentPeriod: 2, periodDurationSec: 1200, homeScore: 3, awayScore: 2, homeFouls: 4, awayFouls: 6, homeTimeouts: 1 };
    case "VOLLEYBALL":
      return {
        ...base,
        currentPeriod: 4,
        homeScore: 18,
        awayScore: 21,
        homeSets: 1,
        awaySets: 2,
        homeTimeouts: 1,
        servingSide: "home",
        setHistory: [
          { home: 25, away: 22 },
          { home: 20, away: 25 },
          { home: 23, away: 25 },
        ],
      };
    case "HOCKEY":
      return { ...base, currentPeriod: 3, periodDurationSec: 900, homeScore: 2, awayScore: 2 };
    default:
      return base;
  }
}

/** Klokstand in het voorbeeld; aftellende sporten tonen de resterende tijd. */
export function sportPreviewElapsed(sport: SportType): number {
  return getSportProfile(sport).timerMode === "COUNT_DOWN" ? 437 : SCOREBOARD_PREVIEW_ELAPSED;
}

export function sportPreviewShotClock(sport: SportType): number {
  return getSportProfile(sport).shotClockPresets.length > 0 ? 14 : 0;
}

/**
 * De lopende wedstrijd als die dezelfde sport heeft als het voorbeeld, anders een voorbeeldwedstrijd.
 * Editor en stadionscherm kiezen zo dezelfde stand.
 */
export function layoutPreviewMatch(opts: {
  live?: Match | null;
  sport: SportType;
  home: Team;
  away: Team;
}): { match: Match; live: boolean } {
  if (opts.live && normalizeSport(opts.live.sport) === opts.sport) {
    return { match: { ...opts.live, homeTeam: opts.home, awayTeam: opts.away, sport: opts.sport }, live: true };
  }
  return { match: sportPreviewMatch(opts.home, opts.away, opts.sport), live: false };
}

/** Geen klok of extra tijd bij sporten die dat niet kennen, net als op het stadionscherm. */
export function themeForPreviewSport(theme: ResolvedScoreboardTheme, sport: SportType): ResolvedScoreboardTheme {
  return {
    ...theme,
    showClock: resolveDisplayShowClock(sport, theme.showClock),
    fullShowAddedTime: getSportProfile(sport).supportsInjuryTime ? theme.fullShowAddedTime : false,
  };
}
