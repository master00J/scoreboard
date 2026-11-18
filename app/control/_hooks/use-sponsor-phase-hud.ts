"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import { useDisplayStore } from "@/lib/store";
import { tMatchStatus } from "@/lib/i18n/t-phase";
import { useLiveTimerSeconds } from "@/lib/use-timer";
import { useWallClockMs } from "@/lib/use-wall-clock-tick";
import type { Match, Playlist, PlaylistSlot, Sponsor, SponsorSection, MediaItem } from "@/lib/types";
import { filterMediaForSponsorSpreadSection } from "@/lib/sponsor-match-spread-media";
import { buildSponsorRotationMediaList } from "@/lib/sponsor-playback-order";
import {
  activeSponsorsForSection,
  buildSponsorSlotMap,
  catchUpSponsorSchedule,
  halfWindowElapsed,
  halfWindowElapsedOpenEnded,
  sectionSpreadClock,
  sectionPlayheadExhausted,
  holdSecondsCappedBySlotRun,
  lookupSponsorAtSecond,
  postmatchSpreadTimelineSeconds,
  prematchSpreadTimelineSeconds,
  prematchSpreadClock,
  resolveSponsorSpreadPhase,
} from "@/lib/sponsor-distribution";
import { computePrematchSpreadTiming } from "@/lib/prematch-spread-timing";
import { sponsorRepeatBudgetCyclesFromThemeJson } from "@/lib/scoreboard-theme";
import {
  ledgerActiveClipStillLiveForMatchSegment,
  sponsorLedgerMatchesSegment,
  sponsorTelemetryActiveClipElapsedSec,
  sponsorTelemetrySegmentKey,
} from "@/lib/sponsor-telemetry";
import {
  applySponsorBudgetCapToSpreadPhase,
  allActiveSponsorSectionBudgetsExhausted,
  hudRosterPhase,
  secondsUntilNextSponsorSlot,
  sectionForStatus,
  sponsorBesideShowsPanel,
  sponsorHalftimeShowsPanel,
  sponsorRotationBesideScoreboard,
} from "@/lib/sponsor-display-helpers";
import {
  createSponsorScheduleClock,
  sponsorScheduleLagSec,
  sponsorScheduleTime,
  type SponsorScheduleClock,
} from "@/lib/sponsor-schedule-clock";
import { applySponsorSpreadTick } from "@/lib/sponsor-spread-tick";
import { periodStartHoldsFullScoreboard } from "@/lib/live-cycle-settings";
import { useScheduledMediaCueActive } from "@/lib/use-scheduled-media-cue-active";
import {
  isSponsorPlaybackInterrupted,
  externalCaptureCoversDisplay,
  sponsorRotationStaysActive,
  timeoutCoversDisplay,
} from "@/lib/sponsor-playback-interruption";
import { useResolvedSponsorWindow } from "@/lib/use-resolved-sponsor-window";
import { getSportProfile } from "@/lib/sports";
import {
  activeSponsorsForWindow,
  buildWindowSponsorSlotMap,
  hasSponsorsForSectionOrWindow,
  sponsorMatchClockFrozen,
  sponsorWallPlayTimelineComplete,
  sponsorWindowBudgetResolver,
  windowScheduleElapsed,
  windowTimelineSeconds,
} from "@/lib/sponsor-windows";
import { sponsorPlayWallElapsedSec } from "@/lib/scheduled-media-cue";

export type SponsorPhaseHudModel =
  | { kind: "inactive" }
  | { kind: "playlist_only"; label: string }
  | {
      kind: "roster";
      contextLabel: string;
      phase: "scoreboard" | "sponsor";
      sponsorName: string | null;
      mediaTitle: string | null;
      mediaFileName: string | null;
      mediaKind?: "IMAGE" | "VIDEO" | null;
      hasLiveClip: boolean;
      sponsorClipProgress: number | null;
      nextSlotEtaSec: number | null;
      clipRemainingSec: number | null;
      /**
       * True wanneer de HUD "sponsor bezig" toont op basis van het eigen rooster, terwijl het
       * stadionscherm die clip (nog) niet bevestigt via de telemetry-ledger. De voortgangsbalk
       * is dan een voorspelling, geen meting — de UI moet dat eerlijk tonen i.p.v. een clip te
       * suggereren die misschien nergens speelt.
       */
      playbackUnconfirmed?: boolean;
      /** Rotatie staat stil doordat de externe capture het stadionscherm bedekt. */
      coveredByCapture?: boolean;
      /**
       * Prematch met aftrap: seconden tot het sponsor-venster opent (kickoff − H).
       * HUD mag dan geen misleidende “volgende sponsor over 1 s” tonen op t=0 van de slotmap.
       */
      prematchWindowOpensInSec?: number | null;
      /** Prematch-rooster klaar (aftrap bereikt of tijdlijn uit). */
      prematchTimelineComplete?: boolean;
    };

const EMPTY_PLAYLISTS: Record<PlaylistSlot, Playlist | null> = {
  IDLE: null,
  PREMATCH: null,
  HALFTIME: null,
  POSTMATCH: null,
  GOAL: null,
};

