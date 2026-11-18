"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MediaItem, ScheduledMediaCue } from "@/lib/types";
import { cueClipSessionId, cueExpectedPlaySec } from "@/lib/scheduled-media-cue";
import { sectionForStatus } from "@/lib/sponsor-display-helpers";
import {
  SCHEDULED_CUE_SPONSOR_ID,
  sponsorTelemetrySegmentKey,
  type SponsorPlaySource,
} from "@/lib/sponsor-telemetry";
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

/** Eén vertoning van een losse laag (cue of handmatige clip). */
export type VisiblePlay = {
  /** Naam waaronder de mediacomponent "getoond" meldt. */
  key: string;
  clipSessionId: string;
  sponsorId: string;
  mediaId: string;
  mediaType: MediaItem["type"];
  expectedPlaySec: number;
  source: SponsorPlaySource;
};

type PlaySession = VisiblePlay & {
  matchId: string;
  segmentKey: string;
  clock: VisiblePlayClock;
  started: boolean;
  startedAtMs: number;
  interval: number | null;
};

export type VisiblePlayTelemetry = {
  /** De mediacomponent meldt dat het beeld van vertoning `key` op het scherm staat. */
  onShown: (key: string, positionSec?: number) => void;
  /** Echte speelkop van een video. */
  onPlayheadSec: (sec: number) => void;
};

/**
 * Proof-of-play voor een laag die boven de sponsorrotatie ligt (cue uit de rundown, of een
 * sponsorclip die de operator met de hand start).
 *
 * Geteld wordt alleen wat echt zichtbaar was, met hetzelfde bewijs als de sponsorrotatie: de
 * klok start als de foto gedecodeerd is of het eerste videoframe getekend is, staat stil zolang
 * de laag niet op het scherm staat (`visible`), en een video telt alleen de vooruitgang van zijn
 * speelkop. Vroeger telde de tijd tussen openen en sluiten, ook als de cue onder een
 * goal-overlay of in een verborgen venster stond.
 */
export function useVisiblePlayTelemetry(opts: {
  play: VisiblePlay | null;
  match: { id: string; status: string } | null;
  enabled: boolean;
  /** De laag staat nu echt op het scherm (getekend, niet bedekt, venster zichtbaar). */
  visible: boolean;
}): VisiblePlayTelemetry {
  const { play, match, enabled, visible } = opts;
  const playRef = useRef(play);
  playRef.current = play;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const sessionRef = useRef<PlaySession | null>(null);
  /** "Getoond" kan binnenkomen vóór deze hook de sessie opzet (effecten van kinderen lopen eerst). */
  const pendingShownRef = useRef<{ key: string; atMs: number; positionSec?: number } | null>(null);

  const startIfShown = useCallback((session: PlaySession) => {
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
      source: session.source,
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
    const current = playRef.current;
    if (!enabled || !current || !match) return;
    const section = sectionForStatus(match.status);
    const segmentKey = sponsorTelemetrySegmentKey(match.id, match.status, section);
    if (!segmentKey) return;

    const session: PlaySession = {
      ...current,
      matchId: match.id,
      segmentKey,
      clock: createVisiblePlayClock(current.mediaType === "VIDEO" ? "VIDEO" : "IMAGE", !visibleRef.current),
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
        ...(actualSec > 0 ? {} : { discard: true, reason: "not_visible" }),
      });
    };
    // De vertoning is één sessie-id; de rest van `play` hoort daarbij.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, play?.clipSessionId, match?.id, match?.status]);

  // Bedekt of venster verborgen: de klok staat stil tot de laag weer zichtbaar is.
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

/** Naam van één keer in beeld van een cue; de mediacomponent meldt "getoond" onder deze naam. */
export function scheduledCueShownKey(
  cue: { id: string; media: { id: string } } | null,
  cycle: number,
  stint: number,
): string {
  return cue ? `cue:${cue.id}:${cue.media.id}:${cycle}:${stint}` : "";
}

/**
 * Rundown-cues liggen boven de sponsorlaag. Zonder deze bridge schrijven ze geen
 * proof-of-play, terwijl ze wél het stadionscherm innemen (o.a. POST_MATCH).
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
}): VisiblePlayTelemetry {
  const { cue, cycle, match, stint = 0 } = opts;
  // Alleen bij de start gelezen; de speelkop loopt door en mag de vertoning niet vernieuwen.
  const playheadRef = useRef(opts.playheadSec);
  playheadRef.current = opts.playheadSec;
  const clipSessionId =
    cue && match
      ? cueClipSessionId({ matchId: match.id, cueId: cue.id, cycle, mediaId: cue.media.id, stint })
      : null;
  const play = useMemo<VisiblePlay | null>(() => {
    if (!cue || !clipSessionId) return null;
    return {
      key: scheduledCueShownKey(cue, cycle, stint),
      clipSessionId,
      sponsorId: cue.media.sponsorId ?? SCHEDULED_CUE_SPONSOR_ID,
      mediaId: cue.media.id,
      mediaType: cue.media.type,
      // Een cue blijft staan tot zijn venster om is. De duur van de foto zelf melden liet de
      // operator "0,0 s resterend" zien terwijl het beeld nog seconden bleef staan.
      expectedPlaySec: cueExpectedPlaySec(cue, playheadRef.current),
      source: "cue",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipSessionId]);
  return useVisiblePlayTelemetry({ play, match, enabled: opts.enabled, visible: opts.visible });
}

/** Naam van één handmatig gestarte sponsorclip. */
export function manualSponsorPlayKey(mediaId: string, startedAtMs: number): string {
  return `manual:${mediaId}:${startedAtMs}`;
}
