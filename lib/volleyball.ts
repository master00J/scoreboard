import { lifecycleStatusForPeriod } from "./sports";

export type Side = "home" | "away";

export type SetScore = {
  home: number;
  away: number;
  /** Team dat in deze set als eerste serveerde (nodig om de servicewissel per set terug te draaien). */
  firstServer?: Side;
};

export type VolleyballFormat = {
  /** Gewonnen sets nodig voor matchwinst (3 = best-of-5, 2 = best-of-3). */
  setsToWin: number;
  /** Punten in een reguliere set (25 zaal, 21 beach). */
  pointsToWinSet: number;
  /** Punten in de beslissende set (15). */
  pointsToWinDecider: number;
  winBy: number;
};

export type VolleyballLive = {
  currentPeriod: number;
  homeScore: number;
  awayScore: number;
  homeSets: number;
  awaySets: number;
  servingSide: Side;
  /** Team dat de huidige set als eerste serveert (FIVB 12.3.1). */
  setFirstServer: Side;
  setHistory: SetScore[];
  homeTimeouts: number;
  awayTimeouts: number;
  status: string;
};

export type VolleyballApplyResult = VolleyballLive & {
  technicalTimeout: boolean;
  setJustWon: boolean;
  matchOver: boolean;
  /** Geen wijziging toegepast (bv. punt na het einde van de wedstrijd). */
  rejected: string | null;
};

export const VOLLEYBALL_SETS_TO_WIN = 3;
export const VOLLEYBALL_PERIOD_COUNT = 5;
export const VOLLEYBALL_POINTS_REGULAR = 25;
export const VOLLEYBALL_POINTS_DECIDER = 15;
export const VOLLEYBALL_WIN_BY = 2;
export const VOLLEYBALL_TTO_SCORES = [8, 16] as const;

export const DEFAULT_VOLLEYBALL_FORMAT: VolleyballFormat = {
  setsToWin: VOLLEYBALL_SETS_TO_WIN,
  pointsToWinSet: VOLLEYBALL_POINTS_REGULAR,
  pointsToWinDecider: VOLLEYBALL_POINTS_DECIDER,
  winBy: VOLLEYBALL_WIN_BY,
};

export function normalizeVolleyballFormat(raw: Partial<VolleyballFormat> | null | undefined): VolleyballFormat {
  const d = DEFAULT_VOLLEYBALL_FORMAT;
  const n = (v: unknown, fallback: number, min: number, max: number) => {
    const num = Number(v);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(num)));
  };
  return {
    setsToWin: n(raw?.setsToWin, d.setsToWin, 1, 5),
    pointsToWinSet: n(raw?.pointsToWinSet, d.pointsToWinSet, 5, 99),
    pointsToWinDecider: n(raw?.pointsToWinDecider, d.pointsToWinDecider, 5, 99),
    winBy: n(raw?.winBy, d.winBy, 1, 5),
  };
}

/** Totaal aantal sets dat maximaal gespeeld wordt (best-of). */
export function volleyballMaxSets(format: VolleyballFormat): number {
  return format.setsToWin * 2 - 1;
}

export function volleyballTarget(period: number, format: VolleyballFormat = DEFAULT_VOLLEYBALL_FORMAT): number {
  return period >= volleyballMaxSets(format) ? format.pointsToWinDecider : format.pointsToWinSet;
}

export function volleyballSetWinner(
  home: number,
  away: number,
  target: number,
  winBy = VOLLEYBALL_WIN_BY,
): Side | null {
  if (home >= target && home - away >= winBy) return "home";
  if (away >= target && away - home >= winBy) return "away";
  return null;
}

export function parseSetHistory(raw: unknown): SetScore[] {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: SetScore[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const home = Number((row as { home?: unknown }).home);
    const away = Number((row as { away?: unknown }).away);
    if (!Number.isFinite(home) || !Number.isFinite(away)) continue;
    const firstServerRaw = (row as { firstServer?: unknown }).firstServer;
    const entry: SetScore = { home: Math.max(0, Math.floor(home)), away: Math.max(0, Math.floor(away)) };
    if (firstServerRaw === "home" || firstServerRaw === "away") entry.firstServer = firstServerRaw;
    out.push(entry);
  }
  return out;
}

export function normalizeServingSide(value: unknown, fallback: Side = "home"): Side {
  return String(value ?? "").toLowerCase() === "away" ? "away" : fallback;
}

export function formatSetHistory(history: SetScore[]): string {
  if (history.length === 0) return "";
  return history.map((set) => `${set.home}–${set.away}`).join("  ");
}

export function opposite(side: Side): Side {
  return side === "home" ? "away" : "home";
}

