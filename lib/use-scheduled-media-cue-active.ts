"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DisplayStatePayload } from "@/lib/desktop-bridge";
import type { Match, ScheduledMediaCue } from "@/lib/types";
import {
  computePrematchRundownClock,
  cueClockPhaseKey,
  cueHasClockWindow,
  cueIsDueAtElapsed,
  cueLeftClockWindow,
  cuePhaseMatches,
  cueUsesLiveWallClock,
  liveWallCueClockFromPersisted,
  liveWallCueElapsedSec,
  cueWindowExpired,
  isPostMatchCuePhase,
  isPrematchCuePhase,
  phaseRundownLoops,
  postMatchCueElapsedSec,
  rundownCycleIndex,
  rundownCycleSec,
  wrapRundownElapsed,
} from "@/lib/scheduled-media-cue";
import { getSportProfile } from "@/lib/sports";

type Options = {
  match: Match | null;
  state: DisplayStatePayload | null;
  mode: string;
  elapsed: number;
  /** Zelfde als display: geen cue-detectie in standalone preview-iframe. */
  skip?: boolean;
};

type UseScheduledMediaCueActiveResult = {
  activeScheduledCue: ScheduledMediaCue | null;
  /** Doorloop van een loopende rundown; verandert de React-key zodat dezelfde clip opnieuw start. */
  scheduledCueCycle: number;
  /** Sluit de cue-overlay (na video `ended` of handmatig). */
  dismissActiveScheduledCue: () => void;
};

/**
 * Zelfde geplande-media-cue actieve clip als `app/display/page.tsx` (fired-keys + reset bij match).
 * Gebruikt door het stadionscherm en door de Sponsor-HUD zodat `sponsorInterrupted` gelijk blijft.
 */
