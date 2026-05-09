"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { DisplayStatePayload } from "@/lib/desktop-bridge";
import type { Match, ScheduledMediaCue } from "@/lib/types";

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

  const dismissActiveScheduledCue = useCallback(() => {
    setActiveScheduledCue(null);
  }, []);

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
    const status = match?.status ?? null;
    if (prev.matchId !== matchId || prev.status !== status || elapsed < prev.elapsed - 1) {
      firedScheduledCueKeysRef.current.clear();
      setActiveScheduledCue(null);
    }
    lastScheduledCueClockRef.current = { matchId, status, elapsed };
  }, [skip, match?.id, match?.status, elapsed]);

  useEffect(() => {
    if (skip) return;
    if (!state || !match || mode === "BLACKOUT") return;
    if (activeScheduledCue || !(state.timerRunning ?? false)) return;
    const due = scheduledCues
      .filter(
        (cue) =>
          cue.enabled &&
          cue.media?.active &&
          cue.matchStatus === match.status &&
          elapsed >= cue.triggerSec &&
          elapsed - cue.triggerSec <= 2,
      )
      .sort((a, b) => a.triggerSec - b.triggerSec);
    const cue = due.find((candidate) => {
      const key = `${match.id}:${match.status}:${candidate.id}`;
      return !firedScheduledCueKeysRef.current.has(key);
    });
    if (!cue) return;
    firedScheduledCueKeysRef.current.add(`${match.id}:${match.status}:${cue.id}`);
    setActiveScheduledCue(cue);
  }, [skip, activeScheduledCue, elapsed, match, mode, scheduledCues, state]);

  useEffect(() => {
    if (skip) return;
    if (!activeScheduledCue || activeScheduledCue.media.type !== "IMAGE") return;
    const ms = Math.max(1500, Math.max(1, activeScheduledCue.media.durationSec) * 1000);
    const id = window.setTimeout(() => setActiveScheduledCue(null), ms);
    return () => window.clearTimeout(id);
  }, [skip, activeScheduledCue]);

  return skip
    ? { activeScheduledCue: null, dismissActiveScheduledCue: () => {} }
    : { activeScheduledCue, dismissActiveScheduledCue };
}
