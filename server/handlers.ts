import path from "path";
import type { DisplayState, Match } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { Db } from "./db";
import type { Command } from "../lib/validation/commands";
import { programmedDisplayMode } from "../lib/live-cycle-settings";
import {
  captureOnBlackoutEnter,
  captureOnBlackoutExit,
} from "../lib/external-capture-blackout";
import {
  clearTimeoutClock,
  computeElapsedSeconds,
  computePenaltySeconds,
  computeShotClockSeconds,
  computeTimeoutSeconds,
  pausePenaltyAt,
  pauseShotClockAt,
  penaltyStateFor,
  runFrom,
  runPenaltyFrom,
  runShotClockFrom,
  runTimeoutFrom,
  stopAt,
  type TimeoutSide,
} from "../lib/timer";
import {
  getSportProfile,
  isOvertimePeriod,
  lifecycleStatusForPeriod,
  normalizeSport,
  periodDurationSecFor,
  periodForLifecycleStatus,
  resetStatsForNewPeriod,
  resetTimeoutsForNewPeriod,
  sportClockSeconds,
  sportMaxPeriod,
  sportPeriodLabel,
  type SportProfile,
} from "../lib/sports";
import {
  applyVolleyballScoreDelta,
  normalizeServingSide,
  normalizeVolleyballFormat,
  parseSetHistory,
  rallyWinnersFromEvents,
  type Side,
  type VolleyballLive,
} from "../lib/volleyball";
import type { SubPair } from "./match-lineup";
import {
  applySubToFieldRoster,
  ensureDefaultMatchFieldLineups,
  validateSubPairAgainstField,
  validateSubPairsSequential,
} from "./match-lineup";

export type CommandResult = { ok: true; warning?: string; result?: unknown } | { ok: false; error: string };

type StateUpdate = Parameters<Db["displayState"]["update"]>[0]["data"];
type MatchUpdate = Parameters<Db["match"]["update"]>[0]["data"];

const TECHNICAL_TIMEOUT_SEC = 60;

async function getState(db: Db): Promise<DisplayState> {
  const s = await db.displayState.findUnique({ where: { id: 1 } });
  if (!s) {
    return db.displayState.create({ data: { id: 1, mode: "IDLE" } });
  }
  // Veilige modus is verwijderd; oude DB-vlag altijd uitzetten.
  if (s.safeMode) {
    return db.displayState.update({ where: { id: 1 }, data: { safeMode: false } });
  }
  return s;
}

async function updateState(db: Db, data: StateUpdate): Promise<DisplayState> {
  return db.displayState.update({ where: { id: 1 }, data });
}

async function requireActiveMatch(db: Db, s: DisplayState): Promise<Match> {
  if (!s.matchId) throw new Error("No active match");
  const match = await db.match.findUnique({ where: { id: s.matchId } });
  if (!match) throw new Error("Match not found");
  return match;
}

async function activeMatchOrNull(db: Db, s: DisplayState): Promise<Match | null> {
  if (!s.matchId) return null;
  return db.match.findUnique({ where: { id: s.matchId } });
}

async function goalVisualEnabledForSide(db: Db, side: "home" | "away"): Promise<boolean> {
  const column = side === "home" ? "goalVisualHomeEnabled" : "goalVisualAwayEnabled";
  try {
    const rows = await db.$queryRawUnsafe<Array<{ enabled: boolean | number | null }>>(
      `SELECT "${column}" AS enabled FROM "AppSettings" WHERE "id" = 1`,
    );
    const value = rows[0]?.enabled;
    if (value == null) return side === "home";
    return Boolean(value);
  } catch {
    return side === "home";
  }
}

/**
 * Zorgt dat een VIDEO MediaItem bestaat voor dit bestandspad (nodig voor goalIntroVideoPath / goalVideoPath),
 * zodat het display via activeMediaId + /api/media kan laden.
 */
async function ensureMediaItemForVideoPath(
  db: Db,
  filePath: string,
  titleHint: string,
  options?: { hideFromLibrary?: boolean },
): Promise<string | null> {
  const trimmed = filePath.trim();
  if (!trimmed) return null;
  const existing = await db.mediaItem.findFirst({ where: { path: trimmed } });
  if (existing) {
    if (options?.hideFromLibrary && !existing.hideFromLibrary) {
      await db.mediaItem.update({
        where: { id: existing.id },
        data: { hideFromLibrary: true },
      });
    }
    return existing.id;
  }
  const base = path.basename(trimmed.replace(/[/\\]+$/, "")) || titleHint;
  const created = await db.mediaItem.create({
    data: {
      type: "VIDEO",
      path: trimmed,
      title: `${titleHint}: ${base}`,
      durationSec: 15,
      active: true,
      hideFromLibrary: options?.hideFromLibrary ?? false,
    },
  });
  return created.id;
}

function parseSubQueue(raw: string | null | undefined): SubPair[] {
  if (!raw || raw === "[]") return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x): x is SubPair =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as SubPair).teamId === "string" &&
        typeof (x as SubPair).playerOutId === "string" &&
        typeof (x as SubPair).playerInId === "string",
    );
  } catch {
    return [];
  }
}

async function validateSubPair(db: Db, matchId: string, pair: SubPair) {
  const m = await db.match.findUnique({
    where: { id: matchId },
    include: {
      homeTeam: { include: { players: true } },
      awayTeam: { include: { players: true } },
    },
  });
  if (!m) throw new Error("Match not found");
  const team =
    pair.teamId === m.homeTeamId ? m.homeTeam : pair.teamId === m.awayTeamId ? m.awayTeam : null;
  if (!team) throw new Error("Team hoort niet bij deze wedstrijd");
  const ids = new Set((team.players ?? []).map((p) => p.id));
  if (!ids.has(pair.playerInId) || !ids.has(pair.playerOutId)) {
    throw new Error("Speler hoort niet bij het gekozen team");
  }
  if (pair.playerInId === pair.playerOutId) {
    throw new Error("Zelfde speler kan niet in- en uitwisselen");
  }
}

/* ------------------------------------------------------------------ */
/* Eventlog                                                            */
/* ------------------------------------------------------------------ */

type EventMeta = Record<string, unknown>;

type EventClockContext = {
  period: number;
  clockSec: number;
  minute: number;
};

/** Periode + klokstand (zoals op het scorebord) voor de eventlog. */
function eventClockContext(s: DisplayState, match: Match | null, now = Date.now()): EventClockContext {
  const elapsed = computeElapsedSeconds(s, now);
  if (!match) return { period: 1, clockSec: elapsed, minute: Math.floor(elapsed / 60) };
  return {
    period: match.currentPeriod,
    clockSec: sportClockSeconds(match.sport, elapsed, match.periodDurationSec, match.currentPeriod),
    minute: Math.floor(elapsed / 60),
  };
}

