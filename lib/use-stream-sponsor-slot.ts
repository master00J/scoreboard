"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDisplayStore } from "@/lib/store";
import { useLiveTimerSeconds } from "@/lib/use-timer";
import { useWallClockMs } from "@/lib/use-wall-clock-tick";
import { useScheduledMediaCueActive } from "@/lib/use-scheduled-media-cue-active";
import {
  activeSponsorsForSection,
  buildSponsorSlotMap,
  halfWindowElapsed,
  lookupSponsorAtSecond,
  prematchSpreadClock,
  resolveSponsorSpreadPhase,
  sectionSpreadClock,
  type SponsorPhaseHangRef,
} from "@/lib/sponsor-distribution";
import { sectionForStatus } from "@/lib/sponsor-display-helpers";
import { computePrematchSpreadTiming } from "@/lib/prematch-spread-timing";
import {
  createSponsorScheduleClock,
  sponsorScheduleTime,
  type SponsorScheduleClock,
} from "@/lib/sponsor-schedule-clock";
import { applySponsorSpreadTick } from "@/lib/sponsor-spread-tick";
import {
  streamSponsorInterrupted,
  streamSponsorTimelineSeconds,
} from "@/lib/stream-sponsor-schedule";
import type { Match, ScheduledMediaCue, Sponsor, SponsorSection } from "@/lib/types";

export type StreamSponsorSlotView = {
  sponsors: Sponsor[];
  section: SponsorSection;
  current: Sponsor | null;
  interrupted: boolean;
  matchStatus: string | undefined;
  activeScheduledCue: ScheduledMediaCue | null;
  dismissActiveScheduledCue: () => void;
};

export function useStreamSponsorSlot(match: Match | null): StreamSponsorSlotView {
  const state = useDisplayStore((s) => s.state);
  const mode = state?.mode ?? "IDLE";
  const elapsed = useLiveTimerSeconds();
  const now = useWallClockMs(400);
  const { activeScheduledCue, dismissActiveScheduledCue } = useScheduledMediaCueActive({
    match,
    state,
    mode,
    elapsed,
  });

  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetch("/api/sponsors")
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          if (!cancelled && Array.isArray(data)) setSponsors(data);
        })
        .catch(() => undefined);
    };
    load();
    const id = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const section = sectionForStatus(match?.status);
  const overlayInterrupt = streamSponsorInterrupted(mode) || activeScheduledCue != null;
  const matchClockFrozen = section === "match" && !(state?.timerRunning ?? false);
  const interrupted = overlayInterrupt || matchClockFrozen;
  const timelineH = useMemo(
    () => streamSponsorTimelineSeconds(section, match, sponsors),
    [section, match?.halfDurationSec, match?.halfBreakSec, match?.prematchSpreadWindowSec, sponsors],
  );

  const hangRef = useRef<SponsorPhaseHangRef["current"]>(null);
  const clockRef = useRef<SponsorScheduleClock>(createSponsorScheduleClock());
  const epochRef = useRef<number | null>(null);
  const tickCacheRef = useRef<{ key: string; value: string | null } | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);

  useEffect(() => {
    hangRef.current = null;
    clockRef.current.initialized = false;
    tickCacheRef.current = null;
    epochRef.current = Date.now();
  }, [match?.id, match?.status, section]);

  const slotMap = useMemo(() => {
    const active = activeSponsorsForSection(sponsors, section, match?.status);
    return buildSponsorSlotMap(active, section, timelineH, match?.status);
  }, [sponsors, section, match?.status, timelineH]);

  useEffect(() => {
    if (!match || slotMap.length === 0) {
      setCurrentId((prev) => (prev == null ? prev : null));
      return;
    }
    const tickKey = `${now}|${elapsed}|${interrupted}|${section}|${match.status}|${timelineH}`;
    const nextId = applySponsorSpreadTick(tickCacheRef, tickKey, () => {
      const key = `${match.id}:${match.status}:${section}`;
      let rawT = 0;
      let complete = false;

      if (section === "match") {
        rawT = halfWindowElapsed(elapsed, match.status, match.halfDurationSec);
      } else if (section === "prematch") {
        const timing = computePrematchSpreadTiming(match, sponsors, now, epochRef.current);
        if (timing.beforeWindow || timing.timelineComplete || !timing.rosterRunning) {
          hangRef.current = null;
          return null;
        }
        const clock = prematchSpreadClock(timing.elapsedSec, timing.timelineLenSec);
        rawT = clock.t;
        complete = clock.timelineComplete;
      } else {
        const origin = epochRef.current ?? now;
        const spread = sectionSpreadClock((now - origin) / 1000, timelineH, false);
        rawT = spread.t;
        complete = spread.timelineComplete;
      }

      if (complete) {
        hangRef.current = null;
        return null;
      }

      const t = sponsorScheduleTime(clockRef, key, rawT, interrupted, timelineH);
      if (clockRef.current.hardReset) hangRef.current = null;
      const raw = lookupSponsorAtSecond(slotMap, t);
      const resolved = resolveSponsorSpreadPhase(raw, sponsors, section, match.status, now, hangRef, {
        slotMap,
        slotT: t,
        interrupted,
      });
      if (resolved.phase !== "sponsor" || !resolved.sponsorFilterId) return null;
      return resolved.sponsorFilterId;
    });
    setCurrentId((prev) => (prev === nextId ? prev : nextId));
  }, [match, slotMap, sponsors, section, elapsed, now, interrupted, timelineH]);

  const current = useMemo(
    () => (currentId ? (sponsors.find((s) => s.id === currentId) ?? null) : null),
    [sponsors, currentId],
  );

  return {
    sponsors,
    section,
    current,
    interrupted,
    matchStatus: match?.status,
    activeScheduledCue,
    dismissActiveScheduledCue,
  };
}
