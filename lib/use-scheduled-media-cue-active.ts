"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DisplayStatePayload } from "@/lib/desktop-bridge";
import type { Match, ScheduledMediaCue } from "@/lib/types";
import {
  computePrematchRundownClock,
  cueClockPhaseKey,
  cueHasClockWindow,
  cueLeftClockWindow,
  cuePhaseMatches,
  cueResumesAfterInterruption,
  cueUsesLiveWallClock,
  pickDueScheduledCue,
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
import { scheduledCueLiveProgramActive } from "@/lib/live-cycle-settings";

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
  /** 0 bij de eerste keer in beeld; 1, 2, … als de cue na een onderbreking terugkomt. */
  scheduledCueStint: number;
  /** Speelkop binnen de rundown, in seconden: zegt hoeveel van het venster van de cue al voorbij is. */
  scheduledCuePlayheadSec: number;
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
  /** Hoe vaak een cue in deze doorloop al onderbroken is; een terugkeer telt als nieuw stuk schermtijd. */
  const interruptedCountRef = useRef<Map<string, number>>(new Map());
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

  // Deze twee lopen vóór het scherm tekent, in deze volgorde. Zo staat er na een onderbreking nooit
  // één beeld lang "geen clip" op het scherm voordat de sponsor terugkomt.
  useLayoutEffect(() => {
    if (skip) {
      setActiveScheduledCue(null);
      firedScheduledCueKeysRef.current.clear();
      interruptedCountRef.current.clear();
      return;
    }
    const prev = lastScheduledCueClockRef.current;
    const matchId = match?.id ?? null;
    const status = cueClockPhaseKey(
      holdLiveWallOnBreak ? (persistedLiveWallClock.block ?? match?.status) : match?.status,
    );
    if (prev.matchId !== matchId || prev.status !== status || cueElapsed < prev.elapsed - 1) {
      firedScheduledCueKeysRef.current.clear();
      interruptedCountRef.current.clear();
      setActiveScheduledCue(null);
    }
    lastScheduledCueClockRef.current = { matchId, status, elapsed: cueElapsed };
  }, [skip, match?.id, match?.status, cueElapsed, holdLiveWallOnBreak, persistedLiveWallClock.block]);

  /** Onthoudt per doorloop welke cue al gestart is. */
  const startedKeyOf = (cue: ScheduledMediaCue, matchId: string, matchStatus: string) =>
    `${matchId}:${cueClockPhaseKey(matchStatus) ?? matchStatus}:${cue.id}:${scheduledCueCycle}`;

  /** De cue die nu hoort te starten, of null. Telt meteen als gestart in deze doorloop. */
  const takeDueCue = (): ScheduledMediaCue | null => {
    if (!state || !match || mode === "BLACKOUT") return null;
    if (!scheduledCueLiveProgramActive(mode, holdLiveWallOnBreak)) return null;
    if (holdLiveWallOnBreak || prematchBlocked) return null;
    const keyOf = (cue: ScheduledMediaCue) => startedKeyOf(cue, match.id, match.status);
    const cue = pickDueScheduledCue(scheduledCues, {
      matchStatus: match.status,
      playheadSec: playhead,
      clockRuns: (state.timerRunning ?? false) || usesLiveWallClock,
      alreadyStarted: (candidate) => firedScheduledCueKeysRef.current.has(keyOf(candidate)),
    });
    if (cue) firedScheduledCueKeysRef.current.add(keyOf(cue));
    return cue;
  };

  useLayoutEffect(() => {
    if (skip) return;
    if (!state || !match || mode === "BLACKOUT") return;
    // "Alleen scorebord" is een harde opt-out, ook voor Volleybal zonder wedstrijdklok.
    // Een lopende cue verdwijnt hieronder bij de wissel naar MATCH.
    const liveProgramMode = scheduledCueLiveProgramActive(mode, holdLiveWallOnBreak);
    if (!liveProgramMode) {
      if (activeScheduledCue) {
        // Een losse clip, goal of kaart haalt de sponsor even weg. Loopt zijn venster daarna nog,
        // dan komt hij terug; anders bleef het scherm tot de volgende sponsor op het scorebord staan.
        if (cueResumesAfterInterruption(activeScheduledCue)) {
          const key = startedKeyOf(activeScheduledCue, match.id, match.status);
          firedScheduledCueKeysRef.current.delete(key);
          interruptedCountRef.current.set(key, (interruptedCountRef.current.get(key) ?? 0) + 1);
        }
        setActiveScheduledCue(null);
      }
      return;
    }
    if (activeScheduledCue) return;
    const cue = takeDueCue();
    if (cue) setActiveScheduledCue(cue);
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
    const windowOver = rundownLoops
      ? cueLeftClockWindow(activeScheduledCue, playhead)
      : cueWindowExpired(activeScheduledCue, cueElapsed);
    if (!windowOver) return;
    // Meteen door naar de clip die aansluit. Eerst even "geen clip" melden haalt het hele vak met
    // scorebord en sponsor weg en bouwt het daarna opnieuw op: het publiek ziet dan het volledige
    // scherm flitsen bij elke sponsorwissel, in plaats van alleen de sponsor die verandert.
    setActiveScheduledCue(takeDueCue());
    // takeDueCue leest de waarden van deze render; de speelkop hieronder bepaalt wanneer dit loopt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const scheduledCueStint =
    activeScheduledCue && match
      ? (interruptedCountRef.current.get(startedKeyOf(activeScheduledCue, match.id, match.status)) ?? 0)
      : 0;

  return skip
    ? {
        activeScheduledCue: null,
        scheduledCueCycle: 0,
        scheduledCueStint: 0,
        scheduledCuePlayheadSec: 0,
        dismissActiveScheduledCue: () => {},
      }
    : {
        activeScheduledCue,
        scheduledCueCycle,
        scheduledCueStint,
        scheduledCuePlayheadSec: playhead,
        dismissActiveScheduledCue,
      };
}
