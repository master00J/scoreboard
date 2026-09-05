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
  cueWindowExpired,
  isPostMatchCuePhase,
  isPrematchCuePhase,
  phaseRundownLoops,
  postMatchCueElapsedSec,
  rundownCycleIndex,
  rundownCycleSec,
  wrapRundownElapsed,
} from "@/lib/scheduled-media-cue";

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

  useEffect(() => {
    if (skip || !usesPostMatchClock) {
      if (!usesPrematchClock) setWallPhaseElapsed(0);
      return;
    }
    const tick = () =>
      setWallPhaseElapsed(postMatchCueElapsedSec(state?.postMatchStartedAt, Date.now()));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [skip, match?.id, match?.status, usesPostMatchClock, usesPrematchClock, state?.postMatchStartedAt]);

  useEffect(() => {
    if (skip || !usesPrematchClock) {
      setPrematchGate({ beforeWindow: false, pastKickoff: false });
      if (!usesPostMatchClock) setWallPhaseElapsed(0);
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
    state?.preMatchStartedAt,
  ]);

  const cueElapsed = usesPostMatchClock || usesPrematchClock ? wallPhaseElapsed : elapsed;
  const prematchBlocked = usesPrematchClock && (prematchGate.beforeWindow || prematchGate.pastKickoff);
  const playhead = wrapRundownElapsed(cueElapsed, cycleSec, rundownLoops);
  const scheduledCueCycle = rundownCycleIndex(cueElapsed, cycleSec, rundownLoops);

  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    fetch("/api/scheduled-media-cues")
      .then((r) => r.json())
      .then((list: ScheduledMediaCue[]) => {
        if (cancelled) return;
        setScheduledCues(list ?? []);
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
    const status = cueClockPhaseKey(match?.status);
    if (prev.matchId !== matchId || prev.status !== status || elapsed < prev.elapsed - 1) {
      firedScheduledCueKeysRef.current.clear();
      setActiveScheduledCue(null);
    }
    lastScheduledCueClockRef.current = { matchId, status, elapsed };
  }, [skip, match?.id, match?.status, elapsed]);

  useEffect(() => {
    if (skip) return;
    if (!state || !match || mode === "BLACKOUT") return;
    if (mode !== "SPONSOR_ROTATION") {
      if (activeScheduledCue) setActiveScheduledCue(null);
      return;
    }
    if (prematchBlocked) return;
    if (activeScheduledCue) return;
    const due = scheduledCues
      .filter((cue) => {
        if (!cue.enabled || !cue.media?.active || !cuePhaseMatches(cue.matchStatus, match.status)) return false;
        if (!cueIsDueAtElapsed(cue, playhead)) return false;
        if (!cueHasClockWindow(cue) && !(state.timerRunning ?? false)) return false;
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
    const ms = Math.max(1500, Math.max(1, activeScheduledCue.media.durationSec) * 1000);
    const id = window.setTimeout(() => setActiveScheduledCue(null), ms);
    return () => window.clearTimeout(id);
  }, [skip, activeScheduledCue]);

  return skip
    ? { activeScheduledCue: null, scheduledCueCycle: 0, dismissActiveScheduledCue: () => {} }
    : { activeScheduledCue, scheduledCueCycle, dismissActiveScheduledCue };
}
