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

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const num = Number(v);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

export function normalizeVolleyballFormat(raw: Partial<VolleyballFormat> | null | undefined): VolleyballFormat {
  const d = DEFAULT_VOLLEYBALL_FORMAT;
  return {
    setsToWin: clampInt(raw?.setsToWin, d.setsToWin, 1, 5),
    pointsToWinSet: clampInt(raw?.pointsToWinSet, d.pointsToWinSet, 5, 99),
    pointsToWinDecider: clampInt(raw?.pointsToWinDecider, d.pointsToWinDecider, 5, 99),
    winBy: clampInt(raw?.winBy, d.winBy, 1, 5),
  };
}

/** Totaal aantal sets dat maximaal gespeeld wordt (best-of). */
export function volleyballMaxSets(format: Pick<VolleyballFormat, "setsToWin">): number {
  return format.setsToWin * 2 - 1;
}

export const VOLLEYBALL_TIMEOUTS_PER_SET = 2;
export const VOLLEYBALL_TIMEOUT_DURATION_SEC = 30;
export const VOLLEYBALL_TTO_DURATION_SEC = 60;
export const VOLLEYBALL_SET_BREAK_SEC = 3 * 60;

export type VolleyballMatchRules = VolleyballFormat & {
  technicalTimeoutsEnabled: boolean;
  technicalTimeoutScores: number[];
  technicalTimeoutDurationSec: number;
  timeoutsPerSet: number;
  timeoutDurationSec: number;
  setBreakSec: number;
};

export type VolleyballPresetId =
  | "indoor"
  | "indoor_tto"
  | "best_of_3"
  | "beach"
  | "youth_21"
  | "italy_serie_a_men"
  | "custom";

export const DEFAULT_VOLLEYBALL_RULES: VolleyballMatchRules = {
  ...DEFAULT_VOLLEYBALL_FORMAT,
  technicalTimeoutsEnabled: false,
  technicalTimeoutScores: [...VOLLEYBALL_TTO_SCORES],
  technicalTimeoutDurationSec: VOLLEYBALL_TTO_DURATION_SEC,
  timeoutsPerSet: VOLLEYBALL_TIMEOUTS_PER_SET,
  timeoutDurationSec: VOLLEYBALL_TIMEOUT_DURATION_SEC,
  setBreakSec: VOLLEYBALL_SET_BREAK_SEC,
};

export const VOLLEYBALL_PRESETS: Record<Exclude<VolleyballPresetId, "custom">, VolleyballMatchRules> = {
  indoor: { ...DEFAULT_VOLLEYBALL_RULES },
  indoor_tto: {
    ...DEFAULT_VOLLEYBALL_RULES,
    technicalTimeoutsEnabled: true,
    technicalTimeoutScores: [8, 16],
    technicalTimeoutDurationSec: 60,
  },
  best_of_3: {
    ...DEFAULT_VOLLEYBALL_RULES,
    setsToWin: 2,
  },
  beach: {
    ...DEFAULT_VOLLEYBALL_RULES,
    setsToWin: 2,
    pointsToWinSet: 21,
    pointsToWinDecider: 15,
    timeoutsPerSet: 1,
    timeoutDurationSec: 30,
    setBreakSec: 60,
  },
  youth_21: {
    ...DEFAULT_VOLLEYBALL_RULES,
    setsToWin: 2,
    pointsToWinSet: 21,
    pointsToWinDecider: 15,
    timeoutsPerSet: 2,
    timeoutDurationSec: 30,
    setBreakSec: 120,
  },
  italy_serie_a_men: {
    ...DEFAULT_VOLLEYBALL_RULES,
    setBreakSec: 120,
  },
};

export function parseTechnicalTimeoutScores(raw: unknown): number[] {
  let value = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      value = JSON.parse(trimmed);
    } catch {
      value = trimmed.split(/[,;/]+/);
    }
    if (!Array.isArray(value)) {
      value = trimmed.split(/[,;/]+/);
    }
  }
  if (!Array.isArray(value)) return [...VOLLEYBALL_TTO_SCORES];
  const scores = new Set<number>();
  for (const item of value) {
    const n = clampInt(item, 0, 1, 40);
    if (n > 0) scores.add(n);
  }
  return [...scores].sort((a, b) => a - b);
}

export const VOLLEYBALL_PRESET_IDS: Exclude<VolleyballPresetId, "custom">[] = [
  "indoor",
  "indoor_tto",
  "best_of_3",
  "beach",
  "youth_21",
  "italy_serie_a_men",
];

export function formatTechnicalTimeoutScores(scores: number[]): string {
  return scores.join(", ");
}