async function logMatchEvent(
  db: Db,
  matchId: string,
  payload: {
    type: string;
    minute: number;
    addedTime?: number;
    period?: number;
    clockSec?: number;
    meta?: EventMeta;
    teamId?: string;
    playerInId?: string;
    playerOutId?: string;
    note?: string;
  },
) {
  return db.matchEvent.create({
    data: {
      matchId,
      type: payload.type,
      minute: payload.minute,
      addedTime: payload.addedTime ?? 0,
      period: payload.period,
      clockSec: payload.clockSec,
      metaJson: payload.meta ? JSON.stringify(payload.meta) : undefined,
      teamId: payload.teamId,
      playerInId: payload.playerInId,
      playerOutId: payload.playerOutId,
      note: payload.note,
    },
  });
}

function parseEventMeta(raw: string | null | undefined): EventMeta {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as EventMeta) : {};
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/* Klokhulpen                                                           */
/* ------------------------------------------------------------------ */

/** Wedstrijdklok pauzeren: shotclock stopt mee, straftijd alleen als de sport dat vraagt. */
function pauseClocksWithTimer(s: DisplayState, profile: SportProfile | null, now = Date.now()): StateUpdate {
  const data: StateUpdate = {
    ...stopAt(computeElapsedSeconds(s, now)),
    ...(s.shotClockRunning ? pauseShotClockAt(computeShotClockSeconds(s, now)) : {}),
  };
  if (profile?.penaltyFollowsClock) {
    if (s.homePenaltyRunning) {
      Object.assign(data, pausePenaltyAt("home", computePenaltySeconds(penaltyStateFor(s, "home"), now)));
    }
    if (s.awayPenaltyRunning) {
      Object.assign(data, pausePenaltyAt("away", computePenaltySeconds(penaltyStateFor(s, "away"), now)));
    }
  }
  return data;
}

/** Wedstrijdklok starten: straftijd die nog rest loopt mee (hockey). */
function resumePenaltiesWithTimer(s: DisplayState, profile: SportProfile | null, now: Date): StateUpdate {
  if (!profile?.penaltyFollowsClock) return {};
  const data: StateUpdate = {};
  for (const side of ["home", "away"] as const) {
    const st = penaltyStateFor(s, side);
    if (!st.running && st.baseSec > 0) {
      Object.assign(data, runPenaltyFrom(side, st.baseSec, now));
    }
  }
  return data;
}

/** Behoud een live-modus (scorebord of scorebord + sponsors); overlays vallen terug op MATCH. */
function liveModeAfterPeriodChange(mode: string): string {
  return mode === "SPONSOR_ROTATION" || mode === "MATCH" ? mode : "MATCH";
}

/** Klokstand (verstreken s) bij het begin van een periode. */
function periodStartElapsedSec(profile: SportProfile, match: Match, period: number): number {
  if (profile.timerMode !== "COUNT_UP") return 0;
  const regular = periodDurationSecFor(match.sport, 1, match.periodDurationSec);
  if (period <= profile.periodCount) return Math.max(0, (period - 1) * regular);
  const otIndex = period - profile.periodCount;
  return Math.max(0, profile.periodCount * regular + (otIndex - 1) * profile.overtimeDurationSec);
}

/**
 * Eén pad voor elke periodewissel (voetbal-presets, quarter/set-knoppen, mobiel): stand, time-outs,
 * fouten, klok, shotclock en time-outklok worden consistent gezet.
 */
async function applyPeriodChange(
  db: Db,
  s: DisplayState,
  match: Match,
  nextPeriod: number,
  opts?: { status?: string; logNote?: string },
): Promise<void> {
  const sport = normalizeSport(match.sport);
  const profile = getSportProfile(sport);
  if (nextPeriod < 1 || nextPeriod > sportMaxPeriod(sport)) {
    const ot = profile.overtimeDurationSec > 0 ? ` (+${profile.maxOvertimePeriods} verlenging)` : "";
    throw new Error(`${profile.label} heeft ${profile.periodCount} reguliere periodes${ot}.`);
  }
  if (isOvertimePeriod(sport, nextPeriod) && profile.overtimeDurationSec <= 0) {
    throw new Error(`${profile.label} kent geen verlenging.`);
  }

  const data: MatchUpdate = {
    currentPeriod: nextPeriod,
    status: opts?.status ?? lifecycleStatusForPeriod(sport, nextPeriod),
  };
  if (resetTimeoutsForNewPeriod(sport, match.currentPeriod, nextPeriod)) {
    data.homeTimeouts = 0;
    data.awayTimeouts = 0;
  }
  if (resetStatsForNewPeriod(sport, match.currentPeriod, nextPeriod)) {
    data.homeFouls = 0;
    data.awayFouls = 0;
  }
  if (profile.hasSets && nextPeriod !== match.currentPeriod) {
    if (match.homeScore !== 0 || match.awayScore !== 0) {
      throw new Error("Sluit de set via de punten (of −1). De setknop springt niet midden in een set.");
    }
    data.homeScore = 0;
    data.awayScore = 0;
  }
  await db.match.update({ where: { id: match.id }, data });

  await updateState(db, {
    ...stopAt(periodStartElapsedSec(profile, match, nextPeriod)),
    ...pauseShotClockAt(profile.shotClockPresets[0] ?? 0),
    ...clearTimeoutClock(),
    mode: liveModeAfterPeriodChange(s.mode),
    addedTimeMinutes: 0,
  });
  await logMatchEvent(db, match.id, {
    type: "PERIOD",
    minute: 0,
    period: nextPeriod,
    clockSec: sportClockSeconds(sport, periodStartElapsedSec(profile, match, nextPeriod), match.periodDurationSec, nextPeriod),
    note: opts?.logNote ?? sportPeriodLabel(sport, nextPeriod),
  });
}

function currentMinute(elapsedSec: number) {
  return Math.floor(elapsedSec / 60);
}

async function defaultResumeModeAfterBlackout(db: Db, matchId: string | null): Promise<string> {
  if (!matchId) return "IDLE";
  const m = await db.match.findUnique({
    where: { id: matchId },
    select: { status: true },
  });
  if (!m) return "IDLE";
  return programmedDisplayMode({ matchStatus: m.status });
}

/* ------------------------------------------------------------------ */
/* Time-outs                                                            */
/* ------------------------------------------------------------------ */

