"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ScheduledMediaCue } from "@/lib/types";
import { cueClipSessionId, cueExpectedPlaySec } from "@/lib/scheduled-media-cue";
import { sectionForStatus } from "@/lib/sponsor-display-helpers";
import { SCHEDULED_CUE_SPONSOR_ID, sponsorTelemetrySegmentKey } from "@/lib/sponsor-telemetry";
import {
  billableVisibleSec,
  createVisiblePlayClock,
  markVisiblePlayShown,
  observeVisiblePlayPosition,
  setVisiblePlayPaused,
  visiblePlayMs,
  visiblePlayShown,
  type VisiblePlayClock,
} from "@/lib/visible-play-clock";
import {
  reportSponsorClipEnd,
  reportSponsorClipProgress,
  reportSponsorClipStart,
} from "@/lib/use-socket";

type CueSession = {
  key: string;
  matchId: string;
  segmentKey: string;
  sponsorId: string;
  mediaId: string;
  clipSessionId: string;
  expectedPlaySec: number;
  clock: VisiblePlayClock;
  started: boolean;
  startedAtMs: number;
  interval: number | null;
};

/** Naam van één keer in beeld van een cue; de mediacomponent meldt "getoond" onder deze naam. */
export function scheduledCueShownKey(
  cue: { id: string; media: { id: string } } | null,
  cycle: number,
  stint: number,
): string {
  return cue ? `${cue.id}:${cue.media.id}:${cycle}:${stint}` : "";
}

/**
 * Rundown-cues liggen boven de sponsorlaag. Zonder deze bridge schrijven ze geen
 * proof-of-play, terwijl ze wél het stadionscherm innemen (o.a. POST_MATCH).
 *
 * Geteld wordt alleen wat echt zichtbaar was, met hetzelfde bewijs als de sponsorrotatie: de
 * klok start als de foto gedecodeerd is of het eerste videoframe getekend is, staat stil zolang
 * de cue niet op het scherm staat (`visible`), en een video telt alleen de vooruitgang van zijn
 * speelkop. Vroeger telde de tijd tussen openen en sluiten van de cue, ook als hij onder een
 * goal-overlay of in een verborgen venster stond.
 */
