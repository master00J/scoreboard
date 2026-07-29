import path from "path";
import { prisma } from "../lib/prisma";
import type { Command } from "../lib/validation/commands";
import { isLivePlayingMatchStatus } from "../lib/live-cycle-settings";
import {
  computeElapsedSeconds,
  computeShotClockSeconds,
  pauseShotClockAt,
  runFrom,
  runShotClockFrom,
  stopAt,
} from "../lib/timer";
import {
  getSportProfile,
  lifecycleStatusForPeriod,
  normalizeSport,
  resetStatsForNewPeriod,
  resetTimeoutsForNewPeriod,
} from "../lib/sports";
import type { SubPair } from "./match-lineup";
import {
  applySubToFieldRoster,
  ensureDefaultMatchFieldLineups,
  validateSubPairAgainstField,
  validateSubPairsSequential,
} from "./match-lineup";

async function getState() {
  const s = await prisma.displayState.findUnique({ where: { id: 1 } });
  if (!s) {
    return prisma.displayState.create({ data: { id: 1, mode: "IDLE" } });
  }
  return s;
}

async function updateState(data: Parameters<typeof prisma.displayState.update>[0]["data"]) {
  return prisma.displayState.update({ where: { id: 1 }, data });
}

async function goalVisualEnabledForSide(side: "home" | "away"): Promise<boolean> {
  const column = side === "home" ? "goalVisualHomeEnabled" : "goalVisualAwayEnabled";
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ enabled: boolean | number | null }>>(
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
  filePath: string,
  titleHint: string,
  options?: { hideFromLibrary?: boolean },
): Promise<string | null> {
  const trimmed = filePath.trim();
  if (!trimmed) return null;
  const existing = await prisma.mediaItem.findFirst({ where: { path: trimmed } });
  if (existing) {
    if (options?.hideFromLibrary && !existing.hideFromLibrary) {
      await prisma.mediaItem.update({
        where: { id: existing.id },
        data: { hideFromLibrary: true },
      });
    }
    return existing.id;
  }
  const base = path.basename(trimmed.replace(/[/\\]+$/, "")) || titleHint;
  const created = await prisma.mediaItem.create({
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

async function validateSubPair(matchId: string, pair: SubPair) {
  const m = await prisma.match.findUnique({
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

async function applySubstitutionPairs(pairs: SubPair[]) {
  if (pairs.length === 0) return;
  const s = await getState();
  if (!s.matchId) throw new Error("No active match");
  await ensureDefaultMatchFieldLineups(s.matchId);

  for (const p of pairs) await validateSubPair(s.matchId, p);

  const queue = parseSubQueue(s.substitutionQueueJson);

  if (s.mode === "SUBSTITUTION") {
    const merged = [...queue, ...pairs];
    await validateSubPairsSequential(s.matchId, merged);
    await updateState({ substitutionQueueJson: JSON.stringify(merged) });
    return;
  }

  await validateSubPairsSequential(s.matchId, pairs);

  const elapsed = computeElapsedSeconds(s);
  const [first, ...rest] = pairs;
  await logMatchEvent(s.matchId, {
    type: "SUB",
    minute: currentMinute(elapsed),
    teamId: first.teamId,
    playerInId: first.playerInId,
    playerOutId: first.playerOutId,
  });
  await updateState({
    mode: "SUBSTITUTION",
    activeSubInId: first.playerInId,
    activeSubOutId: first.playerOutId,
    substitutionQueueJson: JSON.stringify(rest),
  });
  await applySubToFieldRoster(s.matchId, first);
}

async function logMatchEvent(
  matchId: string,
  payload: {
    type: string;
    minute: number;
    addedTime?: number;
    teamId?: string;
    playerInId?: string;
    playerOutId?: string;
    note?: string;
  },
) {
  return prisma.matchEvent.create({
    data: {
      matchId,
      type: payload.type,
      minute: payload.minute,
      addedTime: payload.addedTime ?? 0,
      teamId: payload.teamId,
      playerInId: payload.playerInId,
      playerOutId: payload.playerOutId,
      note: payload.note,
    },
  });
}

function currentMinute(elapsedSec: number) {
  return Math.floor(elapsedSec / 60);
}

async function defaultResumeModeAfterBlackout(matchId: string | null): Promise<string> {
  if (!matchId) return "IDLE";
  const m = await prisma.match.findUnique({
    where: { id: matchId },
    select: { status: true },
  });
  if (!m) return "IDLE";
  if (isLivePlayingMatchStatus(m.status)) return "SPONSOR_ROTATION";
  return "MATCH";
}

export async function handleCommand(cmd: Command) {
  switch (cmd.type) {
    case "timer:start": {
      const s = await getState();
      const elapsed = computeElapsedSeconds(s);
      const next = runFrom(elapsed);
      await updateState(next);
      return { ok: true };
    }
    case "timer:pause": {
      const s = await getState();
      const elapsed = computeElapsedSeconds(s);
      const shotClock = computeShotClockSeconds(s);
      await updateState({
        ...stopAt(elapsed),
        ...(s.shotClockRunning ? pauseShotClockAt(shotClock) : {}),
      });
      return { ok: true };
    }
    case "timer:adjust": {
      const s = await getState();
      const elapsed = computeElapsedSeconds(s);
      const target = Math.max(0, Math.floor(elapsed + cmd.deltaSec));
      const next = s.timerRunning ? runFrom(target) : stopAt(target);
      await updateState(next);
      if (s.matchId) {
        await logMatchEvent(s.matchId, {
          type: "TIMER_ADJUST",
          minute: currentMinute(target),
          note: `${Math.floor(elapsed)}s -> ${target}s (${cmd.deltaSec >= 0 ? "+" : ""}${cmd.deltaSec}s)`,
        });
      }
      return { ok: true };
    }
    case "timer:set": {
      const s = await getState();
      const next = s.timerRunning ? runFrom(cmd.seconds) : stopAt(cmd.seconds);
      await updateState(next);
      if (s.matchId) {
        await logMatchEvent(s.matchId, {
          type: "TIMER_ADJUST",
          minute: currentMinute(cmd.seconds),
          note: `set to ${cmd.seconds}s`,
        });
      }
      return { ok: true };
    }
    case "timer:preset": {
      const presets: Record<typeof cmd.preset, { sec: number; status: string }> = {
        FIRST_HALF: { sec: 0, status: "FIRST_HALF" },
        SECOND_HALF: { sec: 45 * 60, status: "SECOND_HALF" },
        ET1: { sec: 90 * 60, status: "EXTRA_TIME" },
        ET2: { sec: 105 * 60, status: "EXTRA_TIME" },
      };
      const p = presets[cmd.preset];
      await updateState({ ...stopAt(p.sec), addedTimeMinutes: 0 });
      const s = await getState();
      if (s.matchId) {
        await prisma.match.update({
          where: { id: s.matchId },
          data: { status: p.status },
        });
      }
      return { ok: true };
    }
    case "timer:setAddedTime": {
      await updateState({ addedTimeMinutes: cmd.minutes });
      return { ok: true };
    }
    case "shotclock:start": {
      const s = await getState();
      if (!s.matchId) throw new Error("No active match");
      const match = await prisma.match.findUnique({
        where: { id: s.matchId },
        select: { sport: true },
      });
      const profile = getSportProfile(match?.sport);
      if (profile.shotClockPresets.length === 0) {
        throw new Error(`Shotclock is niet beschikbaar voor ${profile.label}.`);
      }
      const remaining = computeShotClockSeconds(s);
      await updateState(
        runShotClockFrom(remaining > 0 ? remaining : profile.shotClockPresets[0]!),
      );
      return { ok: true };
    }
    case "shotclock:pause": {
      const s = await getState();
      await updateState(pauseShotClockAt(computeShotClockSeconds(s)));
      return { ok: true };
    }
    case "shotclock:reset": {
      const s = await getState();
      if (!s.matchId) throw new Error("No active match");
      const match = await prisma.match.findUnique({
        where: { id: s.matchId },
        select: { sport: true },
      });
      const profile = getSportProfile(match?.sport);
      const seconds = cmd.seconds ?? profile.shotClockPresets[0] ?? 24;
      if (!profile.shotClockPresets.includes(seconds)) {
        throw new Error(`Shotclock ${seconds}s is niet beschikbaar voor ${profile.label}.`);
      }
      await updateState(
        s.shotClockRunning ? runShotClockFrom(seconds) : pauseShotClockAt(seconds),
      );
      return { ok: true };
    }
    case "shotclock:set": {
      const s = await getState();
      await updateState(
        s.shotClockRunning
          ? runShotClockFrom(cmd.seconds)
          : pauseShotClockAt(cmd.seconds),
      );
      return { ok: true };
    }
    case "match:setActive": {
      let shotClockBaseSec = 0;
      if (cmd.matchId != null) {
        const m = await prisma.match.findUnique({
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
      await updateState({
        matchId: cmd.matchId,
        addedTimeMinutes: 0,
        shotClockRunning: false,
        shotClockStartedAt: null,
        shotClockBaseSec,
      });
      return { ok: true };
    }
    case "match:setStatus": {
      const s = await getState();
      if (s.matchId) {
        await prisma.match.update({
          where: { id: s.matchId },
          data: { status: cmd.status },
        });
        // Bumpt DisplayState.updatedAt zodat desktop control en mobiele clients matchdata herladen.
        const pausesClock =
          cmd.status === "HALF_TIME" ||
          cmd.status === "FULL_TIME" ||
          cmd.status === "POST_MATCH";
        await updateState({
          mode: s.mode,
          addedTimeMinutes: 0,
          ...(pausesClock ? stopAt(computeElapsedSeconds(s)) : {}),
          ...(pausesClock ? pauseShotClockAt(computeShotClockSeconds(s)) : {}),
        });
      }
      return { ok: true };
    }
    case "sport:setPeriod": {
      const s = await getState();
      if (!s.matchId) throw new Error("No active match");
      const match = await prisma.match.findUnique({ where: { id: s.matchId } });
      if (!match) throw new Error("Match not found");
      const sport = normalizeSport(match.sport);
      const profile = getSportProfile(sport);
      if (cmd.period > profile.periodCount) {
        throw new Error(`${profile.label} heeft ${profile.periodCount} reguliere periodes.`);
      }

      const data: Parameters<typeof prisma.match.update>[0]["data"] = {
        currentPeriod: cmd.period,
        status: lifecycleStatusForPeriod(sport, cmd.period),
      };
      if (resetTimeoutsForNewPeriod(sport, match.currentPeriod, cmd.period)) {
        data.homeTimeouts = 0;
        data.awayTimeouts = 0;
      }
      if (resetStatsForNewPeriod(sport)) {
        data.homeFouls = 0;
        data.awayFouls = 0;
      }
      if (profile.hasSets && cmd.period !== match.currentPeriod) {
        data.homeScore = 0;
        data.awayScore = 0;
      }
      await prisma.match.update({ where: { id: match.id }, data });
      const periodStartSec =
        profile.timerMode === "COUNT_UP"
          ? Math.max(0, (cmd.period - 1) * match.periodDurationSec)
          : 0;
      await updateState({
        ...stopAt(periodStartSec),
        ...pauseShotClockAt(profile.shotClockPresets[0] ?? 0),
        mode: "MATCH",
        addedTimeMinutes: 0,
      });
      await logMatchEvent(match.id, {
        type: "PERIOD",
        minute: 0,
        note: `${profile.periodLabel} ${cmd.period}`,
      });
      return { ok: true };
    }
    case "sport:statAdjust": {
      const s = await getState();
      if (!s.matchId) throw new Error("No active match");
      const match = await prisma.match.findUnique({ where: { id: s.matchId } });
      if (!match) throw new Error("Match not found");
      const profile = getSportProfile(match.sport);
      const sidePrefix = cmd.side === "home" ? "home" : "away";
      let column:
        | "homeTimeouts"
        | "awayTimeouts"
        | "homeFouls"
        | "awayFouls"
        | "homeSets"
        | "awaySets";
      let current: number;
      let max = 99;

      if (cmd.stat === "timeout") {
        max = profile.timeoutLimitForPeriod(match.currentPeriod);
        if (max <= 0) throw new Error(`Time-outs zijn niet actief voor ${profile.label}.`);
        column = `${sidePrefix}Timeouts` as typeof column;
        current = match[column];
      } else if (cmd.stat === "foul") {
        if (!profile.statLabel) {
          throw new Error(`Fouten/straffen zijn niet actief voor ${profile.label}.`);
        }
        column = `${sidePrefix}Fouls` as typeof column;
        current = match[column];
      } else {
        if (!profile.hasSets) throw new Error(`Setstanden zijn niet actief voor ${profile.label}.`);
        column = `${sidePrefix}Sets` as typeof column;
        current = match[column];
        max = Math.ceil(profile.periodCount / 2);
      }

      const next = Math.max(0, Math.min(max, current + cmd.delta));
      await prisma.match.update({
        where: { id: match.id },
        data: { [column]: next },
      });
      await updateState({ mode: s.mode });
      await logMatchEvent(match.id, {
        type: cmd.stat.toUpperCase(),
        minute: currentMinute(computeElapsedSeconds(s)),
        teamId: cmd.side === "home" ? match.homeTeamId : match.awayTeamId,
        note: `${current} -> ${next}`,
      });
      return { ok: true };
    }
    case "score:set": {
      const s = await getState();
      if (!s.matchId) throw new Error("No active match");
      await prisma.match.update({
        where: { id: s.matchId },
        data: { homeScore: cmd.homeScore, awayScore: cmd.awayScore },
      });
      // Bumpt DisplayState.updatedAt zodat control + display de match opnieuw ophalen.
      await updateState({ mode: s.mode });
      return { ok: true };
    }
    case "score:adjust": {
      const s = await getState();
      if (!s.matchId) throw new Error("No active match");
      const m = await prisma.match.findUnique({ where: { id: s.matchId } });
      if (!m) throw new Error("Match not found");
      const data: { homeScore?: number; awayScore?: number } = {};
      if (cmd.side === "home") data.homeScore = Math.max(0, m.homeScore + cmd.delta);
      else data.awayScore = Math.max(0, m.awayScore + cmd.delta);
      await prisma.match.update({ where: { id: s.matchId }, data });
      await updateState({ mode: s.mode });
      return { ok: true };
    }
    case "goal:prepare": {
      // Start the goal celebration sequence: play a generic "goal" video
      // fullscreen while the operator is picking the scorer.
      const s = await getState();
      if (!s.matchId) throw new Error("No active match");
      if (!(await goalVisualEnabledForSide(cmd.side))) {
        return { ok: true };
      }
      let activeMediaId: string | null = null;
      const settingsRow = await prisma.appSettings.findUnique({ where: { id: 1 } });
      const introPath = settingsRow?.goalIntroVideoPath ?? null;
      if (introPath) {
        activeMediaId = await ensureMediaItemForVideoPath(introPath, "Goal intro");
      }
      if (!activeMediaId) {
        const playlist = await prisma.playlist.findUnique({
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
      await updateState({
        mode: "GOAL_INTRO_VIDEO",
        activeMediaId,
        activeGoalScorerId: null,
      });
      return { ok: true };
    }
    case "goal:cancel": {
      await updateState({
        mode: "SPONSOR_ROTATION",
        activeMediaId: null,
        activeGoalScorerId: null,
      });
      return { ok: true };
    }
    case "goal:trigger": {
      const s = await getState();
      if (!s.matchId) throw new Error("No active match");
      const m = await prisma.match.findUnique({ where: { id: s.matchId } });
      if (!m) throw new Error("Match not found");
      const teamId = cmd.side === "home" ? m.homeTeamId : m.awayTeamId;
      await prisma.match.update({
        where: { id: m.id },
        data:
          cmd.side === "home"
            ? { homeScore: m.homeScore + 1 }
            : { awayScore: m.awayScore + 1 },
      });
      const elapsed = computeElapsedSeconds(s);
      await logMatchEvent(m.id, {
        type: "GOAL",
        minute: currentMinute(elapsed),
        teamId,
        playerInId: cmd.scorerId,
        playerOutId: cmd.assistId,
      });

      if (!(await goalVisualEnabledForSide(cmd.side))) {
        await updateState({
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
        const scorer = await prisma.player.findUnique({
          where: { id: cmd.scorerId },
          select: { goalMediaId: true, goalVideoPath: true },
        });
        scorerMediaId = scorer?.goalMediaId ?? null;
        if (!scorerMediaId && scorer?.goalVideoPath) {
          scorerMediaId = await ensureMediaItemForVideoPath(scorer.goalVideoPath, "Doelpuntviering", {
            hideFromLibrary: true,
          });
        }
      }
      await updateState({
        mode: scorerMediaId ? "GOAL_PLAYER_VIDEO" : "GOAL",
        activeGoalScorerId: cmd.scorerId ?? null,
        activeMediaId: scorerMediaId,
      });
      return { ok: true };
    }
    case "sub:trigger": {
      await applySubstitutionPairs([
        {
          teamId: cmd.teamId,
          playerOutId: cmd.playerOutId,
          playerInId: cmd.playerInId,
        },
      ]);
      return { ok: true };
    }
    case "sub:triggerBatch": {
      await applySubstitutionPairs(cmd.substitutions);
      return { ok: true };
    }
    case "sub:queueAdvance": {
      const s = await getState();
      if (s.mode !== "SUBSTITUTION") {
        return { ok: true };
      }
      let queue = parseSubQueue(s.substitutionQueueJson);

      if (queue.length === 0) {
        await updateState({
          mode: "SPONSOR_ROTATION",
          activeSubInId: null,
          activeSubOutId: null,
          substitutionQueueJson: "[]",
        });
        return { ok: true };
      }

      if (!s.matchId) {
        await updateState({
          mode: "SPONSOR_ROTATION",
          activeSubInId: null,
          activeSubOutId: null,
          substitutionQueueJson: "[]",
        });
        return { ok: true };
      }

      const elapsed = computeElapsedSeconds(s);
      await ensureDefaultMatchFieldLineups(s.matchId);

      const warnings: string[] = [];

      while (queue.length > 0) {
        const [next, ...rest] = queue;
        try {
          await validateSubPair(s.matchId, next);
          await validateSubPairAgainstField(s.matchId, next);

          await logMatchEvent(s.matchId, {
            type: "SUB",
            minute: currentMinute(elapsed),
            teamId: next.teamId,
            playerInId: next.playerInId,
            playerOutId: next.playerOutId,
          });

          await updateState({
            mode: "SUBSTITUTION",
            activeSubInId: next.playerInId,
            activeSubOutId: next.playerOutId,
            substitutionQueueJson: JSON.stringify(rest),
          });
          await applySubToFieldRoster(s.matchId, next);
          return {
            ok: true,
            ...(warnings.length ? { warning: warnings.join(" · ") } : {}),
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`Wissel overgeslagen: ${msg}`);
          queue = rest;
          await updateState({
            substitutionQueueJson: JSON.stringify(queue),
          });
        }
      }

      await updateState({
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
      const s = await getState();
      if (!s.matchId) throw new Error("No active match");
      const elapsed = computeElapsedSeconds(s);
      await logMatchEvent(s.matchId, {
        type: cmd.color === "YELLOW" ? "CARD_YELLOW" : "CARD_RED",
        minute: currentMinute(elapsed),
        teamId: cmd.teamId,
        playerInId: cmd.playerId,
      });
      await updateState({
        mode: "CARD",
        activePlayerId: cmd.playerId,
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
      const s = await getState();
      await updateState({
        mode: cmd.mode,
        activePlayerId: cmd.meta?.activePlayerId ?? null,
        activeMediaId: cmd.meta?.activeMediaId ?? null,
        blackoutResumeMode:
          cmd.mode === "BLACKOUT"
            ? s.mode === "BLACKOUT"
              ? s.blackoutResumeMode
              : s.mode
            : null,
        ...clearSub,
      });
      return { ok: true };
    }
    case "display:blackout": {
      const s = await getState();
      if (s.mode === "BLACKOUT") {
        const resume =
          s.blackoutResumeMode ?? (await defaultResumeModeAfterBlackout(s.matchId));
        await updateState({
          mode: resume,
          blackoutResumeMode: null,
          externalCaptureToDisplay: false,
        });
      } else {
        await updateState({
          mode: "BLACKOUT",
          blackoutResumeMode: s.mode,
          externalCaptureToDisplay: false,
        });
      }
      return { ok: true };
    }
    case "display:setExternalCapture": {
      await updateState({
        externalCaptureSourceId: cmd.sourceId,
        ...(cmd.sourceId === null ? { externalCaptureToDisplay: false } : {}),
      });
      return { ok: true };
    }
    case "display:setExternalCaptureToDisplay": {
      await updateState({ externalCaptureToDisplay: cmd.enabled });
      return { ok: true };
    }
    case "display:setSafeMode": {
      await updateState({ safeMode: cmd.enabled });
      return { ok: true };
    }
    case "display:requestSnapshot": {
      return { ok: true };
    }
    case "event:undo": {
      const ev = await prisma.matchEvent.findUnique({ where: { id: cmd.eventId } });
      if (!ev) throw new Error("Event not found");
      if (ev.type === "GOAL" && ev.teamId) {
        const m = await prisma.match.findUnique({ where: { id: ev.matchId } });
        if (m) {
          if (ev.teamId === m.homeTeamId) {
            await prisma.match.update({
              where: { id: m.id },
              data: { homeScore: Math.max(0, m.homeScore - 1) },
            });
          } else {
            await prisma.match.update({
              where: { id: m.id },
              data: { awayScore: Math.max(0, m.awayScore - 1) },
            });
          }
        }
      }
      await prisma.matchEvent.delete({ where: { id: cmd.eventId } });
      const ds = await getState();
      await updateState({ mode: ds.mode });
      return { ok: true };
    }
  }
}