async function startTimeoutClock(
  db: Db,
  s: DisplayState,
  match: Match,
  side: TimeoutSide,
  opts: { seconds?: number; countAgainstTeam: boolean },
): Promise<{ counted: boolean; from: number; to: number }> {
  const profile = getSportProfile(match.sport);
  const now = new Date();
  let counted = false;
  let from = 0;
  let to = 0;

  if (side !== "technical" && opts.countAgainstTeam) {
    const limit = profile.timeoutLimitForPeriod(match.currentPeriod);
    if (limit <= 0) throw new Error(`Time-outs zijn niet actief voor ${profile.label}.`);
    const column = side === "home" ? "homeTimeouts" : "awayTimeouts";
    from = match[column];
    if (from >= limit) {
      throw new Error(`Time-outlimiet bereikt (${limit}) voor deze periode.`);
    }
    to = from + 1;
    await db.match.update({ where: { id: match.id }, data: { [column]: to } });
    counted = true;
  }

  const seconds =
    opts.seconds ??
    (side === "technical" ? TECHNICAL_TIMEOUT_SEC : profile.timeoutDurationSec || TECHNICAL_TIMEOUT_SEC);

  // Een time-out betekent dode tijd: wedstrijdklok (en wat daaraan hangt) stopt.
  await updateState(db, {
    ...(s.timerRunning ? pauseClocksWithTimer(s, profile, now.getTime()) : {}),
    ...runTimeoutFrom(side, seconds, now),
  });

  const ctx = eventClockContext(s, match, now.getTime());
  await logMatchEvent(db, match.id, {
    type: side === "technical" ? "TECHNICAL_TIMEOUT" : "TIMEOUT",
    minute: ctx.minute,
    period: ctx.period,
    clockSec: ctx.clockSec,
    teamId: side === "home" ? match.homeTeamId : side === "away" ? match.awayTeamId : undefined,
    meta: counted ? { stat: "timeout", side, from, to, seconds } : { side, seconds },
    note: counted ? `${from} -> ${to}` : `${seconds}s`,
  });
  return { counted, from, to };
}

/* ------------------------------------------------------------------ */
/* Volleybal                                                            */
/* ------------------------------------------------------------------ */

function volleyballLiveFromMatch(m: Match): VolleyballLive {
  const servingSide = normalizeServingSide(m.servingSide);
  return {
    currentPeriod: m.currentPeriod,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    homeSets: m.homeSets,
    awaySets: m.awaySets,
    servingSide,
    setFirstServer: normalizeServingSide(m.setFirstServer, servingSide),
    setHistory: parseSetHistory(m.setHistoryJson),
    homeTimeouts: m.homeTimeouts,
    awayTimeouts: m.awayTimeouts,
    status: m.status,
  };
}

function volleyballFormatFromMatch(m: Match) {
  return normalizeVolleyballFormat({
    setsToWin: m.setsToWin,
    pointsToWinSet: m.pointsToWinSet,
    pointsToWinDecider: m.pointsToWinDecider,
  });
}

async function applyVolleyballDelta(
  db: Db,
  s: DisplayState,
  m: Match,
  side: Side,
  delta: number,
  opts?: { skipLog?: boolean },
): Promise<void> {
  const live = volleyballLiveFromMatch(m);
  let rallyWinnersInSet: Side[] | undefined;
  if (delta < 0 && !(m.homeScore === 0 && m.awayScore === 0)) {
    const events = await db.matchEvent.findMany({
      where: {
        matchId: m.id,
        type: { in: ["POINT", "SET_WON", "TECHNICAL_TIMEOUT"] },
        period: m.currentPeriod,
      },
      orderBy: { createdAt: "asc" },
      select: { type: true, period: true, teamId: true, metaJson: true },
    });
    rallyWinnersInSet = rallyWinnersFromEvents(events, m);
  }
  const next = applyVolleyballScoreDelta(live, side, delta, {
    technicalTimeoutsEnabled: m.technicalTimeoutsEnabled === true,
    format: volleyballFormatFromMatch(m),
    rallyWinnersInSet,
  });
  if (next.rejected === "match_over") {
    throw new Error("De wedstrijd is afgelopen (sets gewonnen). Gebruik −1 om de laatste set te heropenen.");
  }
  await db.match.update({
    where: { id: m.id },
    data: {
      homeScore: next.homeScore,
      awayScore: next.awayScore,
      homeSets: next.homeSets,
      awaySets: next.awaySets,
      currentPeriod: next.currentPeriod,
      servingSide: next.servingSide,
      setFirstServer: next.setFirstServer,
      setHistoryJson: JSON.stringify(next.setHistory),
      homeTimeouts: next.homeTimeouts,
      awayTimeouts: next.awayTimeouts,
      status: next.status,
    },
  });
  if (!opts?.skipLog) {
    const ctx = eventClockContext(s, m);
    await logMatchEvent(db, m.id, {
      type: next.setJustWon ? "SET_WON" : "POINT",
      minute: ctx.minute,
      period: m.currentPeriod,
      clockSec: 0,
      teamId: side === "home" ? m.homeTeamId : m.awayTeamId,
      meta: {
        side,
        delta,
        from: side === "home" ? m.homeScore : m.awayScore,
        sport: "VOLLEYBALL",
        ...(next.technicalTimeout ? { technicalTimeout: true } : {}),
      },
      note: next.setJustWon
        ? `set ${next.setHistory.length} ${next.setHistory[next.setHistory.length - 1]?.home}–${next.setHistory[next.setHistory.length - 1]?.away}`
        : next.technicalTimeout
          ? `tto ${next.homeScore}-${next.awayScore}`
          : `${side} ${delta > 0 ? "+" : ""}${delta} (${next.homeScore}-${next.awayScore})`,
    });
  }

  const stateData: StateUpdate = {
    mode: next.matchOver
      ? "FULLTIME"
      : next.setJustWon
        ? "HALFTIME"
        : s.mode === "HALFTIME"
          ? "MATCH"
          : s.mode === "FULLTIME" && !next.matchOver
            ? "MATCH"
            : s.mode,
  };
  if (next.setJustWon || delta < 0) Object.assign(stateData, clearTimeoutClock());
  if (next.technicalTimeout) {
    Object.assign(stateData, runTimeoutFrom("technical", TECHNICAL_TIMEOUT_SEC));
  }
  await updateState(db, stateData);
}

/* ------------------------------------------------------------------ */
/* Wissels                                                              */
/* ------------------------------------------------------------------ */