export function useSponsorPhaseHud(match: Match | null): SponsorPhaseHudModel {
  // Niet `t` noemen: dit bestand gebruikt `t` al als schedule-clock (seconden).
  const { t: tUi } = useTranslation();
  const state = useDisplayStore((s) => s.state);
  const sponsorLedger = useDisplayStore((s) => s.sponsorLedger);
  const mode = state?.mode ?? "IDLE";
  const elapsed = useLiveTimerSeconds();
  const wallNowMs = useWallClockMs(200);

  const { activeScheduledCue } = useScheduledMediaCueActive({
    match,
    state,
    mode,
    elapsed,
    skip: false,
  });

  /** Externe capture bedekt het stadionscherm: rotatie pauzeert, budget loopt niet door. */
  const captureCovers = externalCaptureCoversDisplay(state);
  const timeoutCovers = timeoutCoversDisplay(state);

  /** Zelfde onderbrekings-set als het stadionscherm (incl. eenmalige SPONSOR-clip). */
  const sponsorInterrupted = useMemo(
    () => isSponsorPlaybackInterrupted(mode, activeScheduledCue != null, captureCovers, timeoutCovers),
    [activeScheduledCue, captureCovers, timeoutCovers, mode],
  );

  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [mediaLibrary, setMediaLibrary] = useState<MediaItem[]>([]);
  const [playlists, setPlaylists] =
    useState<Record<PlaylistSlot, Playlist | null>>(EMPTY_PLAYLISTS);

  useEffect(() => {
    fetch("/api/sponsors?rotation=1")
      .then((r) => r.json())
      .then((list: Sponsor[]) => setSponsors(Array.isArray(list) ? list : []))
      .catch(() => setSponsors([]));
  }, [state?.updatedAt]);

  useEffect(() => {
    fetch("/api/media")
      .then((r) => r.json())
      .then((list: MediaItem[]) => setMediaLibrary(Array.isArray(list) ? list : []))
      .catch(() => setMediaLibrary([]));
    // Niet aan het sponsor-logboek hangen: dat verandert bij elke voortgangsmelding van een clip,
    // en dan werd de hele mediabibliotheek meermaals per seconde opnieuw opgehaald. Een wijziging
    // in de bibliotheek zelf ververst `updatedAt`.
  }, [state?.updatedAt, state?.activeMediaId]);

  /**
   * Detecteer of de display geconfigureerd is om sponsorbudgetten oneindig te herhalen.
   * Bepaalt of de HUD bij budget-uitputting "klaar" toont (rotatie stopte → scorebord)
   * of doorgaat met balk-visualisatie (oneindige cyclus).
   */
  const [cycleBudgetForever, setCycleBudgetForever] = useState(false);
  const [sponsorLayoutsJson, setSponsorLayoutsJson] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s: { scoreboardThemeJson?: string | null; sponsorLayoutsJson?: string | null } | null) => {
        setCycleBudgetForever(
          sponsorRepeatBudgetCyclesFromThemeJson(s?.scoreboardThemeJson ?? null),
        );
        setSponsorLayoutsJson(s?.sponsorLayoutsJson ?? null);
      })
      .catch(() => setCycleBudgetForever(false));
  }, [state?.updatedAt]);

  useEffect(() => {
    fetch("/api/playlists")
      .then((r) => r.json())
      .then((list: Playlist[]) => {
        if (!Array.isArray(list)) {
          setPlaylists(EMPTY_PLAYLISTS);
          return;
        }
        const map: Record<PlaylistSlot, Playlist | null> = { ...EMPTY_PLAYLISTS };
        for (const p of list) {
          map[p.slot as PlaylistSlot] = p;
        }
        setPlaylists(map);
      })
      .catch(() => setPlaylists(EMPTY_PLAYLISTS));
  }, [state?.updatedAt]);

  const matchTimerRunning = state?.timerRunning ?? false;
  const sponsorWindow = useResolvedSponsorWindow(
    match,
    matchTimerRunning,
    !!state?.sponsorPeriodBreakPending,
    sponsorLayoutsJson,
  );
  const matchClockFrozen = sponsorMatchClockFrozen(sponsorWindow, matchTimerRunning);
  const wallClockPlay = !!sponsorWindow && !sponsorWindow.footballEngine && sponsorWindow.clock === "wall";
  const rotationBudgetSeconds = useMemo(() => {
    if (!match || !sponsorWindow) return undefined;
    return sponsorWindowBudgetResolver(sponsorWindow, match.sport);
  }, [match, sponsorWindow]);
  const hasWindowSponsors =
    !!match &&
    !!sponsorWindow &&
    activeSponsorsForWindow(sponsors, sponsorWindow, match.sport).length > 0;
  const periodBreakActive =
    sponsorWindow?.id === "periodBreak" &&
    mode === "SPONSOR_ROTATION" &&
    !!match &&
    activeSponsorsForWindow(sponsors, sponsorWindow, match.sport).length > 0;

  const sponsorBesideConfigured = useMemo(
    () =>
      !!match &&
      !!state &&
      sponsorRotationBesideScoreboard(match.status) &&
      !periodBreakActive &&
      sponsorBesideShowsPanel(match, sponsors, playlists, hasWindowSponsors),
    [match, state, sponsors, playlists, periodBreakActive, hasWindowSponsors],
  );

  const liveAutoHalftime = useMemo(
    () =>
      periodBreakActive ||
      (!!match &&
        !!state &&
        mode === "SPONSOR_ROTATION" &&
        match.status === "HALF_TIME" &&
        sponsorHalftimeShowsPanel(match, sponsors, playlists, hasWindowSponsors)),
    [match, state, mode, sponsors, playlists, periodBreakActive, hasWindowSponsors],
  );

  const prematchSpreadActive = useMemo(() => {
    if (!state) return false;
    if (
      !hasSponsorsForSectionOrWindow(
        sponsors,
        "prematch",
        match?.status,
        sponsorWindow,
        match?.sport,
      )
    ) {
      return false;
    }
    return !!(
      mode === "SPONSOR_ROTATION" &&
      match &&
      !sponsorRotationBesideScoreboard(match.status) &&
      !liveAutoHalftime &&
      sectionForStatus(match.status) === "prematch"
    );
  }, [state, mode, match, sponsors, liveAutoHalftime, sponsorWindow]);

  const postmatchSpreadActive = useMemo(() => {
    if (!state || !match) return false;
    if (mode !== "SPONSOR_ROTATION") return false;
    if (sectionForStatus(match.status) !== "postmatch") return false;
    return hasSponsorsForSectionOrWindow(
      sponsors,
      "postmatch",
      match.status,
      sponsorWindow,
      match.sport,
    );
  }, [state, match, mode, sponsors, sponsorWindow]);

  const postmatchEpochRef = useRef<number | null>(null);
  useEffect(() => {
    if (postmatchSpreadActive) {
      if (postmatchEpochRef.current == null) postmatchEpochRef.current = Date.now();
    } else {
      postmatchEpochRef.current = null;
      postmatchPhaseHangRef.current = null;
    }
  }, [postmatchSpreadActive]);

  const rustEpochRef = useRef<number | null>(null);
  useEffect(() => {
    if (liveAutoHalftime && (match?.status === "HALF_TIME" || periodBreakActive)) {
      if (rustEpochRef.current == null) rustEpochRef.current = Date.now();
    } else {
      rustEpochRef.current = null;
    }
  }, [match?.status, liveAutoHalftime, periodBreakActive]);

  const playWallEpochRef = useRef<number | null>(null);
  useEffect(() => {
    const wallPlay = sponsorWindow?.clock === "wall" && sponsorWindow.section === "match";
    if (wallPlay) {
      if (playWallEpochRef.current == null) playWallEpochRef.current = Date.now();
    } else {
      playWallEpochRef.current = null;
    }
  }, [sponsorWindow?.clock, sponsorWindow?.section, sponsorWindow?.id, match?.id]);

  const [phaseTick, setPhaseTick] = useState(0);
  useEffect(() => {
    if (
      !sponsorBesideConfigured &&
      !liveAutoHalftime &&
      !prematchSpreadActive &&
      !postmatchSpreadActive
    ) {
      return;
    }
    const id = setInterval(() => setPhaseTick((n) => n + 1), 400);
    return () => clearInterval(id);
  }, [sponsorBesideConfigured, liveAutoHalftime, prematchSpreadActive, postmatchSpreadActive]);

  const sponsorSlotMapMatch = useMemo(() => {
    if (!match || !sponsorWindow) return [] as (string | null)[];
    if (sponsorWindow.footballEngine) {
      const active = activeSponsorsForSection(sponsors, "match", match.status);
      return buildSponsorSlotMap(active, "match", Math.max(60, match.halfDurationSec), match.status);
    }
    return buildWindowSponsorSlotMap(sponsors, sponsorWindow, match);
  }, [match, sponsorWindow, sponsors]);

  const sponsorSlotMapHalftime = useMemo(() => {
    if (!match) return [] as (string | null)[];
    if (sponsorWindow && sponsorWindow.section === "halftime") {
      return buildWindowSponsorSlotMap(sponsors, sponsorWindow, match);
    }
    const active = activeSponsorsForSection(sponsors, "halftime");
    const H = Math.max(60, match.halfBreakSec);
    return buildSponsorSlotMap(active, "halftime", H);
  }, [match, sponsorWindow, sponsors]);

  const sponsorSlotMapPrematch = useMemo(() => {
    if (match && sponsorWindow && sponsorWindow.section === "prematch") {
      return buildWindowSponsorSlotMap(sponsors, sponsorWindow, match);
    }
    const active = activeSponsorsForSection(sponsors, "prematch");
    const H = prematchSpreadTimelineSeconds(match ?? undefined, sponsors);
    return buildSponsorSlotMap(active, "prematch", H);
  }, [sponsors, match, sponsorWindow]);

  const sponsorSlotMapPostmatch = useMemo(() => {
    if (match && sponsorWindow && sponsorWindow.section === "postmatch") {
      return buildWindowSponsorSlotMap(sponsors, sponsorWindow, match);
    }
    const active = activeSponsorsForSection(sponsors, "postmatch");
    return buildSponsorSlotMap(active, "postmatch", postmatchSpreadTimelineSeconds(sponsors));
  }, [sponsors, match, sponsorWindow]);

  const tInterruptFrozen = useRef(0);
  const sponsorPhaseHangRef = useRef<{
    sponsorId: string;
    untilMs: number;
    startedAtMs: number;
    startedAtSlotIdx?: number;
  } | null>(null);
  const postmatchPhaseHangRef = useRef<{
    sponsorId: string;
    untilMs: number;
    startedAtMs: number;
    startedAtSlotIdx?: number;
  } | null>(null);
  const prematchPhaseHangRef = useRef<{
    sponsorId: string;
    untilMs: number;
    startedAtMs: number;
    startedAtSlotIdx?: number;
  } | null>(null);
  const prematchOriginRef = useRef<number | null>(null);
  const sponsorScheduleClockRef = useRef<SponsorScheduleClock>(createSponsorScheduleClock());
  const halftimeScheduleClockRef = useRef<SponsorScheduleClock>(createSponsorScheduleClock());
  const postmatchScheduleClockRef = useRef<SponsorScheduleClock>(createSponsorScheduleClock());
  const prematchScheduleClockRef = useRef<SponsorScheduleClock>(createSponsorScheduleClock());

  useEffect(() => {
    sponsorPhaseHangRef.current = null;
    prematchPhaseHangRef.current = null;
    prematchOriginRef.current = null;
    sponsorScheduleClockRef.current.initialized = false;
    halftimeScheduleClockRef.current.initialized = false;
    prematchScheduleClockRef.current.initialized = false;
  }, [match?.id]);

  const matchSponsorRotationWasActiveRef = useRef(false);

  useEffect(() => {
    sponsorPhaseHangRef.current = null;
    sponsorScheduleClockRef.current.initialized = false;
    halftimeScheduleClockRef.current.initialized = false;
    matchSponsorRotationWasActiveRef.current = false;
  }, [match?.status, sponsorBesideConfigured, liveAutoHalftime]);

  useEffect(() => {
    if (!prematchSpreadActive) {
      prematchOriginRef.current = null;
      prematchPhaseHangRef.current = null;
      prematchScheduleClockRef.current.initialized = false;
    }
  }, [prematchSpreadActive]);

  useEffect(() => {
    if (prematchSpreadActive && prematchOriginRef.current == null) {
      prematchOriginRef.current = Date.now();
    }
  }, [prematchSpreadActive]);

  const sponsorDistTickRef = useRef<{ key: string; value: { phase: "scoreboard" | "sponsor"; sponsorFilterId: string | null } } | null>(null);
  const prematchDistTickRef = useRef<{ key: string; value: { phase: "scoreboard" | "sponsor"; sponsorFilterId: string | null } } | null>(null);
  const postmatchDistTickRef = useRef<{ key: string; value: { phase: "scoreboard" | "sponsor"; sponsorFilterId: string | null } } | null>(null);

  const sponsorDistView = useMemo(() => {
    const tickKey = `${phaseTick}|${elapsed}|${mode}|${Number(matchTimerRunning)}|${Number(sponsorInterrupted)}|${match?.id}|${match?.status}`;
    return applySponsorSpreadTick(sponsorDistTickRef, tickKey, () => {
    const now = wallNowMs;

    if (sponsorBesideConfigured && match && sponsorWindow) {
      /** Zelfde regels als display: pauze/reset + sync bij late inschakeling. */
      const football = sponsorWindow.footballEngine;
      const rotationActive = mode === "SPONSOR_ROTATION";
      const scheduleFrozen = !rotationActive || sponsorInterrupted || matchClockFrozen;
      const hangFrozen = sponsorInterrupted || matchClockFrozen;

      const wallElapsedSec = sponsorPlayWallElapsedSec({
        state,
        localEpochMs: playWallEpochRef.current,
        nowMs: now,
      });
      const tLive = football
        ? halfWindowElapsed(elapsed, match.status, match.halfDurationSec)
        : windowScheduleElapsed({
            window: sponsorWindow,
            elapsedSec: elapsed,
            status: match.status,
            halfDurationSec: match.halfDurationSec,
            periodDurationSec: match.periodDurationSec,
            currentPeriod: match.currentPeriod,
            periodCount: getSportProfile(match.sport).periodCount,
            wallElapsedSec,
          });
      if (rotationActive) {
        if (!hangFrozen) tInterruptFrozen.current = tLive;
        if (!matchSponsorRotationWasActiveRef.current) {
          sponsorScheduleClockRef.current.initialized = false;
          sponsorPhaseHangRef.current = null;
        }
      }
      /** Zelfde regel als het scherm: een goal of kaart zet de rotatie niet uit. */
      matchSponsorRotationWasActiveRef.current = sponsorRotationStaysActive(
        matchSponsorRotationWasActiveRef.current,
        rotationActive,
        sponsorInterrupted,
      );
      const tLiveOpen = football
        ? halfWindowElapsedOpenEnded(elapsed, match.status, match.halfDurationSec)
        : tLive;
      const scheduleRawT = rotationActive || sponsorInterrupted ? tLiveOpen : tInterruptFrozen.current;

      const matchH = football
        ? Math.max(60, match.halfDurationSec)
        : windowTimelineSeconds(sponsorWindow, match, sponsors);
      const section = football ? sectionForStatus(match.status) : sponsorWindow.section;
      sponsorScheduleTime(
        sponsorScheduleClockRef,
        football ? `${match.id}:${match.status}:match` : `${match.id}:${sponsorWindow.id}:match`,
        scheduleRawT,
        scheduleFrozen,
        matchH,
      );
      const t = catchUpSponsorSchedule({
        clock: sponsorScheduleClockRef.current,
        rawT: scheduleRawT,
        frozen: scheduleFrozen,
        hang: sponsorPhaseHangRef.current,
        nowMs: now,
        slotMap: sponsorSlotMapMatch,
        maxT: matchH,
      });
      if (sponsorScheduleClockRef.current.hardReset) {
        sponsorPhaseHangRef.current = null;
      }
      if (
        sponsorWallPlayTimelineComplete({
          clock: sponsorWindow.clock,
          section: sponsorWindow.section,
          cycleBudgetForever,
          wallElapsedSec: t,
          timelineSec: matchH,
        })
      ) {
        sponsorPhaseHangRef.current = null;
        return { phase: "scoreboard" as const, sponsorFilterId: null as string | null };
      }
      const v = lookupSponsorAtSecond(sponsorSlotMapMatch, t);
      if (
        periodStartHoldsFullScoreboard({
          matchStatus: match.status,
          halfElapsedSec: tLive,
          timerRunning: matchTimerRunning,
          wallClockPlay,
        })
      ) {
        sponsorPhaseHangRef.current = null;
        return { phase: "scoreboard" as const, sponsorFilterId: null as string | null };
      }
      const base = resolveSponsorSpreadPhase(v, sponsors, section, football ? match.status : sponsorWindow.mediaStatus, now, sponsorPhaseHangRef, {
        slotMap: sponsorSlotMapMatch,
        slotT: t,
        interrupted: hangFrozen,
        restartsClip: sponsorInterrupted,
        scheduleClock: sponsorScheduleClockRef.current,
        liveClipSponsorId: match
          ? (ledgerActiveClipStillLiveForMatchSegment(match, section, sponsorLedger, now)?.sponsorId ?? null)
          : null,
      });
      if (sponsorInterrupted) return base;
      const capped = applySponsorBudgetCapToSpreadPhase(base, {
        cycleBudgetForever,
        sponsors,
        section,
        matchStatus: football ? match.status : sponsorWindow.mediaStatus,
        slotMap: sponsorSlotMapMatch,
        slotT: t,
        sponsorLedger,
        ledgerMatchesSegment: sponsorLedgerMatchesSegment(match, section, sponsorLedger),
        nowMs: now,
        budgetOf: rotationBudgetSeconds,
      });
      if (capped.phase === "scoreboard") sponsorPhaseHangRef.current = null;
      return capped;
    }
    if (liveAutoHalftime && match && rustEpochRef.current != null) {
      const H = Math.max(60, match.halfBreakSec);
      const rawElapsed = (now - rustEpochRef.current) / 1000;
      const { t: loopT } = sectionSpreadClock(rawElapsed, H, true);
      sponsorScheduleTime(
        halftimeScheduleClockRef,
        `${match.id}:${match.status}:halftime`,
        cycleBudgetForever ? loopT : rawElapsed,
        sponsorInterrupted,
        H,
      );
      const t = catchUpSponsorSchedule({
        clock: halftimeScheduleClockRef.current,
        rawT: cycleBudgetForever ? loopT : rawElapsed,
        frozen: sponsorInterrupted,
        hang: sponsorPhaseHangRef.current,
        nowMs: now,
        slotMap: sponsorSlotMapHalftime,
        maxT: H,
      });
      if (sectionPlayheadExhausted(t, H, cycleBudgetForever)) {
        sponsorPhaseHangRef.current = null;
        return { phase: "scoreboard" as const, sponsorFilterId: null as string | null };
      }
      if (halftimeScheduleClockRef.current.hardReset) {
        sponsorPhaseHangRef.current = null;
      }
      const v = lookupSponsorAtSecond(sponsorSlotMapHalftime, t);
      const base = resolveSponsorSpreadPhase(v, sponsors, "halftime", undefined, now, sponsorPhaseHangRef, {
        slotMap: sponsorSlotMapHalftime,
        slotT: t,
        interrupted: sponsorInterrupted,
        restartsClip: sponsorInterrupted,
        scheduleClock: halftimeScheduleClockRef.current,
        liveClipSponsorId: match
          ? (ledgerActiveClipStillLiveForMatchSegment(match, "halftime", sponsorLedger, now)?.sponsorId ?? null)
          : null,
      });
      if (sponsorInterrupted) return base;
      const capped = applySponsorBudgetCapToSpreadPhase(base, {
        cycleBudgetForever,
        sponsors,
        section: "halftime",
        matchStatus: undefined,
        slotMap: sponsorSlotMapHalftime,
        slotT: t,
        sponsorLedger,
        ledgerMatchesSegment: sponsorLedgerMatchesSegment(match, "halftime", sponsorLedger),
        nowMs: now,
        budgetOf: rotationBudgetSeconds,
      });
      if (capped.phase === "scoreboard") sponsorPhaseHangRef.current = null;
      return capped;
    }
    sponsorPhaseHangRef.current = null;
    return { phase: "scoreboard" as const, sponsorFilterId: null as string | null };
    });
  }, [
    sponsorBesideConfigured,
    liveAutoHalftime,
    match,
    sponsors,
    elapsed,
    mode,
    sponsorSlotMapMatch,
    sponsorSlotMapHalftime,
    phaseTick,
    sponsorInterrupted,
    matchTimerRunning,
    matchClockFrozen,
    wallClockPlay,
    wallNowMs,
    sponsorWindow,
    cycleBudgetForever,
    sponsorLedger,
    state?.liveWallCueOrigin,
    state?.liveWallCueBlock,
    state?.liveWallCueFrozenSec,
    state?.matchId,
    rotationBudgetSeconds,
  ]);

  const prematchDistView = useMemo(() => {
    const tickKey = `${phaseTick}|${Number(prematchSpreadActive)}|${Number(sponsorInterrupted)}|${match?.id}`;
    return applySponsorSpreadTick(prematchDistTickRef, tickKey, () => {
    const now = wallNowMs;
    if (!prematchSpreadActive) {
      return { phase: "scoreboard" as const, sponsorFilterId: null as string | null };
    }
    const timing = computePrematchSpreadTiming(
      match,
      sponsors,
      now,
      prematchOriginRef.current,
    );
    const H = timing.timelineLenSec;
    if (timing.beforeWindow || timing.timelineComplete || !timing.rosterRunning) {
      prematchPhaseHangRef.current = null;
      return { phase: "scoreboard" as const, sponsorFilterId: null as string | null };
    }
    const { t: rawT } = prematchSpreadClock(timing.elapsedSec, H);
    sponsorScheduleTime(
      prematchScheduleClockRef,
      "prematch",
      rawT,
      sponsorInterrupted,
      H,
    );
    const t = catchUpSponsorSchedule({
      clock: prematchScheduleClockRef.current,
      rawT: rawT,
      frozen: sponsorInterrupted,
      hang: prematchPhaseHangRef.current,
      nowMs: now,
      slotMap: sponsorSlotMapPrematch,
      maxT: H,
    });
    if (prematchScheduleClockRef.current.hardReset) {
      prematchPhaseHangRef.current = null;
    }
    const v = lookupSponsorAtSecond(sponsorSlotMapPrematch, t);
    const base = resolveSponsorSpreadPhase(v, sponsors, "prematch", undefined, now, prematchPhaseHangRef, {
      slotMap: sponsorSlotMapPrematch,
      slotT: t,
      interrupted: sponsorInterrupted,
      restartsClip: sponsorInterrupted,
      scheduleClock: prematchScheduleClockRef.current,
      liveClipSponsorId: match
        ? (ledgerActiveClipStillLiveForMatchSegment(match, "prematch", sponsorLedger, now)?.sponsorId ?? null)
        : null,
    });
    if (sponsorInterrupted) return base;
    const capped = applySponsorBudgetCapToSpreadPhase(base, {
      cycleBudgetForever,
      sponsors,
      section: "prematch",
      matchStatus: undefined,
      slotMap: sponsorSlotMapPrematch,
      slotT: t,
      sponsorLedger,
      ledgerMatchesSegment: match ? sponsorLedgerMatchesSegment(match, "prematch", sponsorLedger) : false,
      nowMs: now,
      budgetOf: rotationBudgetSeconds,
    });
    if (capped.phase === "scoreboard") prematchPhaseHangRef.current = null;
    return capped;
    });
  }, [prematchSpreadActive, match, sponsorSlotMapPrematch, sponsors, phaseTick, wallNowMs, sponsorInterrupted, cycleBudgetForever, sponsorLedger, rotationBudgetSeconds]);

  const postmatchDistView = useMemo(() => {
    const tickKey = `${phaseTick}|${Number(postmatchSpreadActive)}|${Number(sponsorInterrupted)}|${match?.id}`;
    return applySponsorSpreadTick(postmatchDistTickRef, tickKey, () => {
    const now = wallNowMs;
    if (!postmatchSpreadActive || !match || postmatchEpochRef.current == null) {
      return { phase: "scoreboard" as const, sponsorFilterId: null as string | null };
    }
    const H = postmatchSpreadTimelineSeconds(sponsors);
    const rawElapsed = (now - postmatchEpochRef.current) / 1000;
    const { t: loopT } = sectionSpreadClock(rawElapsed, H, true);
    sponsorScheduleTime(
      postmatchScheduleClockRef,
      `${match.id}:postmatch`,
      cycleBudgetForever ? loopT : rawElapsed,
      sponsorInterrupted,
      H,
    );
    const t = catchUpSponsorSchedule({
      clock: postmatchScheduleClockRef.current,
      rawT: cycleBudgetForever ? loopT : rawElapsed,
      frozen: sponsorInterrupted,
      hang: postmatchPhaseHangRef.current,
      nowMs: now,
      slotMap: sponsorSlotMapPostmatch,
      maxT: H,
    });
    if (sectionPlayheadExhausted(t, H, cycleBudgetForever)) {
      postmatchPhaseHangRef.current = null;
      return { phase: "scoreboard" as const, sponsorFilterId: null as string | null };
    }
    if (postmatchScheduleClockRef.current.hardReset) {
      postmatchPhaseHangRef.current = null;
    }
    const v = lookupSponsorAtSecond(sponsorSlotMapPostmatch, t);
    const base = resolveSponsorSpreadPhase(v, sponsors, "postmatch", undefined, now, postmatchPhaseHangRef, {
      slotMap: sponsorSlotMapPostmatch,
      slotT: t,
      interrupted: sponsorInterrupted,
      restartsClip: sponsorInterrupted,
      scheduleClock: postmatchScheduleClockRef.current,
      liveClipSponsorId: match
        ? (ledgerActiveClipStillLiveForMatchSegment(match, "postmatch", sponsorLedger, now)?.sponsorId ?? null)
        : null,
    });
    if (sponsorInterrupted) return base;
    const capped = applySponsorBudgetCapToSpreadPhase(base, {
      cycleBudgetForever,
      sponsors,
      section: "postmatch",
      matchStatus: undefined,
      slotMap: sponsorSlotMapPostmatch,
      slotT: t,
      sponsorLedger,
      ledgerMatchesSegment: sponsorLedgerMatchesSegment(match, "postmatch", sponsorLedger),
      nowMs: now,
      budgetOf: rotationBudgetSeconds,
    });
    if (capped.phase === "scoreboard") postmatchPhaseHangRef.current = null;
    return capped;
    });
  }, [
    postmatchSpreadActive,
    match,
    sponsors,
    sponsorSlotMapPostmatch,
    phaseTick,
    wallNowMs,
    sponsorInterrupted,
    cycleBudgetForever,
    sponsorLedger,
    rotationBudgetSeconds,
  ]);

  return useMemo(() => {
    const now = wallNowMs;

    if (
      sponsorBesideConfigured &&
      match &&
      sponsorBesideShowsPanel(match, sponsors, playlists, hasWindowSponsors) &&
      !hasSponsorsForSectionOrWindow(
        sponsors,
        sectionForStatus(match.status),
        match.status,
        sponsorWindow,
        match.sport,
      )
    ) {
      return {
        kind: "playlist_only" as const,
        label: tUi("sponsors.playlistMatchHalf"),
      };
    }

    if (
      liveAutoHalftime &&
      match &&
      sponsorHalftimeShowsPanel(match, sponsors, playlists, hasWindowSponsors) &&
      !hasSponsorsForSectionOrWindow(sponsors, "halftime", match.status, sponsorWindow, match.sport)
    ) {
      return {
        kind: "playlist_only" as const,
        label: tUi("sponsors.playlistHalftime"),
      };
    }

    if (activeScheduledCue && match && !captureCovers) {
      const cueMedia = activeScheduledCue.media;
      const cueLabel = mediaLabel(cueMedia.title, cueMedia.path, cueMedia.type);
      const cueSponsor =
        (cueMedia.sponsorId
          ? sponsors.find((s) => s.id === cueMedia.sponsorId)?.name
          : null) ?? cueMedia.sponsorName ?? null;
      const section = sectionForStatus(match.status);
      const segmentKey = sponsorTelemetrySegmentKey(match.id, match.status, section);
      const ledgerClip =
        segmentKey &&
        sponsorLedger &&
        sponsorLedger.matchId === match.id &&
        sponsorLedger.segmentKey === segmentKey
          ? sponsorLedger.activeClip
          : null;
      const confirmed = ledgerClip?.mediaId === cueMedia.id;
      let sponsorClipProgress: number | null = null;
      let clipRemainingSec: number | null = null;
      if (confirmed && ledgerClip) {
        const elapsedSec = sponsorTelemetryActiveClipElapsedSec(ledgerClip, now);
        const totalSec = Math.max(0.1, ledgerClip.expectedPlaySec || cueMedia.durationSec || 0.1);
        sponsorClipProgress = Math.min(1, elapsedSec / totalSec);
        clipRemainingSec = Math.max(0, totalSec - elapsedSec);
      }
      return {
        kind: "roster" as const,
        contextLabel: tMatchStatus(tUi, match.status, match.sport),
        phase: "sponsor" as const,
        sponsorName: cueSponsor,
        mediaTitle: cueLabel.title,
        mediaFileName: cueLabel.fileName,
        mediaKind: cueMedia.type === "IMAGE" || cueMedia.type === "VIDEO" ? cueMedia.type : null,
        hasLiveClip: confirmed,
        sponsorClipProgress,
        nextSlotEtaSec: null,
        clipRemainingSec,
        prematchWindowOpensInSec: null,
        prematchTimelineComplete: false,
        playbackUnconfirmed: !confirmed,
        coveredByCapture: false,
      };
    }

    function rosterFrom(
      contextLabel: string,
      section: SponsorSection,
      matchStatus: string | undefined,
      telemetrySegmentKey: string | null,
      dist: { phase: "scoreboard" | "sponsor"; sponsorFilterId: string | null },
      slotMap: (string | null)[],
      t: number,
      hangRef: MutableRefObject<{
        sponsorId: string;
        untilMs: number;
        startedAtMs: number;
        startedAtSlotIdx?: number;
      } | null>,
      /**
       * Voor prematch/rust: `t` is vaak `elapsed % H` (herhalend rooster). Voor “volgende sponsor”
       * moet de ETA op de echte tijdlijn van **één** blok gebaseerd zijn — anders wrapt `t` en
       * vindt `secondsUntilNextSponsorSlot` opnieuw slots aan het begin van de virtuele cyclus.
       */
      tForNextSlotEta?: number,
    ): SponsorPhaseHudModel {
      void holdSecondsCappedBySlotRun(
        sponsors,
        section,
        matchStatus,
        dist.sponsorFilterId,
        slotMap,
        t,
      );

      /**
       * Budget: als de sponsor zijn quotum (volgens telemetry op scherm, of slot-rooster)
       * volledig gebruikt heeft, toont het display het scorebord-fallback — HUD moet dan
       * niet "Bezig" blijven op basis van een achterhaalde activeClip of alleen het slotmodel.
       */
      let effectivePhase: "scoreboard" | "sponsor" = dist.phase;
      let effectiveSponsorId = dist.sponsorFilterId;
      const ledgerMatchesSegment =
        !!match &&
        !!sponsorLedger &&
        telemetrySegmentKey != null &&
        sponsorLedger.matchId === match.id &&
        sponsorLedger.segmentKey === telemetrySegmentKey;

      if (ledgerMatchesSegment && match) {
        const acLive = ledgerActiveClipStillLiveForMatchSegment(match, section, sponsorLedger!, now);
        if (acLive) {
          /**
           * Actieve clip op het scherm (display → ledger). Bevestigt de sponsor-fase,
           * maar mag een geplande start niet annuleren als de ledger nog leeg is
           * (anders wist de HUD de hang en bleef “volgende sponsor over 1 s” hangen).
           */
          effectivePhase = "sponsor";
          effectiveSponsorId = acLive.sponsorId;
        } else if (sponsorLedger!.activeClip && !acLive) {
          /** Verlopen activeClip: terug naar rooster/hang i.p.v. “Bezig” te blijven. */
          effectivePhase = dist.phase;
          effectiveSponsorId = dist.sponsorFilterId;
        }
      }
      const capped = applySponsorBudgetCapToSpreadPhase(
        { phase: effectivePhase, sponsorFilterId: effectiveSponsorId },
        {
          cycleBudgetForever,
          sponsors,
          section,
          matchStatus,
          slotMap,
          slotT: t,
          sponsorLedger,
          ledgerMatchesSegment,
          nowMs: now,
          budgetOf: rotationBudgetSeconds,
        },
      );
      if (!sponsorInterrupted) {
        effectivePhase = capped.phase;
        effectiveSponsorId = capped.sponsorFilterId;
        if (capped.phase === "scoreboard") hangRef.current = null;
      }

      const name =
        effectivePhase === "sponsor" && effectiveSponsorId == null
          ? "Alle sponsors"
          : effectiveSponsorId != null
            ? (sponsors.find((s) => s.id === effectiveSponsorId)?.name ?? effectiveSponsorId)
            : null;

      const liveClip =
        ledgerMatchesSegment && match
          ? ledgerActiveClipStillLiveForMatchSegment(match, section, sponsorLedger, now)
          : null;
      const playingMediaId =
        liveClip?.mediaId ??
        (mode === "SPONSOR" ? state?.activeMediaId ?? null : null);
      const media =
        resolveSponsorMedia(sponsors, playingMediaId, mediaLibrary) ??
        (playingMediaId
          ? null
          : plannedMediaForSponsor(
              sponsors.find((s) => s.id === effectiveSponsorId) ?? null,
              section,
              matchStatus,
            ));

      let sponsorClipProgress: number | null = null;
      let clipRemainingSec: number | null = null;
      let nextSlotEtaSec: number | null = null;
      /** Bevestigt het stadionscherm de clip die de HUD voorspelt? */
      let playbackConfirmed = false;

      if (ledgerMatchesSegment && match) {
        const acLive = ledgerActiveClipStillLiveForMatchSegment(match, section, sponsorLedger!, now);
        if (effectivePhase === "sponsor" && acLive) {
          const elapsedSec = sponsorTelemetryActiveClipElapsedSec(acLive, now);
          const totalSec = Math.max(0.1, acLive.expectedPlaySec || 0.1);
          sponsorClipProgress = Math.min(1, elapsedSec / totalSec);
          clipRemainingSec = Math.max(0, totalSec - elapsedSec);
          playbackConfirmed = true;
        }
      } else {
        const hang = hangRef.current;
        if (effectivePhase === "sponsor" && hang && now < hang.untilMs) {
          const totalMs = hang.untilMs - hang.startedAtMs;
          const elapsedMs = now - hang.startedAtMs;
          sponsorClipProgress = Math.min(1, Math.max(0, elapsedMs / totalMs));
          clipRemainingSec = Math.max(0, (hang.untilMs - now) / 1000);
        }
      }
      /**
       * Sponsorfase zonder bevestiging uit de ledger: het scherm speelt mogelijk niets.
       * Na een korte start-marge toont de HUD het scorebord (wat er wél staat) in plaats
       * van een misleidende “Café Lawijt · niet bevestigd”.
       */
      const shownPhase = hudRosterPhase({
        predictedPhase: effectivePhase,
        predictedStartedAtMs: hangRef.current?.startedAtMs,
        ledgerConfirmed: playbackConfirmed,
        interrupted: sponsorInterrupted,
        nowMs: now,
      });
      if (shownPhase === "scoreboard" && effectivePhase === "sponsor") {
        effectivePhase = "scoreboard";
        sponsorClipProgress = null;
        clipRemainingSec = null;
      }
      /**
       * Geen oranje "niet bevestigd" in het rooster. Een sponsorfase zonder bevestiging bestaat
       * hier alleen nog binnen de start-marge: dat is de clip die opstart, en daarna toont de
       * HUD het scorebord. De waarschuwing flitste zo bij elke clipstart een fractie in beeld.
       */
      const playbackUnconfirmed = false;
      if (effectivePhase === "scoreboard") {
        if (
          !cycleBudgetForever &&
          allActiveSponsorSectionBudgetsExhausted(
            sponsors,
            section,
            matchStatus,
            slotMap,
            t,
            sponsorLedger,
            ledgerMatchesSegment,
            now,
            rotationBudgetSeconds,
          )
        ) {
          nextSlotEtaSec = null;
        } else {
          const tEta = tForNextSlotEta ?? t;
          const slotEta = secondsUntilNextSponsorSlot(slotMap, tEta);
          /**
           * Slotmap = strategische spreiding over de helft; echte wissels volgen de ledger (clip-einde).
           * Zonder deze blend toont de HUD bv. "199 s" terwijl het scherm al bijna bij de volgende sponsor is,
           * of springt de teller vreemd wanneer clips sneller doorlopen dan de kaart-seconden.
           */
          let nextEta: number | null = slotEta;
          if (ledgerMatchesSegment && match) {
            const ac2 = ledgerActiveClipStillLiveForMatchSegment(match, section, sponsorLedger, now);
            if (ac2) {
              const expectedSec2 = Math.max(0.1, ac2.expectedPlaySec || 0.1);
              const liveElapsed2 = sponsorTelemetryActiveClipElapsedSec(ac2, now);
              const rem2 = expectedSec2 - liveElapsed2;
              if (rem2 > 0.2) {
                nextEta = Math.max(0, rem2);
              }
            }
          }
          nextSlotEtaSec = nextEta;
        }
      }

      return {
        kind: "roster" as const,
        contextLabel,
        phase: effectivePhase,
        sponsorName: name,
        mediaTitle: media?.title ?? null,
        mediaFileName: media?.fileName ?? null,
        mediaKind: media?.kind ?? null,
        hasLiveClip: liveClip != null,
        sponsorClipProgress,
        nextSlotEtaSec,
        clipRemainingSec,
        prematchWindowOpensInSec: null,
        prematchTimelineComplete: false,
        playbackUnconfirmed,
        coveredByCapture: captureCovers,
      };
    }

    if (sponsorBesideConfigured && match && sponsorWindow && hasSponsorsForSectionOrWindow(sponsors, sectionForStatus(match.status), match.status, sponsorWindow, match.sport)) {
      const football = sponsorWindow.footballEngine;
      const tLive = football
        ? halfWindowElapsed(elapsed, match.status, match.halfDurationSec)
        : windowScheduleElapsed({
            window: sponsorWindow,
            elapsedSec: elapsed,
            status: match.status,
            halfDurationSec: match.halfDurationSec,
            periodDurationSec: match.periodDurationSec,
            currentPeriod: match.currentPeriod,
            periodCount: getSportProfile(match.sport).periodCount,
            wallElapsedSec: sponsorPlayWallElapsedSec({
              state,
              localEpochMs: playWallEpochRef.current,
              nowMs: now,
            }),
          });
      /**
       * Zelfde roosterklok als het scherm en als `sponsorDistView`: die staat stil tijdens elke
       * onderbreking. Op de wedstrijdklok telde de HUD af naar een slot dat het scherm pas
       * later bereikt, en stond de teller op 0,0 zonder dat er iets startte.
       */
      const rotationActive = mode === "SPONSOR_ROTATION";
      const tLiveOpen = football
        ? halfWindowElapsedOpenEnded(elapsed, match.status, match.halfDurationSec)
        : tLive;
      const rawT = rotationActive || sponsorInterrupted ? tLiveOpen : tInterruptFrozen.current;
      const t = Math.max(
        0,
        rawT -
          sponsorScheduleLagSec(
            sponsorScheduleClockRef.current,
            rawT,
            !rotationActive || sponsorInterrupted || matchClockFrozen,
          ),
      );
      const section = football ? sectionForStatus(match.status) : sponsorWindow.section;
      return rosterFrom(
        tMatchStatus(tUi, match.status, match.sport),
        section,
        football ? match.status : sponsorWindow.mediaStatus,
        sponsorTelemetrySegmentKey(match.id, match.status, section),
        sponsorDistView,
        sponsorSlotMapMatch,
        t,
        sponsorPhaseHangRef,
      );
    }

    if (
      liveAutoHalftime &&
      match &&
      rustEpochRef.current != null &&
      hasSponsorsForSectionOrWindow(sponsors, "halftime", match.status, sponsorWindow, match.sport)
    ) {
      const H = Math.max(60, match.halfBreakSec);
      const tUnbounded = (now - rustEpochRef.current) / 1000;
      const lag = sponsorScheduleLagSec(
        halftimeScheduleClockRef.current,
        cycleBudgetForever ? tUnbounded % H : tUnbounded,
        sponsorInterrupted,
      );
      const t = Math.max(0, (tUnbounded % H) - lag);
      const tNextEta = Math.max(0, Math.min(tUnbounded, Math.max(0, H - 1e-6)) - lag);
      return rosterFrom(
        tUi("phases.HALF_TIME"),
        "halftime",
        undefined,
        sponsorTelemetrySegmentKey(match.id, match.status, "halftime"),
        sponsorDistView,
        sponsorSlotMapHalftime,
        t,
        sponsorPhaseHangRef,
        tNextEta,
      );
    }

    if (postmatchSpreadActive && match && hasSponsorsForSectionOrWindow(sponsors, "postmatch", match.status, sponsorWindow, match.sport)) {
      const H = postmatchSpreadTimelineSeconds(sponsors);
      const tUnbounded =
        postmatchEpochRef.current != null ? (now - postmatchEpochRef.current) / 1000 : 0;
      const lag = sponsorScheduleLagSec(
        postmatchScheduleClockRef.current,
        cycleBudgetForever ? tUnbounded % Math.max(1, Math.floor(H)) : tUnbounded,
        sponsorInterrupted,
      );
      const t = Math.max(0, Math.min(tUnbounded, Math.max(0, H - 1e-6)) - lag);
      return rosterFrom(
        tUi("phases.POST_MATCH"),
        "postmatch",
        undefined,
        sponsorTelemetrySegmentKey(match.id, match.status, "postmatch"),
        postmatchDistView,
        sponsorSlotMapPostmatch,
        t,
        postmatchPhaseHangRef,
        t,
      );
    }

    if (
      prematchSpreadActive &&
      hasSponsorsForSectionOrWindow(sponsors, "prematch", match?.status, sponsorWindow, match?.sport)
    ) {
      const timing = computePrematchSpreadTiming(
        match,
        sponsors,
        now,
        prematchOriginRef.current,
      );
      const H = timing.timelineLenSec;
      if (timing.beforeWindow && timing.usesKickoffAnchor && match?.kickoffAt) {
        const koMs = new Date(match.kickoffAt).getTime();
        const opensInSec = Math.max(0, (koMs - H * 1000 - now) / 1000);
        return {
          kind: "roster" as const,
          contextLabel: tUi("phases.PREMATCH"),
          phase: "scoreboard",
          sponsorName: null,
          mediaTitle: null,
          mediaFileName: null,
          hasLiveClip: false,
          sponsorClipProgress: null,
          nextSlotEtaSec: null,
          clipRemainingSec: null,
          prematchWindowOpensInSec: opensInSec,
          prematchTimelineComplete: false,
        };
      }
      if (timing.timelineComplete || !timing.rosterRunning) {
        return {
          kind: "roster" as const,
          contextLabel: tUi("phases.PREMATCH"),
          phase: "scoreboard",
          sponsorName: null,
          mediaTitle: null,
          mediaFileName: null,
          hasLiveClip: false,
          sponsorClipProgress: null,
          nextSlotEtaSec: null,
          clipRemainingSec: null,
          prematchWindowOpensInSec: null,
          prematchTimelineComplete: true,
        };
      }
      const lag = sponsorScheduleLagSec(
        prematchScheduleClockRef.current,
        prematchSpreadClock(timing.elapsedSec, H).t,
        sponsorInterrupted,
      );
      const t = Math.max(0, timing.elapsedSec - lag);
      const tNextEta = Math.min(t, Math.max(0, H - 1e-6));
      return {
        ...rosterFrom(
          tUi("phases.PREMATCH"),
          "prematch",
          undefined,
          match ? sponsorTelemetrySegmentKey(match.id, match.status, "prematch") : null,
          prematchDistView,
          sponsorSlotMapPrematch,
          t,
          prematchPhaseHangRef,
          tNextEta,
        ),
        prematchWindowOpensInSec: null,
        prematchTimelineComplete: false,
      };
    }

    return { kind: "inactive" as const };
  }, [
    sponsorBesideConfigured,
    liveAutoHalftime,
    prematchSpreadActive,
    postmatchSpreadActive,
    postmatchDistView,
    sponsorSlotMapPostmatch,
    match,
    sponsors,
    playlists,
    elapsed,
    mode,
    sponsorDistView,
    prematchDistView,
    sponsorSlotMapMatch,
    sponsorSlotMapHalftime,
    sponsorSlotMapPrematch,
    sponsorLedger,
    cycleBudgetForever,
    phaseTick,
    wallNowMs,
    tUi,
    captureCovers,
    sponsorInterrupted,
    activeScheduledCue,
    mediaLibrary,
    state?.activeMediaId,
    rotationBudgetSeconds,
    sponsorWindow,
    hasWindowSponsors,
  ]);
}

