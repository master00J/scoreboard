"use client";

import { useEffect, useRef } from "react";
import type { ScheduledMediaCue } from "@/lib/types";
import { sectionForStatus } from "@/lib/sponsor-display-helpers";
import { sponsorTelemetrySegmentKey } from "@/lib/sponsor-telemetry";
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
  match: { id: string; status: string } | null;
  enabled: boolean;
}) {
  const { cue, cycle, match, enabled } = opts;
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (!enabled || !cue || !match) return;
    const section = sectionForStatus(match.status);
    const segmentKey = sponsorTelemetrySegmentKey(match.id, match.status, section);
    if (!segmentKey) return;

    const sponsorId = cue.media.sponsorId ?? "scheduled-cue";
    const clipSessionId = `cue:${cue.id}:${cycle}:${cue.media.id}`;
    const startedAtMs = Date.now();
    startedAtRef.current = startedAtMs;
    const expectedPlaySec = Math.max(1, cue.media.durationSec || 15);

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
  }, [enabled, cue?.id, cue?.media.id, cue?.media.sponsorId, cue?.media.durationSec, cycle, match?.id, match?.status]);
}