async function applySubstitutionPairs(db: Db, pairs: SubPair[]) {
  if (pairs.length === 0) return;
  const s = await getState(db);
  if (!s.matchId) throw new Error("No active match");
  await ensureDefaultMatchFieldLineups(s.matchId, db);

  for (const p of pairs) await validateSubPair(db, s.matchId, p);

  const queue = parseSubQueue(s.substitutionQueueJson);

  if (s.mode === "SUBSTITUTION") {
    const merged = [...queue, ...pairs];
    await validateSubPairsSequential(s.matchId, merged, db);
    await updateState(db, { substitutionQueueJson: JSON.stringify(merged) });
    return;
  }

  await validateSubPairsSequential(s.matchId, pairs, db);

  const match = await activeMatchOrNull(db, s);
  const ctx = eventClockContext(s, match);
  const [first, ...rest] = pairs;
  await logMatchEvent(db, s.matchId, {
    type: "SUB",
    minute: ctx.minute,
    period: ctx.period,
    clockSec: ctx.clockSec,
    teamId: first.teamId,
    playerInId: first.playerInId,
    playerOutId: first.playerOutId,
  });
  await updateState(db, {
    mode: "SUBSTITUTION",
    activeSubInId: first.playerInId,
    activeSubOutId: first.playerOutId,
    substitutionQueueJson: JSON.stringify(rest),
  });
  await applySubToFieldRoster(s.matchId, first, db);
}

/* ------------------------------------------------------------------ */
/* Commando's                                                           */
/* ------------------------------------------------------------------ */