export function useScheduledCueTelemetry(opts: {
  cue: ScheduledMediaCue | null;
  cycle: number;
  /** 0 bij de eerste keer in beeld; hoger als de cue na een onderbreking terugkomt. */
  stint?: number;
  match: { id: string; status: string } | null;
  enabled: boolean;
  /** Speelkop binnen de rundown: bepaalt hoeveel van het venster van de cue nog rest als hij start. */
  playheadSec: number;
  /** De cue staat nu echt op het scherm (getekend, niet bedekt, venster zichtbaar). */
  visible: boolean;
}): {
  /** De mediacomponent meldt dat het beeld van de cue `key` op het scherm staat. */
  onShown: (key: string, positionSec?: number) => void;
  /** Echte speelkop van een video-cue. */
  onPlayheadSec: (sec: number) => void;
} {
  const { cue, cycle, match, enabled, stint = 0, visible } = opts;
  // Alleen bij de start gelezen; de speelkop loopt door en mag de melding niet opnieuw starten.
  const playheadRef = useRef(opts.playheadSec);
  playheadRef.current = opts.playheadSec;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const sessionRef = useRef<CueSession | null>(null);
  /** "Getoond" kan binnenkomen vóór deze hook de sessie opzet (effecten van kinderen lopen eerst). */
  const pendingShownRef = useRef<{ key: string; atMs: number; positionSec?: number } | null>(null);
  const shownKey = scheduledCueShownKey(cue, cycle, stint);

  const startIfShown = useCallback((session: CueSession) => {
    if (session.started || !visiblePlayShown(session.clock)) return;
    session.started = true;
    const startedAtMs = Date.now();
    session.startedAtMs = startedAtMs;
    void reportSponsorClipStart({
      matchId: session.matchId,
      segmentKey: session.segmentKey,
      sponsorId: session.sponsorId,
      mediaId: session.mediaId,
      expectedPlaySec: session.expectedPlaySec,
      clipSessionId: session.clipSessionId,
      startedAtMs,
      playbackPositionMs: 0,
      paused: session.clock.paused,
      source: "cue",
      visibleMs: 0,
    });
    session.interval = window.setInterval(() => {
      const now = Date.now();
      const ms = visiblePlayMs(session.clock, now);
      void reportSponsorClipProgress({
        matchId: session.matchId,
        segmentKey: session.segmentKey,
        clipSessionId: session.clipSessionId,
        playbackPositionMs: ms,
        paused: session.clock.paused,
        startedAtMs: now - ms,
        visibleMs: ms,
      });
    }, 500);
  }, []);

  useEffect(() => {
    if (!enabled || !cue || !match) return;
    const section = sectionForStatus(match.status);
    const segmentKey = sponsorTelemetrySegmentKey(match.id, match.status, section);
    if (!segmentKey) return;

    const session: CueSession = {
      key: shownKey,
      matchId: match.id,
      segmentKey,
      sponsorId: cue.media.sponsorId ?? SCHEDULED_CUE_SPONSOR_ID,
      mediaId: cue.media.id,
      clipSessionId: cueClipSessionId({
        matchId: match.id,
        cueId: cue.id,
        cycle,
        mediaId: cue.media.id,
        stint,
      }),
      // Een cue blijft staan tot zijn venster om is. De duur van de foto zelf melden liet de
      // operator "0,0 s resterend" zien terwijl het beeld nog seconden bleef staan.
      expectedPlaySec: cueExpectedPlaySec(cue, playheadRef.current),
      clock: createVisiblePlayClock(cue.media.type === "VIDEO" ? "VIDEO" : "IMAGE", !visibleRef.current),
      started: false,
      startedAtMs: Date.now(),
      interval: null,
    };
    sessionRef.current = session;
    const pending = pendingShownRef.current;
    if (pending && pending.key === session.key) {
      markVisiblePlayShown(session.clock, pending.atMs, pending.positionSec);
      pendingShownRef.current = null;
      startIfShown(session);
    }

    return () => {
      if (session.interval != null) window.clearInterval(session.interval);
      if (sessionRef.current === session) sessionRef.current = null;
      if (!session.started) return; // nooit zichtbaar geweest: niets te melden
      const actualSec = billableVisibleSec(session.clock, Date.now());
      void reportSponsorClipEnd({
        matchId: session.matchId,
        segmentKey: session.segmentKey,
        sponsorId: session.sponsorId,
        mediaId: session.mediaId,
        actualSec,
        clipSessionId: session.clipSessionId,
        startedAtMs: session.startedAtMs,
        ...(actualSec > 0 ? {} : { discard: true, reason: "cue_not_visible" }),
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    cue?.id,
    cue?.triggerSec,
    cue?.endSec,
    cue?.media.id,
    cue?.media.sponsorId,
    cue?.media.durationSec,
    cue?.media.type,
    cycle,
    stint,
    match?.id,
    match?.status,
  ]);

  // Bedekt of venster verborgen: de klok staat stil tot de cue weer zichtbaar is.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    setVisiblePlayPaused(session.clock, !visible, Date.now());
  }, [visible]);

  const onShown = useCallback(
    (key: string, positionSec?: number) => {
      const session = sessionRef.current;
      const now = Date.now();
      if (!session || session.key !== key) {
        pendingShownRef.current = { key, atMs: now, positionSec };
        return;
      }
      markVisiblePlayShown(session.clock, now, positionSec);
      startIfShown(session);
    },
    [startIfShown],
  );

  const onPlayheadSec = useCallback((sec: number) => {
    const session = sessionRef.current;
    if (session) observeVisiblePlayPosition(session.clock, sec, Date.now());
  }, []);

  return { onShown, onPlayheadSec };
}