export function useScheduledMediaCueActive({
  match,
  state,
  mode,
  elapsed,
  skip = false,
}: Options): UseScheduledMediaCueActiveResult {
  const [scheduledCues, setScheduledCues] = useState<ScheduledMediaCue[]>([]);
  const [activeScheduledCue, setActiveScheduledCue] = useState<ScheduledMediaCue | null>(null);
  const firedScheduledCueKeysRef = useRef<Set<string>>(new Set());
  const lastScheduledCueClockRef = useRef<{
    matchId: string | null;
    status: string | null;
    elapsed: number;
  }>({ matchId: null, status: null, elapsed: 0 });

  const [wallPhaseElapsed, setWallPhaseElapsed] = useState(0);
  const [prematchGate, setPrematchGate] = useState({ beforeWindow: false, pastKickoff: false });

  const dismissActiveScheduledCue = useCallback(() => {
    setActiveScheduledCue(null);
  }, []);

  const phaseCues = useMemo(() => {
    if (!match) return [];
    return scheduledCues.filter(
      (cue) => cue.enabled && cue.media?.active && cuePhaseMatches(cue.matchStatus, match.status),
    );
  }, [match, scheduledCues]);

  const rundownLoops = phaseRundownLoops(phaseCues);
  const cycleSec = rundownCycleSec(phaseCues);

  const usesPostMatchClock = isPostMatchCuePhase(match?.status);
  const usesPrematchClock = isPrematchCuePhase(match?.status);
  const usesLiveWallClock = cueUsesLiveWallClock(
    match?.status,
    match ? getSportProfile(match.sport).timerMode : null,
  );
  const holdLiveWallOnBreak =
    !!match &&
    getSportProfile(match.sport).timerMode === "NONE" &&
    match.status === "HALF_TIME";
  const persistedLiveWallClock = liveWallCueClockFromPersisted({
    matchId: match?.id ?? null,
    block: state?.liveWallCueBlock,
    origin: state?.liveWallCueOrigin,
    frozenSec: state?.liveWallCueFrozenSec,
  });

  useEffect(() => {
    if (skip || !(usesLiveWallClock || holdLiveWallOnBreak)) {
      if (!usesPrematchClock && !usesPostMatchClock) setWallPhaseElapsed(0);
      return;
    }
    const tick = () => setWallPhaseElapsed(liveWallCueElapsedSec(persistedLiveWallClock, Date.now()));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [
    skip,
    usesLiveWallClock,
    holdLiveWallOnBreak,
    usesPrematchClock,
    usesPostMatchClock,
    persistedLiveWallClock.matchId,
    persistedLiveWallClock.block,
    persistedLiveWallClock.originMs,
    persistedLiveWallClock.frozenSec,
  ]);

  useEffect(() => {
    if (skip || !usesPostMatchClock) {
      if (!usesPrematchClock && !usesLiveWallClock && !holdLiveWallOnBreak) setWallPhaseElapsed(0);
      return;
    }
    const tick = () =>
      setWallPhaseElapsed(postMatchCueElapsedSec(state?.postMatchStartedAt, Date.now()));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [skip, match?.id, match?.status, usesPostMatchClock, usesPrematchClock, usesLiveWallClock, holdLiveWallOnBreak, state?.postMatchStartedAt]);

  useEffect(() => {
    if (skip || !usesPrematchClock) {
      setPrematchGate({ beforeWindow: false, pastKickoff: false });
      if (!usesPostMatchClock && !usesLiveWallClock && !holdLiveWallOnBreak) setWallPhaseElapsed(0);
      return;
    }
    const tick = () => {
      const clock = computePrematchRundownClock(
        {
          kickoffAt: match?.kickoffAt,
          prematchSpreadWindowSec: match?.prematchSpreadWindowSec,
        },
        cycleSec,
        state?.preMatchStartedAt,
        Date.now(),
      );
      setWallPhaseElapsed(clock.elapsedSec);
      setPrematchGate({ beforeWindow: clock.beforeWindow, pastKickoff: clock.pastKickoff });
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [
    skip,
    match?.id,
    match?.kickoffAt,
    match?.prematchSpreadWindowSec,
    cycleSec,
    usesPrematchClock,
    usesPostMatchClock,
    usesLiveWallClock,
    holdLiveWallOnBreak,
    state?.preMatchStartedAt,
  ]);

  const cueElapsed =
    usesPostMatchClock || usesPrematchClock || usesLiveWallClock || holdLiveWallOnBreak
      ? wallPhaseElapsed
      : elapsed;
  const prematchBlocked = usesPrematchClock && (prematchGate.beforeWindow || prematchGate.pastKickoff);
  const playhead = wrapRundownElapsed(cueElapsed, cycleSec, rundownLoops);
  const scheduledCueCycle = rundownCycleIndex(cueElapsed, cycleSec, rundownLoops);

  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    fetch("/api/scheduled-media-cues")
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(body)) return [];
        return body as ScheduledMediaCue[];
      })
      .then((list) => {
        if (cancelled) return;
        setScheduledCues(list);
      })
      .catch(() => setScheduledCues([]));
    return () => {
      cancelled = true;
    };
  }, [skip, state?.updatedAt]);

  useEffect(() => {
    if (skip) {
      setActiveScheduledCue(null);
      firedScheduledCueKeysRef.current.clear();
      return;
    }
    const prev = lastScheduledCueClockRef.current;
    const matchId = match?.id ?? null;
    const status = cueClockPhaseKey(
      holdLiveWallOnBreak ? (persistedLiveWallClock.block ?? match?.status) : match?.status,
    );
    if (prev.matchId !== matchId || prev.status !== status || cueElapsed < prev.elapsed - 1) {
      firedScheduledCueKeysRef.current.clear();
      setActiveScheduledCue(null);
    }
    lastScheduledCueClockRef.current = { matchId, status, elapsed: cueElapsed };
  }, [skip, match?.id, match?.status, cueElapsed, holdLiveWallOnBreak, persistedLiveWallClock.block]);

  useEffect(() => {
    if (skip) return;
    if (!state || !match || mode === "BLACKOUT") return;
    const liveProgramMode =
      mode === "SPONSOR_ROTATION" ||
      (usesLiveWallClock && mode === "MATCH") ||
      (holdLiveWallOnBreak && (mode === "HALFTIME" || mode === "MATCH"));
    if (!liveProgramMode) {
      if (activeScheduledCue && !holdLiveWallOnBreak) setActiveScheduledCue(null);
      return;
    }
    if (holdLiveWallOnBreak) return;
    if (prematchBlocked) return;
    if (activeScheduledCue) return;
    const due = scheduledCues
      .filter((cue) => {
        if (!cue.enabled || !cue.media?.active || !cuePhaseMatches(cue.matchStatus, match.status)) return false;
        if (!cueIsDueAtElapsed(cue, playhead)) return false;
        if (!cueHasClockWindow(cue) && !(state.timerRunning ?? false) && !usesLiveWallClock) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.triggerSec - b.triggerSec);
    const phaseKey = cueClockPhaseKey(match.status) ?? match.status;
    const cue = due.find((candidate) => {
      const key = `${match.id}:${phaseKey}:${candidate.id}:${scheduledCueCycle}`;
      return !firedScheduledCueKeysRef.current.has(key);
    });
    if (!cue) return;
    firedScheduledCueKeysRef.current.add(`${match.id}:${phaseKey}:${cue.id}:${scheduledCueCycle}`);
    setActiveScheduledCue(cue);
  }, [
    skip,
    activeScheduledCue,
    cueElapsed,
    elapsed,
    match,
    mode,
    playhead,
    scheduledCueCycle,
    scheduledCues,
    state,
    prematchBlocked,
    usesLiveWallClock,
    holdLiveWallOnBreak,
  ]);

  useEffect(() => {
    if (skip || !activeScheduledCue) return;
    if (prematchBlocked) {
      setActiveScheduledCue(null);
      return;
    }
    if (rundownLoops) {
      if (cueLeftClockWindow(activeScheduledCue, playhead)) {
        setActiveScheduledCue(null);
      }
      return;
    }
    if (cueWindowExpired(activeScheduledCue, cueElapsed)) {
      setActiveScheduledCue(null);
    }
  }, [skip, activeScheduledCue, cueElapsed, playhead, rundownLoops, prematchBlocked]);

  useEffect(() => {
    if (skip) return;
    if (!activeScheduledCue || activeScheduledCue.media.type !== "IMAGE") return;
    if (cueHasClockWindow(activeScheduledCue)) return;
    const dur = activeScheduledCue.media.durationSec;
    const sec = typeof dur === "number" && Number.isFinite(dur) && dur > 0 ? dur : 10;
    const ms = Math.max(1500, sec * 1000);
    const id = window.setTimeout(() => setActiveScheduledCue(null), ms);
    return () => window.clearTimeout(id);
  }, [skip, activeScheduledCue]);

  return skip
    ? { activeScheduledCue: null, scheduledCueCycle: 0, dismissActiveScheduledCue: () => {} }
    : { activeScheduledCue, scheduledCueCycle, dismissActiveScheduledCue };
}