export async function handleCommand(cmd: Command, db: Db = prisma): Promise<CommandResult> {
  switch (cmd.type) {
    case "timer:start": {
      const s = await getState(db);
      const match = await activeMatchOrNull(db, s);
      const profile = match ? getSportProfile(match.sport) : null;
      const now = new Date();
      const elapsed = computeElapsedSeconds(s, now.getTime());
      if (match && profile?.timerMode === "COUNT_DOWN") {
        const duration = periodDurationSecFor(match.sport, match.currentPeriod, match.periodDurationSec);
        if (duration > 0 && elapsed >= duration) {
          throw new Error("De periode is voorbij (00:00). Kies de volgende periode of stel de tijd in.");
        }
      }
      if (profile?.timerMode === "NONE") {
        throw new Error(`${profile.label} heeft geen wedstrijdklok.`);
      }
      await updateState(db, {
        ...runFrom(elapsed, now),
        ...resumePenaltiesWithTimer(s, profile, now),
        // Spel hervat = time-out voorbij.
        ...(s.timeoutRunning ? clearTimeoutClock() : {}),
      });
      return { ok: true };
    }
    case "timer:pause": {
      const s = await getState(db);
      const match = await activeMatchOrNull(db, s);
      const profile = match ? getSportProfile(match.sport) : null;
      await updateState(db, pauseClocksWithTimer(s, profile));
      return { ok: true };
    }
    case "timer:adjust":
    case "timer:set": {
      const s = await getState(db);
      const match = await activeMatchOrNull(db, s);
      const elapsed = computeElapsedSeconds(s);
      let target =
        cmd.type === "timer:adjust" ? Math.max(0, elapsed + cmd.deltaSec) : Math.max(0, cmd.seconds);
      if (match) {
        const profile = getSportProfile(match.sport);
        if (profile.timerMode === "COUNT_DOWN") {
          const duration = periodDurationSecFor(match.sport, match.currentPeriod, match.periodDurationSec);
          if (duration > 0) target = Math.min(target, duration);
        }
      }
      const reachedEnd =
        match &&
        getSportProfile(match.sport).timerMode === "COUNT_DOWN" &&
        target >= periodDurationSecFor(match.sport, match.currentPeriod, match.periodDurationSec);
      const next = s.timerRunning && !reachedEnd ? runFrom(target) : stopAt(target);
      await updateState(db, next);
      if (match) {
        const ctx = eventClockContext({ ...s, ...next } as DisplayState, match);
        await logMatchEvent(db, match.id, {
          type: "TIMER_ADJUST",
          minute: currentMinute(target),
          period: ctx.period,
          clockSec: ctx.clockSec,
          note:
            cmd.type === "timer:adjust"
              ? `${Math.floor(elapsed)}s -> ${Math.floor(target)}s (${cmd.deltaSec >= 0 ? "+" : ""}${cmd.deltaSec}s)`
              : `set to ${Math.floor(target)}s`,
        });
      }
      return { ok: true };
    }
    case "timer:preset": {
      const s = await getState(db);
      const match = await requireActiveMatch(db, s);
      const profile = getSportProfile(match.sport);
      if (profile.timerMode === "NONE") {
        throw new Error(`${profile.label} heeft geen wedstrijdklok.`);
      }
      const secondHalfStart = profile.periodCount <= 2 ? 2 : Math.ceil(profile.periodCount / 2) + 1;
      const target =
        cmd.preset === "FIRST_HALF"
          ? 1
          : cmd.preset === "SECOND_HALF"
            ? secondHalfStart
            : cmd.preset === "ET1"
              ? profile.periodCount + 1
              : profile.periodCount + 2;
      await applyPeriodChange(db, s, match, target);
      return { ok: true };
    }
    case "timer:setAddedTime": {
      await updateState(db, { addedTimeMinutes: cmd.minutes });
      return { ok: true };
    }
    case "shotclock:start": {
      const s = await getState(db);
      const match = await requireActiveMatch(db, s);
      const profile = getSportProfile(match.sport);
      if (profile.shotClockPresets.length === 0) {
        throw new Error(`Shotclock is niet beschikbaar voor ${profile.label}.`);
      }
      const remaining = computeShotClockSeconds(s);
      await updateState(
        db,
        runShotClockFrom(remaining > 0 ? remaining : profile.shotClockPresets[0]!),
      );
      return { ok: true };
    }
    case "shotclock:pause": {
      const s = await getState(db);
      await updateState(db, pauseShotClockAt(computeShotClockSeconds(s)));
      return { ok: true };
    }
    case "shotclock:reset": {
      const s = await getState(db);
      const match = await requireActiveMatch(db, s);
      const profile = getSportProfile(match.sport);
      const seconds = cmd.seconds ?? profile.shotClockPresets[0] ?? 24;
      if (!profile.shotClockPresets.includes(seconds)) {
        throw new Error(`Shotclock ${seconds}s is niet beschikbaar voor ${profile.label}.`);
      }
      await updateState(
        db,
        s.shotClockRunning ? runShotClockFrom(seconds) : pauseShotClockAt(seconds),
      );
      return { ok: true };
    }
    case "shotclock:set": {
      const s = await getState(db);
      await updateState(
        db,
        s.shotClockRunning
          ? runShotClockFrom(cmd.seconds)
          : pauseShotClockAt(cmd.seconds),
      );
      return { ok: true };
    }
    case "penalty:start": {
      const s = await getState(db);
      const match = await requireActiveMatch(db, s);
      const profile = getSportProfile(match.sport);
      if (profile.penaltyClockPresets.length === 0) {
        throw new Error(`Straftijd is niet actief voor ${profile.label}.`);
      }
      if (!profile.penaltyClockPresets.includes(cmd.seconds)) {
        throw new Error(`Straftijd ${cmd.seconds}s is niet beschikbaar voor ${profile.label}.`);
      }
      // Straftijd volgt de wedstrijdklok: staat die stil, dan start de straftijd pas mee bij "Start".
      const startsNow = !profile.penaltyFollowsClock || s.timerRunning;
      await updateState(
        db,
        startsNow ? runPenaltyFrom(cmd.side, cmd.seconds) : pausePenaltyAt(cmd.side, cmd.seconds),
      );
      return { ok: true };
    }
    case "penalty:pause": {
      const s = await getState(db);
      const remaining = computePenaltySeconds(penaltyStateFor(s, cmd.side));
      await updateState(db, pausePenaltyAt(cmd.side, remaining));
      return { ok: true };
    }
    case "penalty:clear": {
      await updateState(db, pausePenaltyAt(cmd.side, 0));
      return { ok: true };
    }
    case "timeout:start": {
      const s = await getState(db);
      const match = await requireActiveMatch(db, s);
      if (s.timeoutRunning && computeTimeoutSeconds(s) > 0) {
        throw new Error("Er loopt al een time-out. Beëindig die eerst.");
      }
      await startTimeoutClock(db, s, match, cmd.side, {
        seconds: cmd.seconds,
        countAgainstTeam: cmd.side !== "technical" && cmd.countAgainstTeam !== false,
      });
      return { ok: true };
    }
    case "timeout:clear": {
      await updateState(db, clearTimeoutClock());
      return { ok: true };
    }
    case "match:setActive": {
      let shotClockBaseSec = 0;
      if (cmd.matchId != null) {
        const m = await db.match.findUnique({
          where: { id: cmd.matchId },
          select: { closedAt: true, sport: true },
        });
        if (m?.closedAt) {
          throw new Error(
            "Deze wedstrijd is afgesloten (rapportage bewaard). Heropen in Setup → Matches of kies een andere wedstrijd.",
          );
        }
        shotClockBaseSec = getSportProfile(m?.sport).shotClockPresets[0] ?? 0;
      }
      await updateState(db, {
        matchId: cmd.matchId,
        addedTimeMinutes: 0,
        shotClockRunning: false,
        shotClockStartedAt: null,
        shotClockBaseSec,
        ...pausePenaltyAt("home", 0),
        ...pausePenaltyAt("away", 0),
        ...clearTimeoutClock(),
      });
      return { ok: true };
    }
    case "match:setStatus": {
      const s = await getState(db);
      const match = await activeMatchOrNull(db, s);
      if (match) {
        const data: MatchUpdate = { status: cmd.status };
        if (cmd.status === "FIRST_HALF" || cmd.status === "SECOND_HALF" || cmd.status === "EXTRA_TIME") {
          // Voetbalflow en mobiel sturen alleen een status: periode meezetten zodat het display klopt.
          const period = periodForLifecycleStatus(match.sport, cmd.status, match.currentPeriod);
          const profile = getSportProfile(match.sport);
          if (period !== match.currentPeriod && period <= sportMaxPeriod(match.sport) &&
              (!isOvertimePeriod(match.sport, period) || profile.overtimeDurationSec > 0)) {
            data.currentPeriod = period;
            if (resetTimeoutsForNewPeriod(match.sport, match.currentPeriod, period)) {
              data.homeTimeouts = 0;
              data.awayTimeouts = 0;
            }
            if (resetStatsForNewPeriod(match.sport, match.currentPeriod, period)) {
              data.homeFouls = 0;
              data.awayFouls = 0;
            }
          }
        }
        await db.match.update({ where: { id: match.id }, data });
        const profile = getSportProfile(match.sport);
        // Bumpt DisplayState.updatedAt zodat desktop control en mobiele clients matchdata herladen.
        const pausesClock =
          cmd.status === "HALF_TIME" ||
          cmd.status === "FULL_TIME" ||
          cmd.status === "POST_MATCH";
        await updateState(db, {
          mode: s.mode,
          addedTimeMinutes: 0,
          ...(pausesClock ? pauseClocksWithTimer(s, profile) : {}),
          ...clearTimeoutClock(),
        });
      }
      return { ok: true };
    }
    case "sport:setPeriod": {
      const s = await getState(db);
      const match = await requireActiveMatch(db, s);
      await applyPeriodChange(db, s, match, cmd.period);
      return { ok: true };
    }
    case "sport:statAdjust": {
      const s = await getState(db);
      const match = await requireActiveMatch(db, s);
      const profile = getSportProfile(match.sport);
      const sidePrefix = cmd.side === "home" ? "home" : "away";

      if (cmd.stat === "timeout") {
        const limit = profile.timeoutLimitForPeriod(match.currentPeriod);
        if (limit <= 0) throw new Error(`Time-outs zijn niet actief voor ${profile.label}.`);
        if (cmd.delta > 0) {
          if (s.timeoutRunning && computeTimeoutSeconds(s) > 0) {
            throw new Error("Er loopt al een time-out. Beëindig die eerst.");
          }
          await startTimeoutClock(db, s, match, cmd.side, { countAgainstTeam: true });
          return { ok: true };
        }
        const column = `${sidePrefix}Timeouts` as "homeTimeouts" | "awayTimeouts";
        const current = match[column];
        const next = Math.max(0, Math.min(limit, current + cmd.delta));
        await db.match.update({ where: { id: match.id }, data: { [column]: next } });
        await updateState(db, {
          mode: s.mode,
          ...(s.timeoutRunning && s.timeoutSide === cmd.side ? clearTimeoutClock() : {}),
        });
        const ctx = eventClockContext(s, match);
        await logMatchEvent(db, match.id, {
          type: "TIMEOUT",
          minute: ctx.minute,
          period: ctx.period,
          clockSec: ctx.clockSec,
          teamId: cmd.side === "home" ? match.homeTeamId : match.awayTeamId,
          meta: { stat: "timeout", side: cmd.side, from: current, to: next },
          note: `${current} -> ${next}`,
        });
        return { ok: true };
      }

      let column: "homeFouls" | "awayFouls" | "homeSets" | "awaySets";
      let max = 99;
      if (cmd.stat === "foul") {
        if (!profile.statLabel) {
          throw new Error(`Fouten/straffen zijn niet actief voor ${profile.label}.`);
        }
        column = `${sidePrefix}Fouls` as typeof column;
      } else {
        if (!profile.hasSets) throw new Error(`Setstanden zijn niet actief voor ${profile.label}.`);
        column = `${sidePrefix}Sets` as typeof column;
        max = volleyballFormatFromMatch(match).setsToWin;
      }
      const current = match[column];
      const next = Math.max(0, Math.min(max, current + cmd.delta));
      const volleyFormat = cmd.stat === "set" ? volleyballFormatFromMatch(match) : null;
      const setsToWin = volleyFormat?.setsToWin ?? 0;
      const homeSets = cmd.stat === "set" && cmd.side === "home" ? next : match.homeSets;
      const awaySets = cmd.stat === "set" && cmd.side === "away" ? next : match.awaySets;
      const matchOverSets =
        cmd.stat === "set" && setsToWin > 0 && (homeSets >= setsToWin || awaySets >= setsToWin);
      const reopened =
        cmd.stat === "set" && match.status === "FULL_TIME" && !matchOverSets;
      await db.match.update({
        where: { id: match.id },
        data: {
          [column]: next,
          ...(matchOverSets ? { status: "FULL_TIME" } : {}),
          ...(reopened ? { status: lifecycleStatusForPeriod(match.sport, match.currentPeriod) } : {}),
        },
      });
      await updateState(db, {
        mode: matchOverSets ? "FULLTIME" : reopened && s.mode === "FULLTIME" ? "MATCH" : s.mode,
      });
      const ctx = eventClockContext(s, match);
      await logMatchEvent(db, match.id, {
        type: cmd.stat.toUpperCase(),
        minute: ctx.minute,
        period: ctx.period,
        clockSec: ctx.clockSec,
        teamId: cmd.side === "home" ? match.homeTeamId : match.awayTeamId,
        meta: { stat: cmd.stat, side: cmd.side, from: current, to: next },
        note: `${current} -> ${next}`,
      });
      return { ok: true };
    }
    case "sport:setServing": {
      const s = await getState(db);
      const match = await requireActiveMatch(db, s);
      if (!getSportProfile(match.sport).hasSets) {
        throw new Error("Service is alleen actief voor volleybal.");
      }
      const data: MatchUpdate = { servingSide: cmd.side };
      // Bij 0–0 bepaalt de operator (toss) wie de set opent; dat is meteen de eerste server van de set.
      if (match.homeScore === 0 && match.awayScore === 0) data.setFirstServer = cmd.side;
      await db.match.update({ where: { id: match.id }, data });
      await updateState(db, { mode: s.mode });
      return { ok: true };
    }
    case "sport:resumePlay": {
      const s = await getState(db);
      const match = await requireActiveMatch(db, s);
      const status = lifecycleStatusForPeriod(match.sport, match.currentPeriod);
      await db.match.update({ where: { id: match.id }, data: { status } });
      await updateState(db, { mode: liveModeAfterPeriodChange(s.mode), ...clearTimeoutClock() });
      return { ok: true };
    }
    case "score:set": {
      const s = await getState(db);
      const match = await requireActiveMatch(db, s);
      await db.match.update({
        where: { id: match.id },
        data: { homeScore: cmd.homeScore, awayScore: cmd.awayScore },
      });
      const ctx = eventClockContext(s, match);
      await logMatchEvent(db, match.id, {
        type: "SCORE_SET",
        minute: ctx.minute,
        period: ctx.period,
        clockSec: ctx.clockSec,
        meta: {
          fromHome: match.homeScore,
          fromAway: match.awayScore,
          toHome: cmd.homeScore,
          toAway: cmd.awayScore,
        },
        note: `${match.homeScore}-${match.awayScore} -> ${cmd.homeScore}-${cmd.awayScore}`,
      });
      // Bumpt DisplayState.updatedAt zodat control + display de match opnieuw ophalen.
      await updateState(db, { mode: s.mode });
      return { ok: true };
    }
    case "score:adjust": {
      const s = await getState(db);
      const m = await requireActiveMatch(db, s);
      const profile = getSportProfile(m.sport);
      if (cmd.delta === 0) return { ok: true };
      if (profile.hasSets) {
        await applyVolleyballDelta(db, s, m, cmd.side, cmd.delta);
        return { ok: true };
      }
      const column = cmd.side === "home" ? "homeScore" : "awayScore";
      const from = m[column];
      const to = Math.max(0, from + cmd.delta);
      await db.match.update({ where: { id: m.id }, data: { [column]: to } });
      const ctx = eventClockContext(s, m);
      await logMatchEvent(db, m.id, {
        type: "POINT",
        minute: ctx.minute,
        period: ctx.period,
        clockSec: ctx.clockSec,
        teamId: cmd.side === "home" ? m.homeTeamId : m.awayTeamId,
        meta: { side: cmd.side, delta: to - from, from, to },
        note: `${cmd.side} ${cmd.delta > 0 ? "+" : ""}${cmd.delta}`,
      });
      await updateState(db, { mode: s.mode });
      return { ok: true };
    }
    case "goal:prepare": {
      // Start the goal celebration sequence: play a generic "goal" video
      // fullscreen while the operator is picking the scorer.
      const s = await getState(db);
      if (!s.matchId) throw new Error("No active match");
      if (!(await goalVisualEnabledForSide(db, cmd.side))) {
        return { ok: true };
      }
      let activeMediaId: string | null = null;
      const settingsRow = await db.appSettings.findUnique({ where: { id: 1 } });
      const introPath = settingsRow?.goalIntroVideoPath ?? null;
      if (introPath) {
        activeMediaId = await ensureMediaItemForVideoPath(db, introPath, "Goal intro");
      }
      if (!activeMediaId) {
        const playlist = await db.playlist.findUnique({
          where: { slot: "GOAL" },
          include: {
            items: {
              orderBy: { order: "asc" },
              include: { media: true },
            },
          },
        });
        const firstActive = playlist?.items.find((i) => i.media.active);
        activeMediaId = firstActive?.mediaId ?? null;
      }
      await updateState(db, {
        mode: "GOAL_INTRO_VIDEO",
        activeMediaId,
        activeGoalScorerId: null,
      });
      return { ok: true, result: { visual: true } };
    }
    case "goal:cancel": {
      await updateState(db, {
        mode: "SPONSOR_ROTATION",
        activeMediaId: null,
        activeGoalScorerId: null,
      });
      return { ok: true };
    }
    case "goal:trigger": {
      const s = await getState(db);
      const m = await requireActiveMatch(db, s);
      const teamId = cmd.side === "home" ? m.homeTeamId : m.awayTeamId;
      const column = cmd.side === "home" ? "homeScore" : "awayScore";
      await db.match.update({
        where: { id: m.id },
        data: { [column]: m[column] + 1 },
      });
      const ctx = eventClockContext(s, m);
      await logMatchEvent(db, m.id, {
        type: "GOAL",
        minute: ctx.minute,
        period: ctx.period,
        clockSec: ctx.clockSec,
        addedTime: s.addedTimeMinutes > 0 ? s.addedTimeMinutes : 0,
        teamId,
        playerInId: cmd.scorerId,
        playerOutId: cmd.assistId,
        meta: { side: cmd.side, delta: 1, from: m[column], to: m[column] + 1 },
      });

      if (!(await goalVisualEnabledForSide(db, cmd.side))) {
        await updateState(db, {
          mode: s.mode,
          activeMediaId: null,
          activeGoalScorerId: null,
        });
        return { ok: true };
      }

      // If the confirmed scorer has a personal goal video, play it
      // fullscreen. Otherwise fall back to the existing text-based GOAL
      // celebration overlay.
      let scorerMediaId: string | null = null;
      if (cmd.scorerId) {
        const scorer = await db.player.findUnique({
          where: { id: cmd.scorerId },
          select: { goalMediaId: true, goalVideoPath: true },
        });
        scorerMediaId = scorer?.goalMediaId ?? null;
        if (!scorerMediaId && scorer?.goalVideoPath) {
          scorerMediaId = await ensureMediaItemForVideoPath(db, scorer.goalVideoPath, "Doelpuntviering", {
            hideFromLibrary: true,
          });
        }
      }
      await updateState(db, {
        mode: scorerMediaId ? "GOAL_PLAYER_VIDEO" : "GOAL",
        activeGoalScorerId: cmd.scorerId ?? null,
        activeMediaId: scorerMediaId,
      });
      return { ok: true };
    }
    case "sub:trigger": {
      await applySubstitutionPairs(db, [
        {
          teamId: cmd.teamId,
          playerOutId: cmd.playerOutId,
          playerInId: cmd.playerInId,
        },
      ]);
      return { ok: true };
    }
    case "sub:triggerBatch": {
      await applySubstitutionPairs(db, cmd.substitutions);
      return { ok: true };
    }
    case "sub:queueAdvance": {
      const s = await getState(db);
      if (s.mode !== "SUBSTITUTION") {
        return { ok: true };
      }
      let queue = parseSubQueue(s.substitutionQueueJson);

      if (queue.length === 0 || !s.matchId) {
        await updateState(db, {
          mode: "SPONSOR_ROTATION",
          activeSubInId: null,
          activeSubOutId: null,
          substitutionQueueJson: "[]",
        });
        return { ok: true };
      }

      const match = await activeMatchOrNull(db, s);
      const ctx = eventClockContext(s, match);
      await ensureDefaultMatchFieldLineups(s.matchId, db);

      const warnings: string[] = [];

      while (queue.length > 0) {
        const [next, ...rest] = queue;
        try {
          await validateSubPair(db, s.matchId, next);
          await validateSubPairAgainstField(s.matchId, next, db);

          await logMatchEvent(db, s.matchId, {
            type: "SUB",
            minute: ctx.minute,
            period: ctx.period,
            clockSec: ctx.clockSec,
            teamId: next.teamId,
            playerInId: next.playerInId,
            playerOutId: next.playerOutId,
          });

          await updateState(db, {
            mode: "SUBSTITUTION",
            activeSubInId: next.playerInId,
            activeSubOutId: next.playerOutId,
            substitutionQueueJson: JSON.stringify(rest),
          });
          await applySubToFieldRoster(s.matchId, next, db);
          return {
            ok: true,
            ...(warnings.length ? { warning: warnings.join(" · ") } : {}),
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`Wissel overgeslagen: ${msg}`);
          queue = rest;
          await updateState(db, {
            substitutionQueueJson: JSON.stringify(queue),
          });
        }
      }

      await updateState(db, {
        mode: "SPONSOR_ROTATION",
        activeSubInId: null,
        activeSubOutId: null,
        substitutionQueueJson: "[]",
      });
      return {
        ok: true,
        ...(warnings.length ? { warning: warnings.join(" · ") } : {}),
      };
    }
    case "card:trigger": {
      const s = await getState(db);
      const match = await requireActiveMatch(db, s);
      const profile = getSportProfile(match.sport);
      if (!profile.supportsCards || !profile.cardColors.includes(cmd.color)) {
        throw new Error(`Kaarten van type ${cmd.color} zijn niet actief voor ${profile.label}.`);
      }
      const ctx = eventClockContext(s, match);
      const eventType =
        cmd.color === "GREEN" ? "CARD_GREEN" : cmd.color === "YELLOW" ? "CARD_YELLOW" : "CARD_RED";
      await logMatchEvent(db, match.id, {
        type: eventType,
        minute: ctx.minute,
        period: ctx.period,
        clockSec: ctx.clockSec,
        teamId: cmd.teamId,
        playerInId: cmd.playerId,
      });
      const penaltySeconds =
        cmd.color === "GREEN"
          ? profile.penaltyClockPresets.includes(120)
            ? 120
            : profile.penaltyClockPresets[0]
          : cmd.color === "YELLOW" && profile.penaltyClockPresets.includes(300)
            ? 300
            : null;
      const side = cmd.teamId === match.homeTeamId ? "home" : "away";
      const penaltyStartsNow = !profile.penaltyFollowsClock || s.timerRunning;
      await updateState(db, {
        mode: "CARD",
        activePlayerId: cmd.playerId,
        activeCardColor: cmd.color,
        ...(penaltySeconds
          ? penaltyStartsNow
            ? runPenaltyFrom(side, penaltySeconds)
            : pausePenaltyAt(side, penaltySeconds)
          : {}),
      });
      return { ok: true };
    }
    case "display:setMode": {
      const clearSub =
        cmd.mode !== "SUBSTITUTION"
          ? {
              activeSubInId: null,
              activeSubOutId: null,
              substitutionQueueJson: "[]",
            }
          : {};
      const s = await getState(db);
      const enteringBlackout = cmd.mode === "BLACKOUT" && s.mode !== "BLACKOUT";
      const leavingBlackout = s.mode === "BLACKOUT" && cmd.mode !== "BLACKOUT";
      await updateState(db, {
        mode: cmd.mode,
        activePlayerId: cmd.meta?.activePlayerId ?? null,
        activeMediaId: cmd.meta?.activeMediaId ?? null,
        blackoutResumeMode:
          cmd.mode === "BLACKOUT"
            ? s.mode === "BLACKOUT"
              ? s.blackoutResumeMode
              : s.mode
            : null,
        ...(enteringBlackout ? captureOnBlackoutEnter(s) : {}),
        ...(leavingBlackout ? captureOnBlackoutExit(s) : {}),
        ...clearSub,
      });
      return { ok: true };
    }
    case "display:blackout": {
      const s = await getState(db);
      if (s.mode === "BLACKOUT") {
        const resume =
          s.blackoutResumeMode ?? (await defaultResumeModeAfterBlackout(db, s.matchId));
        // Capture die vóór de blackout live stond komt terug (blackout is een pauze, geen stop).
        await updateState(db, {
          mode: resume,
          blackoutResumeMode: null,
          ...captureOnBlackoutExit(s),
        });
      } else {
        await updateState(db, {
          mode: "BLACKOUT",
          blackoutResumeMode: s.mode,
          ...captureOnBlackoutEnter(s),
        });
      }
      return { ok: true };
    }
    case "display:setExternalCapture": {
      await updateState(db, {
        externalCaptureSourceId: cmd.sourceId,
        ...(cmd.sourceId === null
          ? { externalCaptureToDisplay: false, blackoutResumeCapture: false }
          : {}),
      });
      return { ok: true };
    }
    case "display:setExternalCaptureToDisplay": {
      const s = await getState(db);
      // Tijdens BLACKOUT bepaalt dit wat er ná de blackout terugkomt, niet wat nu speelt.
      if (s.mode === "BLACKOUT") {
        await updateState(db, { blackoutResumeCapture: cmd.enabled });
        return { ok: true };
      }
      await updateState(db, { externalCaptureToDisplay: cmd.enabled });
      return { ok: true };
    }
    case "display:setExternalCaptureAudio": {
      await updateState(db, { externalCaptureAudio: cmd.enabled });
      return { ok: true };
    }
    case "display:setSafeMode": {
      // Feature verwijderd — altijd uit (compat voor oude clients).
      await updateState(db, { safeMode: false });
      return { ok: true };
    }
    case "display:requestSnapshot": {
      return { ok: true };
    }
    case "event:undo": {
      const ev = await db.matchEvent.findUnique({ where: { id: cmd.eventId } });
      if (!ev) throw new Error("Event not found");
      const m = await db.match.findUnique({ where: { id: ev.matchId } });
      const meta = parseEventMeta(ev.metaJson);
      const ds = await getState(db);
      let warning: string | undefined;

      if (m) {
        const profile = getSportProfile(m.sport);
        const metaSide: Side | null = meta.side === "home" || meta.side === "away" ? meta.side : null;

        if (ev.type === "GOAL" && ev.teamId) {
          const column = ev.teamId === m.homeTeamId ? "homeScore" : "awayScore";
          await db.match.update({
            where: { id: m.id },
            data: { [column]: Math.max(0, m[column] - 1) },
          });
        } else if (
          ev.type === "POINT" ||
          ev.type === "SET_WON" ||
          (ev.type === "TECHNICAL_TIMEOUT" && profile.hasSets && typeof meta.delta === "number")
        ) {
          if (profile.hasSets) {
            const latest = await db.matchEvent.findFirst({
              where: { matchId: m.id, type: { in: ["POINT", "SET_WON", "TECHNICAL_TIMEOUT"] } },
              orderBy: { createdAt: "desc" },
            });
            if (!latest || latest.id !== ev.id) {
              throw new Error("Bij volleybal kan alleen het laatste punt ongedaan gemaakt worden (of gebruik −1).");
            }
            const side = metaSide ?? (ev.teamId === m.homeTeamId ? "home" : "away");
            // Terug naar de stand vóór dit punt: bij een setwinst staat de stand op 0–0 en rolt −1 de set terug.
            await applyVolleyballDelta(db, ds, m, side, -1, { skipLog: true });
          } else {
            const delta = typeof meta.delta === "number" ? meta.delta : 1;
            const side = metaSide ?? (ev.teamId === m.homeTeamId ? "home" : "away");
            const column = side === "home" ? "homeScore" : "awayScore";
            await db.match.update({
              where: { id: m.id },
              data: { [column]: Math.max(0, m[column] - delta) },
            });
          }
        } else if (ev.type === "SCORE_SET") {
          const fromHome = Number(meta.fromHome);
          const fromAway = Number(meta.fromAway);
          if (Number.isFinite(fromHome) && Number.isFinite(fromAway)) {
            await db.match.update({
              where: { id: m.id },
              data: { homeScore: Math.max(0, fromHome), awayScore: Math.max(0, fromAway) },
            });
          }
        } else if (ev.type === "TIMEOUT" || ev.type === "FOUL" || ev.type === "SET") {
          const stat = meta.stat === "timeout" || meta.stat === "foul" || meta.stat === "set" ? meta.stat : null;
          const from = Number(meta.from);
          const to = Number(meta.to);
          if (stat && metaSide && Number.isFinite(from) && Number.isFinite(to)) {
            const column =
              stat === "timeout"
                ? (`${metaSide}Timeouts` as const)
                : stat === "foul"
                  ? (`${metaSide}Fouls` as const)
                  : (`${metaSide}Sets` as const);
            const reverted = Math.max(0, m[column] - (to - from));
            await db.match.update({ where: { id: m.id }, data: { [column]: reverted } });
            if (stat === "timeout" && ds.timeoutRunning && ds.timeoutSide === metaSide) {
              await updateState(db, clearTimeoutClock());
            }
          } else {
            warning = "Event verwijderd; teller kon niet automatisch teruggedraaid worden (oud event).";
          }
        } else if (ev.type === "TECHNICAL_TIMEOUT") {
          if (ds.timeoutRunning && ds.timeoutSide === "technical") {
            await updateState(db, clearTimeoutClock());
          }
        }
      }

      await db.matchEvent.delete({ where: { id: cmd.eventId } });
      const after = await getState(db);
      await updateState(db, { mode: after.mode });
      return warning ? { ok: true, warning } : { ok: true };
    }
  }
}