export function normalizeVolleyballMatchRules(
  raw: Partial<Omit<VolleyballMatchRules, "technicalTimeoutScores">> & {
    technicalTimeoutScores?: unknown;
    technicalTimeoutScoresJson?: string | null;
    halfBreakSec?: number | null;
  } | null | undefined,
): VolleyballMatchRules {
  const d = DEFAULT_VOLLEYBALL_RULES;
  const format = normalizeVolleyballFormat(raw);
  const scoresRaw =
    raw?.technicalTimeoutScores ??
    (raw && "technicalTimeoutScoresJson" in raw ? raw.technicalTimeoutScoresJson : undefined);
  const scores = parseTechnicalTimeoutScores(
    scoresRaw === undefined ? d.technicalTimeoutScores : scoresRaw,
  );
  return {
    ...format,
    technicalTimeoutsEnabled: raw?.technicalTimeoutsEnabled === true,
    technicalTimeoutScores: scores,
    technicalTimeoutDurationSec: clampInt(
      raw?.technicalTimeoutDurationSec,
      d.technicalTimeoutDurationSec,
      5,
      180,
    ),
    timeoutsPerSet: clampInt(raw?.timeoutsPerSet, d.timeoutsPerSet, 0, 6),
    timeoutDurationSec: clampInt(raw?.timeoutDurationSec, d.timeoutDurationSec, 5, 180),
    setBreakSec: clampInt(raw?.setBreakSec ?? raw?.halfBreakSec, d.setBreakSec, 30, 600),
  };
}

export function matchVolleyballPresetId(rules: VolleyballMatchRules): VolleyballPresetId {
  const keys = Object.keys(VOLLEYBALL_PRESETS) as Exclude<VolleyballPresetId, "custom">[];
  for (const id of keys) {
    const preset = VOLLEYBALL_PRESETS[id];
    if (
      preset.setsToWin === rules.setsToWin &&
      preset.pointsToWinSet === rules.pointsToWinSet &&
      preset.pointsToWinDecider === rules.pointsToWinDecider &&
      preset.winBy === rules.winBy &&
      preset.technicalTimeoutsEnabled === rules.technicalTimeoutsEnabled &&
      preset.technicalTimeoutDurationSec === rules.technicalTimeoutDurationSec &&
      preset.timeoutsPerSet === rules.timeoutsPerSet &&
      preset.timeoutDurationSec === rules.timeoutDurationSec &&
      preset.setBreakSec === rules.setBreakSec &&
      JSON.stringify(preset.technicalTimeoutScores) === JSON.stringify(rules.technicalTimeoutScores)
    ) {
      return id;
    }
  }
  return "custom";
}

export function volleyballRulesFromMatch(match: {
  setsToWin?: number | null;
  pointsToWinSet?: number | null;
  pointsToWinDecider?: number | null;
  winBy?: number | null;
  technicalTimeoutsEnabled?: boolean | null;
  technicalTimeoutScores?: number[] | null;
  technicalTimeoutScoresJson?: string | null;
  technicalTimeoutDurationSec?: number | null;
  timeoutsPerSet?: number | null;
  timeoutDurationSec?: number | null;
  halfBreakSec?: number | null;
}): VolleyballMatchRules {
  return normalizeVolleyballMatchRules({
    setsToWin: match.setsToWin ?? undefined,
    pointsToWinSet: match.pointsToWinSet ?? undefined,
    pointsToWinDecider: match.pointsToWinDecider ?? undefined,
    winBy: match.winBy ?? undefined,
    technicalTimeoutsEnabled: match.technicalTimeoutsEnabled === true,
    technicalTimeoutScores: match.technicalTimeoutScores ?? undefined,
    technicalTimeoutScoresJson: match.technicalTimeoutScoresJson,
    technicalTimeoutDurationSec: match.technicalTimeoutDurationSec ?? undefined,
    timeoutsPerSet: match.timeoutsPerSet ?? undefined,
    timeoutDurationSec: match.timeoutDurationSec ?? undefined,
    setBreakSec: match.halfBreakSec ?? undefined,
  });
}