function liveCopy(live: VolleyballLive): VolleyballLive {
  return {
    ...live,
    setHistory: live.setHistory.map((s) => ({ ...s })),
  };
}

function finished(live: VolleyballLive, format: VolleyballFormat): boolean {
  return live.homeSets >= format.setsToWin || live.awaySets >= format.setsToWin;
}

function result(
  live: VolleyballLive,
  format: VolleyballFormat,
  extras: { technicalTimeout: boolean; setJustWon: boolean; rejected?: string | null },
): VolleyballApplyResult {
  const matchOver = finished(live, format);
  return {
    ...live,
    technicalTimeout: extras.technicalTimeout,
    setJustWon: extras.setJustWon,
    rejected: extras.rejected ?? null,
    matchOver,
    status: matchOver ? "FULL_TIME" : live.status,
  };
}

/**
 * Rally scoring: +1 wint de rally (service wisselt mee).
 * Bij 0–0 in een nieuwe set maakt −1 de vorige setwinst ongedaan.
 * Na de matchwinst worden punten geweigerd; −1 heropent de laatste set.
 */
export function applyVolleyballScoreDelta(
  live: VolleyballLive,
  side: Side,
  delta: number,
  opts?: { technicalTimeoutsEnabled?: boolean; format?: Partial<VolleyballFormat> | null },
): VolleyballApplyResult {
  const format = normalizeVolleyballFormat(opts?.format);
  const next = liveCopy(live);
  const step = Math.trunc(delta);
  if (step === 0) {
    return result(next, format, { technicalTimeout: false, setJustWon: false });
  }

  if (step < 0) {
    if (next.homeScore === 0 && next.awayScore === 0 && next.setHistory.length > 0) {
      const last = next.setHistory.pop()!;
      const winner: Side = last.home > last.away ? "home" : "away";
      if (winner === "home") next.homeSets = Math.max(0, next.homeSets - 1);
      else next.awaySets = Math.max(0, next.awaySets - 1);
      next.homeScore = winner === "home" ? Math.max(0, last.home - 1) : last.home;
      next.awayScore = winner === "away" ? Math.max(0, last.away - 1) : last.away;
      next.currentPeriod = Math.max(1, next.setHistory.length + 1);
      next.status = lifecycleStatusForPeriod("VOLLEYBALL", next.currentPeriod);
      // De laatste rally van die set ging naar de winnaar; die had dus de service.
      next.servingSide = winner;
      next.setFirstServer = last.firstServer ?? opposite(next.setFirstServer);
      return result(next, format, { technicalTimeout: false, setJustWon: false });
    }
    if (side === "home") next.homeScore = Math.max(0, next.homeScore + step);
    else next.awayScore = Math.max(0, next.awayScore + step);
    return result(next, format, { technicalTimeout: false, setJustWon: false });
  }

  if (finished(next, format)) {
    return result(next, format, {
      technicalTimeout: false,
      setJustWon: false,
      rejected: "match_over",
    });
  }

  if (side === "home") next.homeScore += step;
  else next.awayScore += step;
  next.servingSide = side;

  const winner = volleyballSetWinner(
    next.homeScore,
    next.awayScore,
    volleyballTarget(next.currentPeriod, format),
    format.winBy,
  );
  if (winner) {
    next.setHistory.push({
      home: next.homeScore,
      away: next.awayScore,
      firstServer: next.setFirstServer,
    });
    if (winner === "home") next.homeSets += 1;
    else next.awaySets += 1;
    next.homeScore = 0;
    next.awayScore = 0;
    next.homeTimeouts = 0;
    next.awayTimeouts = 0;
    const matchOver = finished(next, format);
    if (matchOver) {
      next.status = "FULL_TIME";
    } else {
      next.currentPeriod = Math.min(volleyballMaxSets(format), next.currentPeriod + 1);
      next.status = lifecycleStatusForPeriod("VOLLEYBALL", next.currentPeriod);
      // FIVB 12.3.1: het team dat de vorige set niet als eerste serveerde, serveert nu eerst.
      // In de beslissende set beslist de toss; de operator past dat zo nodig aan via serve-knop.
      next.setFirstServer = opposite(next.setFirstServer);
      next.servingSide = next.setFirstServer;
    }
    return result(next, format, { technicalTimeout: false, setJustWon: true });
  }

  const ttoEnabled = opts?.technicalTimeoutsEnabled === true;
  const scored = side === "home" ? next.homeScore : next.awayScore;
  const other = side === "home" ? next.awayScore : next.homeScore;
  const technicalTimeout =
    ttoEnabled &&
    next.currentPeriod < volleyballMaxSets(format) &&
    VOLLEYBALL_TTO_SCORES.some((score) => scored === score && other < score);
  return result(next, format, { technicalTimeout, setJustWon: false });
}