function mediaKindOf(type: string | undefined): "IMAGE" | "VIDEO" | null {
  return type === "IMAGE" || type === "VIDEO" ? type : null;
}

function mediaLabel(
  title: string,
  path: string,
  type?: string,
): { title: string; fileName: string; kind: "IMAGE" | "VIDEO" | null } {
  const fileName = path.split(/[/\\]/).pop() || title;
  return { title: title || fileName, fileName, kind: mediaKindOf(type) };
}

function resolveSponsorMedia(
  sponsors: Sponsor[],
  mediaId: string | null,
  library: MediaItem[] = [],
): { title: string; fileName: string; kind: "IMAGE" | "VIDEO" | null } | null {
  if (!mediaId) return null;
  for (const sponsor of sponsors) {
    const item = sponsor.media?.find((m) => m.id === mediaId);
    if (!item) continue;
    return mediaLabel(item.title, item.path, item.type);
  }
  const item = library.find((m) => m.id === mediaId);
  if (item) return mediaLabel(item.title, item.path, item.type);
  return null;
}

function plannedMediaForSponsor(
  sponsor: Sponsor | null,
  section: SponsorSection,
  matchStatus?: string,
): { title: string; fileName: string; kind: "IMAGE" | "VIDEO" | null } | null {
  if (!sponsor) return null;
  const active = (sponsor.media ?? []).filter((m) => m.active);
  const list = buildSponsorRotationMediaList(
    filterMediaForSponsorSpreadSection(active, section, matchStatus),
    sponsor.sponsorPlaybackOrderJson,
    sponsor.sponsorPlaybackRepeatsJson,
  );
  const item = list[0];
  if (!item) return null;
  return mediaLabel(item.title, item.path, item.type);
}