export function shouldTriggerTechnicalTimeout(opts: {
  enabled: boolean;
  scores: number[];
  period: number;
  maxSets: number;
  scored: number;
  other: number;
}): boolean {
  if (!opts.enabled || opts.scores.length === 0) return false;
  if (opts.period >= opts.maxSets) return false;
  return opts.scores.some((score) => opts.scored === score && opts.other < score);
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

export function coerceSide(value: unknown, fallback: Side = "home"): Side {
  return value === "away" || value === "home" ? value : fallback;
}

/**
 * Service na het terugdraaien van de laatste rally: de laatste scorer in de
 * resterende rally-lijst (of de eerste server van de set als die lijst leeg is).
 * `null` = dit −1 was niet de laatste rally; service niet aanpassen.
 */
export function servingAfterRemovingLastRally(
  rallyWinners: Side[],
  undoneSide: Side,
  setFirstServer: Side,
): Side | null {
  if (rallyWinners.length === 0) return null;
  if (rallyWinners[rallyWinners.length - 1] !== undoneSide) return null;
  const remaining = rallyWinners.slice(0, -1);
  return remaining.length > 0 ? remaining[remaining.length - 1]! : setFirstServer;
}

export type VolleyballEventLike = {
  type: string;
  period?: number | null;
  teamId?: string | null;
  metaJson?: string | null;
};

/** Rally-winnaars van de huidige set, inclusief later gelogde −1-correcties. */
export function rallyWinnersFromEvents(
  events: VolleyballEventLike[],
  match: { currentPeriod: number; homeTeamId: string; awayTeamId: string },
): Side[] {
  const sides: Side[] = [];
  for (const ev of events) {
    if (ev.type !== "POINT" && ev.type !== "SET_WON" && ev.type !== "TECHNICAL_TIMEOUT") continue;
    if (ev.period != null && ev.period !== match.currentPeriod) continue;
    let meta: Record<string, unknown> = {};
    if (ev.metaJson) {
      try {
        const parsed = JSON.parse(ev.metaJson) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          meta = parsed as Record<string, unknown>;
        }
      } catch {
        meta = {};
      }
    }
    // Alleen echte rally-punten (volleybal-scorelog), geen handmatige TTO-klok.
    if (meta.sport !== "VOLLEYBALL" && typeof meta.delta !== "number") continue;
    const delta = typeof meta.delta === "number" ? meta.delta : 1;
    const side: Side | null =
      meta.side === "home" || meta.side === "away"
        ? meta.side
        : ev.teamId === match.homeTeamId
          ? "home"
          : ev.teamId === match.awayTeamId
            ? "away"
            : null;
    if (!side) continue;
    if (delta > 0) sides.push(side);
    else if (delta < 0 && sides.length > 0 && sides[sides.length - 1] === side) sides.pop();
  }
  return sides;
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
  opts?: {
    technicalTimeoutsEnabled?: boolean;
    technicalTimeoutScores?: number[] | string | null;
    format?: Partial<VolleyballFormat> | null;
    /** Rally-winnaars van de huidige set (voor serviceherstel bij −1). */
    rallyWinnersInSet?: Side[];
  },
): VolleyballApplyResult {
  const format = normalizeVolleyballFormat(opts?.format);
  const next = liveCopy(live);
  next.setFirstServer = coerceSide(next.setFirstServer, next.servingSide);
  next.servingSide = coerceSide(next.servingSide, next.setFirstServer);
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
    const restored = servingAfterRemovingLastRally(
      opts?.rallyWinnersInSet ?? [],
      side,
      next.setFirstServer,
    );
    if (restored) next.servingSide = restored;
    return result(next, format, { technicalTimeout: false, setJustWon: false });
  }

  if (finished(next, format)) {
    return result(next, format, {
      technicalTimeout: false,
      setJustWon: false,
      rejected: "match_over",
    });
  }

  // Eerste rally van de set (of na setbreak): status terug naar live.
  if (next.status === "HALF_TIME") {
    next.status = lifecycleStatusForPeriod("VOLLEYBALL", next.currentPeriod);
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
      // Setbreak tot de operator hervat of het eerste punt van de volgende set valt.
      next.status = "HALF_TIME";
      // FIVB 12.3.1: het team dat de vorige set niet als eerste serveerde, serveert nu eerst.
      // In de beslissende set beslist de toss; de operator past dat zo nodig aan via serve-knop.
      next.setFirstServer = opposite(next.setFirstServer);
      next.servingSide = next.setFirstServer;
    }
    return result(next, format, { technicalTimeout: false, setJustWon: true });
  }

  const scored = side === "home" ? next.homeScore : next.awayScore;
  const other = side === "home" ? next.awayScore : next.homeScore;
  const technicalTimeout = shouldTriggerTechnicalTimeout({
    enabled: opts?.technicalTimeoutsEnabled === true,
    scores: parseTechnicalTimeoutScores(opts?.technicalTimeoutScores ?? VOLLEYBALL_TTO_SCORES),
    period: next.currentPeriod,
    maxSets: volleyballMaxSets(format),
    scored,
    other,
  });
  return result(next, format, { technicalTimeout, setJustWon: false });
}
