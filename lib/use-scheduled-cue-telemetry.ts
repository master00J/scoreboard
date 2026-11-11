"use client";

import { useEffect, useRef } from "react";
import type { ScheduledMediaCue } from "@/lib/types";
import { cueClipSessionId, cueExpectedPlaySec } from "@/lib/scheduled-media-cue";
import { sectionForStatus } from "@/lib/sponsor-display-helpers";
import { SCHEDULED_CUE_SPONSOR_ID, sponsorTelemetrySegmentKey } from "@/lib/sponsor-telemetry";
import {
  reportSponsorClipEnd,
  reportSponsorClipProgress,
  reportSponsorClipStart,
} from "@/lib/use-socket";

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
}) {
  const { cue, cycle, match, enabled, stint = 0 } = opts;
  const startedAtRef = useRef(0);
  // Alleen bij de start gelezen; de speelkop loopt door en mag de melding niet opnieuw starten.
  const playheadRef = useRef(opts.playheadSec);
  playheadRef.current = opts.playheadSec;

  useEffect(() => {
    if (!enabled || !cue || !match) return;
    const section = sectionForStatus(match.status);
    const segmentKey = sponsorTelemetrySegmentKey(match.id, match.status, section);
    if (!segmentKey) return;

    const sponsorId = cue.media.sponsorId ?? SCHEDULED_CUE_SPONSOR_ID;
    const clipSessionId = cueClipSessionId({ cueId: cue.id, cycle, mediaId: cue.media.id, stint });
    const startedAtMs = Date.now();
    startedAtRef.current = startedAtMs;
    // Een cue blijft staan tot zijn venster om is. De duur van de foto zelf melden liet de
    // operator "0,0 s resterend" zien terwijl het beeld nog seconden bleef staan.
    const expectedPlaySec = cueExpectedPlaySec(cue, playheadRef.current);

    void reportSponsorClipStart({
      matchId: match.id,
      segmentKey,
      sponsorId,
      mediaId: cue.media.id,
      expectedPlaySec,
      clipSessionId,
      startedAtMs,
      playbackPositionMs: 0,
      paused: false,
    });

    const interval = window.setInterval(() => {
      void reportSponsorClipProgress({
        matchId: match.id,
        segmentKey,
        clipSessionId,
        playbackPositionMs: Math.max(0, Date.now() - startedAtRef.current),
        paused: false,
        startedAtMs: startedAtRef.current,
      });
    }, 500);

    return () => {
      window.clearInterval(interval);
      const actualSec = Math.max(0.1, (Date.now() - startedAtRef.current) / 1000);
      void reportSponsorClipEnd({
        matchId: match.id,
        segmentKey,
        sponsorId,
        mediaId: cue.media.id,
        actualSec,
        clipSessionId,
        startedAtMs: startedAtRef.current,
      });
    };
  }, [
    enabled,
    cue?.id,
    cue?.triggerSec,
    cue?.endSec,
    cue?.media.id,
    cue?.media.sponsorId,
    cue?.media.durationSec,
    cycle,
    stint,
    match?.id,
    match?.status,
  ]);
}
