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
  sectionPlayheadExhausted,
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
import { periodStartHoldsFullScoreboard } from "@/lib/live-cycle-settings";
import {
  streamSponsorInterrupted,
  streamSponsorTimelineSeconds,
} from "@/lib/stream-sponsor-schedule";
import { useResolvedSponsorWindow } from "@/lib/use-resolved-sponsor-window";
import {
  sponsorMatchClockFrozen,
  sponsorWallPlayTimelineComplete,
  windowScheduleElapsed,
  windowTimelineSeconds,
  buildWindowSponsorSlotMap,
} from "@/lib/sponsor-windows";
import { sponsorPlayWallElapsedSec } from "@/lib/scheduled-media-cue";
import { getSportProfile } from "@/lib/sports";
import type { Match, ScheduledMediaCue, Sponsor, SponsorSection } from "@/lib/types";
import {
  externalCaptureCoversDisplay,
  timeoutCoversDisplay,
} from "@/lib/sponsor-playback-interruption";

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

  const timerRunning = state?.timerRunning ?? false;
  const sponsorWindow = useResolvedSponsorWindow(
    match,
    timerRunning,
    !!state?.sponsorPeriodBreakPending,
    null,
  );
  const section = sectionForStatus(match?.status);
  const overlayInterrupt =
    streamSponsorInterrupted(mode) ||
    activeScheduledCue != null ||
    externalCaptureCoversDisplay(state) ||
    timeoutCoversDisplay(state);
  const matchClockFrozen = sponsorMatchClockFrozen(sponsorWindow, timerRunning);
  const interrupted = overlayInterrupt || matchClockFrozen;
  const timelineH = useMemo(() => {
    if (match && sponsorWindow && (section === "match" || sponsorWindow.section === section)) {
      return windowTimelineSeconds(sponsorWindow, match, sponsors);
    }
    return streamSponsorTimelineSeconds(section, match, sponsors);
  }, [
    section,
    match,
    sponsorWindow,
    sponsors,
  ]);

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
    if (match && sponsorWindow && (section === "match" || sponsorWindow.section === section)) {
      return buildWindowSponsorSlotMap(sponsors, sponsorWindow, match);
    }
    const active = activeSponsorsForSection(sponsors, section, match?.status);
    return buildSponsorSlotMap(active, section, timelineH, match?.status);
  }, [sponsors, section, match, timelineH, sponsorWindow]);

  useEffect(() => {
    if (!match || slotMap.length === 0) {
      setCurrentId((prev) => (prev == null ? prev : null));
      return;
    }
    const tickKey = `${now}|${elapsed}|${interrupted}|${section}|${match.status}|${timelineH}`;
    const nextId = applySponsorSpreadTick(tickCacheRef, tickKey, () => {
      const key = `${match.id}:${match.status}:${section}`;
      let rawT = 0;

      if (section === "match") {
        rawT = sponsorWindow
          ? windowScheduleElapsed({
              window: sponsorWindow,
              elapsedSec: elapsed,
              status: match.status,
              halfDurationSec: match.halfDurationSec,
              periodDurationSec: match.periodDurationSec,
              currentPeriod: match.currentPeriod,
              periodCount: getSportProfile(match.sport).periodCount,
              wallElapsedSec: sponsorPlayWallElapsedSec({
                state,
                localEpochMs: epochRef.current,
                nowMs: now,
              }),
            })
          : halfWindowElapsed(elapsed, match.status, match.halfDurationSec);
        if (
          periodStartHoldsFullScoreboard({
            matchStatus: match.status,
            halfElapsedSec: rawT,
            timerRunning,
            wallClockPlay:
              !!sponsorWindow && !sponsorWindow.footballEngine && sponsorWindow.clock === "wall",
          })
        ) {
          hangRef.current = null;
          return null;
        }
      } else if (section === "prematch") {
        const timing = computePrematchSpreadTiming(match, sponsors, now, epochRef.current);
        if (timing.beforeWindow || timing.timelineComplete || !timing.rosterRunning) {
          hangRef.current = null;
          return null;
        }
        rawT = prematchSpreadClock(timing.elapsedSec, timing.timelineLenSec).t;
      } else {
        const origin = epochRef.current ?? now;
        rawT = (now - origin) / 1000;
      }

      const t = sponsorScheduleTime(clockRef, key, rawT, interrupted, timelineH);
      if (clockRef.current.hardReset) hangRef.current = null;
      if (
        section === "match" &&
        sponsorWindow &&
        sponsorWallPlayTimelineComplete({
          clock: sponsorWindow.clock,
          section: sponsorWindow.section,
          cycleBudgetForever: false,
          wallElapsedSec: t,
          timelineSec: timelineH,
        })
      ) {
        hangRef.current = null;
        return null;
      }
      if (section !== "match" && section !== "prematch" && sectionPlayheadExhausted(t, timelineH, false)) {
        hangRef.current = null;
        return null;
      }
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
  }, [
    match,
    slotMap,
    sponsors,
    section,
    elapsed,
    now,
    interrupted,
    timelineH,
    sponsorWindow,
    timerRunning,
    state?.matchId,
    state?.liveWallCueOrigin,
    state?.liveWallCueBlock,
    state?.liveWallCueFrozenSec,
  ]);

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
