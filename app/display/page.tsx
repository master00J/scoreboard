"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  PreviewSlideProgressBar,
  useTimedSlideProgress,
} from "./_components/preview-slide-progress";
import { DISPLAY_COVER_MEDIA_STYLE } from "@/lib/display-cover-media-style";
import { releaseHtmlVideoElement } from "@/lib/html-video-release";
import { AnimatePresence, motion } from "framer-motion";
import { ScaleContainer } from "@/components/scale-container";
import { useSocketSync, sendCommand } from "@/lib/use-socket";
import type { DisplayModeT } from "@/lib/validation/commands";
import { useDisplayStore } from "@/lib/store";
import { useLiveShotClockSeconds, useLiveTimerSeconds } from "@/lib/use-timer";
import { sportClockSeconds, sportPeriodLabel } from "@/lib/sports";
import type {
  AppSettings,
  Match,
  MediaItem,
  Player,
  Playlist,
  PlaylistSlot,
  ScheduledMediaCue,
  Sponsor,
  SponsorSection,
} from "@/lib/types";
import {
  mergeScoreboardTheme,
  sponsorRepeatBudgetCyclesFromThemeJson,
  type ResolvedScoreboardTheme,
} from "@/lib/scoreboard-theme";
import { mediaUrl } from "@/lib/media-url";
import { reportDisplayPlaybackToMain } from "@/lib/report-display-playback";
import {
  reportDisplayMediaDiagnostic,
  videoElementDiagnosticFields,
} from "@/lib/report-display-media-diagnostic";
import {
  isPrematchMatchSponsorWindow,
  PREMATCH_MATCH_SPONSOR_LEAD_MS,
} from "@/lib/prematch-match-sponsor";
import {
  activeSponsorsForSection,
  buildSponsorSlotMap,
  halfWindowElapsed,
  sectionSpreadClock,
  lookupSponsorAtSecond,
  postmatchSpreadTimelineSeconds,
  prematchSpreadTimelineSeconds,
  prematchSpreadClock,
  resolveSponsorSpreadPhase,
} from "@/lib/sponsor-distribution";
import { computePrematchSpreadTiming } from "@/lib/prematch-spread-timing";
import {
  createSponsorScheduleClock,
  sponsorScheduleTime,
  type SponsorScheduleClock,
} from "@/lib/sponsor-schedule-clock";
import { useScheduledMediaCueActive } from "@/lib/use-scheduled-media-cue-active";
import {
  hasSponsorsForSection,
  pickSponsorPlaylist,
  sectionForStatus,
  shouldShowFullScreenMatchBoard,
  sponsorBesideShowsPanel,
  sponsorHalftimeShowsPanel,
  sponsorRotationBesideScoreboard,
} from "@/lib/sponsor-display-helpers";
import {
  ledgerActiveClipStillLiveForMatchSegment,
  type SponsorLedgerPayload,
} from "@/lib/sponsor-telemetry";
import { LeftScoreboardLayout } from "./_modes/left-scoreboard-layout";
import { MatchScoreboardFull } from "./_modes/match-scoreboard-full";
import { GoalMode } from "./_modes/goal";
import { SubstitutionMode } from "./_modes/substitution";
import { CardMode } from "./_modes/card";
import { TeamIntroMode } from "./_modes/team-intro";
import { PlayerIntroMode } from "./_modes/player-intro";
import { SponsorRotation, type IdleEmptyFallback } from "./_modes/sponsor-rotation";
import { SponsorBudgetRotation } from "./_modes/sponsor-budget-rotation";
import { HalfTimeMode, FullTimeMode } from "./_modes/halftime-fulltime";
import { DisplayWatchdog } from "./_components/watchdog";
import { ExternalCaptureVideo } from "@/components/external-capture-video";

/** Modes die naast het scorebord in het content-vlak staan (niet fullscreen over het canvas). */
const LEFT_PANEL_INTERRUPT_MODES = new Set(["GOAL", "CARD"]);

/** Ledger wint van slot-rooster zolang er een lopende clip in dit segment is (cf. prematch-inline). */
function ledgerAwareSponsorDistOverride(
  match: Match,
  section: SponsorSection,
  sponsorLedger: SponsorLedgerPayload | null,
  base: { phase: "scoreboard" | "sponsor"; sponsorFilterId: string | null },
): { phase: "scoreboard" | "sponsor"; sponsorFilterId: string | null } {
  if (!sponsorLedger) return base;
  const ac = ledgerActiveClipStillLiveForMatchSegment(match, section, sponsorLedger, Date.now());
  if (!ac) return base;
  return { phase: "sponsor", sponsorFilterId: ac.sponsorId };
}

const EXTERNAL_CAPTURE_AUDIO_PREF_KEY = "arenacue_external_capture_audio_v1";

function readExternalCaptureAudioPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(EXTERNAL_CAPTURE_AUDIO_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function isPreviewIframe(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("preview") === "1";
  } catch {
    return false;
  }
}

export default function DisplayPage({ embedInControl = false }: { embedInControl?: boolean }) {
  const previewIframe = isPreviewIframe();
  const skipSocket = previewIframe || embedInControl;
  useSocketSync(skipSocket);
  useEffect(() => {
    if (previewIframe || embedInControl) return;
    document.body.classList.add("display-page");
    return () => document.body.classList.remove("display-page");
  }, [previewIframe, embedInControl]);

  const state = useDisplayStore((s) => s.state);
  const connected = useDisplayStore((s) => s.connected);
  const sponsorLedger = useDisplayStore((s) => s.sponsorLedger);
  const elapsed = useLiveTimerSeconds();
  const shotClock = useLiveShotClockSeconds();

  const [match, setMatch] = useState<Match | null>(null);
  const [playlists, setPlaylists] = useState<Record<PlaylistSlot, Playlist | null>>({
    IDLE: null,
    PREMATCH: null,
    HALFTIME: null,
    POSTMATCH: null,
    GOAL: null,
  });
  const [allPlayers, setAllPlayers] = useState<Record<string, Player>>({});
  const [activeMedia, setActiveMedia] = useState<MediaItem | null>(null);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [scoreboardTheme, setScoreboardTheme] = useState<ResolvedScoreboardTheme>(() =>
    mergeScoreboardTheme(null),
  );
  const [sponsorRepeatBudgetCycles, setSponsorRepeatBudgetCycles] = useState(false);
  const [displayCanvas, setDisplayCanvas] = useState<{
    width: number;
    height: number;
    mode: "cover" | "contain" | "exact";
    safeZoneVisible: boolean;
    safeZoneMarginPx: number;
  }>({
    width: 1920,
    height: 1080,
    mode: "cover",
    safeZoneVisible: false,
    safeZoneMarginPx: 40,
  });
  const [idleEmptyFallback, setIdleEmptyFallback] = useState<IdleEmptyFallback>({
    logoUrl: null,
    media: null,
  });

  useEffect(() => {
    if (previewIframe) return;
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s: AppSettings) => {
        if (cancelled) return;
        setScoreboardTheme(mergeScoreboardTheme(s.scoreboardThemeJson ?? null));
        setSponsorRepeatBudgetCycles(
          sponsorRepeatBudgetCyclesFromThemeJson(s.scoreboardThemeJson ?? null),
        );
        const w = Math.max(320, Number(s.displayCanvasWidth ?? 1920));
        const h = Math.max(240, Number(s.displayCanvasHeight ?? 1080));
        const rawMode = (s.displayScalingMode ?? "cover") as
          | "cover"
          | "contain"
          | "exact";
        const mode: "cover" | "contain" | "exact" =
          rawMode === "contain" || rawMode === "exact" ? rawMode : "cover";
        setDisplayCanvas({
          width: w,
          height: h,
          mode,
          safeZoneVisible: !!s.displaySafeZoneVisible,
          safeZoneMarginPx: Math.max(0, Number(s.displaySafeZoneMarginPx ?? 40)),
        });
        const logoUrl = s.homeTeamBranding?.logoPath
          ? mediaUrl(s.homeTeamBranding.logoPath)
          : null;
        const im = s.idleFallbackMedia;
        setIdleEmptyFallback({
          logoUrl,
          media:
            im && im.active
              ? {
                  path: im.path,
                  type: im.type,
                  title: im.title,
                  durationSec: im.durationSec,
                  playAudio: im.playAudio,
                }
              : null,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [previewIframe, state?.updatedAt]);

  useEffect(() => {
    if (previewIframe) return;
    fetch("/api/sponsors")
      .then((r) => r.json())
      .then((list: Sponsor[]) => setSponsors(list ?? []))
      .catch(() => setSponsors([]));
  }, [state?.updatedAt, previewIframe]);

  useEffect(() => {
    if (previewIframe) return;
    if (!state?.matchId) {
      setMatch(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/matches/${state.matchId}`)
      .then((r) => r.json())
      .then((m) => {
        if (cancelled) return;
        setMatch(m);
        const p: Record<string, Player> = {};
        for (const pl of m.homeTeam.players ?? []) p[pl.id] = pl;
        for (const pl of m.awayTeam.players ?? []) p[pl.id] = pl;
        setAllPlayers(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [state?.matchId, state?.updatedAt, previewIframe]);

  useEffect(() => {
    if (previewIframe) return;
    if (!state?.activeMediaId) {
      setActiveMedia(null);
      return;
    }
    fetch(`/api/media`)
      .then((r) => r.json())
      .then((list: MediaItem[]) => {
        const found = list.find((m) => m.id === state.activeMediaId);
        setActiveMedia(found ?? null);
      })
      .catch(() => setActiveMedia(null));
  }, [state?.activeMediaId, previewIframe]);

  useEffect(() => {
    if (previewIframe) return;
    fetch("/api/playlists")
      .then((r) => r.json())
      .then((list: Playlist[]) => {
        const map: Record<PlaylistSlot, Playlist | null> = {
          IDLE: null,
          PREMATCH: null,
          HALFTIME: null,
          POSTMATCH: null,
          GOAL: null,
        };
        for (const p of list) {
          map[p.slot as PlaylistSlot] = p;
        }
        setPlaylists(map);
      })
      .catch(() => {});
  }, [state?.updatedAt, previewIframe]);

  const mode = state?.mode ?? "IDLE";

  /** Elke ~2 min: regel in boot.log zolang het display-renderer-JS nog loopt (bij GPU-vastloper stopt dit ook). */
  useEffect(() => {
    if (previewIframe || embedInControl) return;
    if (typeof window === "undefined" || !window.electronAPI?.reportDisplayPlaybackContext) return;
    const tick = () => {
      reportDisplayPlaybackToMain({
        source: "other",
        mode,
        matchId: match?.id ?? null,
        heartbeat: true,
        atMs: Date.now(),
      });
    };
    const id = window.setInterval(tick, 120_000);
    return () => clearInterval(id);
  }, [previewIframe, embedInControl, mode, match?.id]);

  const { activeScheduledCue, dismissActiveScheduledCue } = useScheduledMediaCueActive({
    match,
    state,
    mode,
    elapsed,
    skip: previewIframe,
  });

  /** Alleen het echte display-venster meldt afgespeelde sponsorclips (niet de ingebouwde preview). */
  const sponsorPlaybackTelemetry = useMemo(
    () =>
      !embedInControl && match ? { matchId: match.id, matchStatus: match.status } : null,
    [embedInControl, match?.id, match?.status],
  );
  const previewFollowClip = useMemo(() => {
    if (!embedInControl || !match || !sponsorLedger) return null;
    const section = sectionForStatus(match.status);
    return ledgerActiveClipStillLiveForMatchSegment(match, section, sponsorLedger);
  }, [embedInControl, elapsed, match, sponsorLedger]);

  const [prematchClock, setPrematchClock] = useState(0);
  useEffect(() => {
    if (!match?.kickoffAt || !match.matchSponsorMediaId) return;
    if (match.status !== "SETUP" && match.status !== "PREMATCH") return;
    const id = setInterval(() => setPrematchClock((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [match?.id, match?.kickoffAt, match?.matchSponsorMediaId, match?.status]);

  const prematchMatchSponsorShow = useMemo(() => {
    void prematchClock;
    return (
      !!match?.matchSponsorMedia &&
      isPrematchMatchSponsorWindow(match, Date.now())
    );
  }, [match, prematchClock]);

  useEffect(() => {
    if (!state) return;
    /** GOAL_PLAYER_VIDEO: gebruik de echte clipduur (+klein eindbufferke) i.p.v. lange default. */
    let playerVideoMs = 5000;
    if (state.mode === "GOAL_PLAYER_VIDEO" && activeMedia?.durationSec) {
      playerVideoMs = Math.max(2500, activeMedia.durationSec * 1000 + 150);
    }
    const transitions: Record<string, { ms: number; next: string }> = {
      GOAL: { ms: 8000, next: "SPONSOR_ROTATION" },
      GOAL_PLAYER_VIDEO: { ms: playerVideoMs, next: "SPONSOR_ROTATION" },
      SUBSTITUTION: { ms: 6000, next: "SPONSOR_ROTATION" },
      CARD: { ms: 5000, next: "SPONSOR_ROTATION" },
      HALFTIME: { ms: 10000, next: "SPONSOR_ROTATION" },
      FULLTIME: { ms: 15000, next: "SPONSOR_ROTATION" },
    };
    const t = transitions[state.mode];
    if (!t) return;
    const id = setTimeout(() => {
      if (state.mode === "SUBSTITUTION") {
        void sendCommand({ type: "sub:queueAdvance" });
      } else {
        sendCommand({ type: "display:setMode", mode: t.next as DisplayModeT });
      }
    }, t.ms);
    return () => clearTimeout(id);
  }, [
    state?.mode,
    state?.updatedAt,
    state?.activeSubInId,
    state?.activeSubOutId,
    activeMedia?.durationSec,
  ]);

  const scorer = state?.activeGoalScorerId
    ? allPlayers[state.activeGoalScorerId] ?? null
    : null;
  const subIn = state?.activeSubInId
    ? allPlayers[state.activeSubInId] ?? null
    : null;
  const subOut = state?.activeSubOutId
    ? allPlayers[state.activeSubOutId] ?? null
    : null;
  const activePlayer = state?.activePlayerId
    ? allPlayers[state.activePlayerId] ?? null
    : null;

  const goalSide: "home" | "away" = useMemo(() => {
    if (!scorer || !match) return "home";
    return scorer.teamId === match.homeTeamId ? "home" : "away";
  }, [scorer, match]);

  const subTeam = useMemo(() => {
    if (!match) return null;
    const playerForTeam = subIn ?? subOut;
    if (!playerForTeam) return null;
    return playerForTeam.teamId === match.homeTeamId
      ? match.homeTeam
      : match.awayTeam;
  }, [subIn, subOut, match]);

  const cardPlayer = activePlayer;
  const period = humanPeriod(match);
  const scoreboardClock = sportClockSeconds(
    match?.sport,
    elapsed,
    match?.periodDurationSec,
  );
  const currentMinute = Math.floor(elapsed / 60);
  const addedTimeMinutes = Math.max(0, state?.addedTimeMinutes ?? 0);

  const sponsorBudgetFallbackScoreboard = useMemo(() => {
    if (!state) return null;
    if (match) {
      return (
        <MatchScoreboardFull
          match={match}
          elapsed={scoreboardClock}
          shotClock={shotClock}
          running={state.timerRunning ?? false}
          period={period}
          addedTime={addedTimeMinutes}
          theme={scoreboardTheme}
        />
      );
    }
    return (
      <SponsorRotation
        playlist={playlists.PREMATCH ?? playlists.IDLE}
        showPreviewProgress={embedInControl}
        idleEmptyFallback={idleEmptyFallback}
      />
    );
  }, [state, match, scoreboardClock, shotClock, period, addedTimeMinutes, scoreboardTheme, playlists, embedInControl, idleEmptyFallback]);

  const halftimeSponsorFallback = useMemo(() => {
    if (!match) return null;
    return <HalfTimeMode match={match} />;
  }, [match]);

  const sponsorBesideConfigured = useMemo(
    () =>
      !!match &&
      !!state &&
      sponsorRotationBesideScoreboard(match.status) &&
      sponsorBesideShowsPanel(match, sponsors, playlists),
    [match, state, mode, sponsors, playlists],
  );

  const liveAutoBeside = sponsorBesideConfigured && mode === "SPONSOR_ROTATION";

  /** Goal-intro / speler-video naast scorebord: sponsor blijft gemount (gepauzeerd) i.p.v. unmount → herstart. */
  const goalVideoBesideLayout =
    !!match &&
    sponsorBesideConfigured &&
    sponsorRotationBesideScoreboard(match.status) &&
    (mode === "GOAL_INTRO_VIDEO" || (mode === "GOAL_PLAYER_VIDEO" && !!activeMedia));

  const liveAutoHalftime = useMemo(
    () =>
      !!match &&
      !!state &&
      mode === "SPONSOR_ROTATION" &&
      match.status === "HALF_TIME" &&
      sponsorHalftimeShowsPanel(match, sponsors, playlists),
    [match, state, mode, sponsors, playlists],
  );

  /** Pre-match fullscreen/IDLE: zelfde slot-rooster als helft/rust i.p.v. alle clips achter elkaar. */
  const prematchSpreadActive = useMemo(() => {
    if (!state) return false;
    if (activeSponsorsForSection(sponsors, "prematch").length === 0) return false;
    return !!(
      mode === "SPONSOR_ROTATION" &&
      match &&
      !sponsorRotationBesideScoreboard(match.status) &&
      !liveAutoHalftime &&
      sectionForStatus(match.status) === "prematch"
    );
  }, [state, mode, match, sponsors, liveAutoHalftime]);

  /**
   * Automatische matchsponsor-fullscreen mag niet boven prematch-rooster liggen:
   * anders speelt de clip zonder telemetry (budget/HUD) terwijl rotatie eronder telt.
   */
  const prematchMatchSponsorOverlay = useMemo(() => {
    if (!prematchMatchSponsorShow) return false;
    if (prematchSpreadActive && hasSponsorsForSection(sponsors, "prematch")) {
      return false;
    }
    return true;
  }, [prematchMatchSponsorShow, prematchSpreadActive, sponsors]);

  const matchSponsorPinProps = useMemo(
    () => ({
      matchSponsorMediaId: match?.matchSponsorMediaId ?? null,
      matchSponsorMedia: match?.matchSponsorMedia ?? null,
    }),
    [match?.matchSponsorMediaId, match?.matchSponsorMedia],
  );

  const rustEpochRef = useRef<number | null>(null);
  useEffect(() => {
    if (match?.status === "HALF_TIME" && liveAutoHalftime) {
      if (rustEpochRef.current == null) rustEpochRef.current = Date.now();
    } else {
      rustEpochRef.current = null;
    }
  }, [match?.status, liveAutoHalftime]);

  /**
   * Na de wedstrijd is er geen vast ankerpunt zoals de aftrap, dus de tijdlijn start
   * op het moment dat de wedstrijd op FULL_TIME / POST_MATCH gaat.
   */
  const postmatchSpreadActive = useMemo(() => {
    if (!state || !match) return false;
    if (mode !== "SPONSOR_ROTATION") return false;
    if (sectionForStatus(match.status) !== "postmatch") return false;
    return activeSponsorsForSection(sponsors, "postmatch").length > 0;
  }, [state, match, mode, sponsors]);

  const postmatchEpochRef = useRef<number | null>(null);
  useEffect(() => {
    if (postmatchSpreadActive) {
      if (postmatchEpochRef.current == null) postmatchEpochRef.current = Date.now();
    } else {
      postmatchEpochRef.current = null;
      postmatchPhaseHangRef.current = null;
    }
  }, [postmatchSpreadActive]);

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
    if (!match) return [] as (string | null)[];
    const active = activeSponsorsForSection(sponsors, "match", match.status);
    const H = Math.max(60, match.halfDurationSec);
    return buildSponsorSlotMap(active, "match", H, match.status);
  }, [match?.id, match?.status, match?.halfDurationSec, sponsors]);

  const sponsorSlotMapHalftime = useMemo(() => {
    if (!match) return [] as (string | null)[];
    const active = activeSponsorsForSection(sponsors, "halftime");
    const H = Math.max(60, match.halfBreakSec);
    return buildSponsorSlotMap(active, "halftime", H);
  }, [match?.id, match?.halfBreakSec, sponsors]);

  const sponsorSlotMapPrematch = useMemo(() => {
    const active = activeSponsorsForSection(sponsors, "prematch");
    const H = prematchSpreadTimelineSeconds(match ?? undefined, sponsors);
    return buildSponsorSlotMap(active, "prematch", H);
  }, [sponsors, match?.id, match?.prematchSpreadWindowSec]);

  const sponsorSlotMapPostmatch = useMemo(() => {
    const active = activeSponsorsForSection(sponsors, "postmatch");
    return buildSponsorSlotMap(active, "postmatch", postmatchSpreadTimelineSeconds(sponsors));
  }, [sponsors, match?.id]);

  /** Tijd in de helft bevriest tijdens doelpunt/wissel/kaart (geen sponsor-tijd “verloren” door die modus). */
  const tInterruptFrozen = useRef(0);

  /** Slotmap = 1 sponsor-index per wedstrijdseconde; slides duren langer → fase vasthouden. */
  const sponsorPhaseHangRef = useRef<{
    sponsorId: string;
    untilMs: number;
    startedAtMs: number;
    startedAtSlotIdx?: number;
    lastSeenAtMs?: number;
  } | null>(null);
  const sponsorScheduleClockRef = useRef<SponsorScheduleClock>(createSponsorScheduleClock());
  const halftimeScheduleClockRef = useRef<SponsorScheduleClock>(createSponsorScheduleClock());
  const postmatchScheduleClockRef = useRef<SponsorScheduleClock>(createSponsorScheduleClock());
  const prematchScheduleClockRef = useRef<SponsorScheduleClock>(createSponsorScheduleClock());
  const postmatchPhaseHangRef = useRef<{
    sponsorId: string;
    untilMs: number;
    startedAtMs: number;
    startedAtSlotIdx?: number;
    lastSeenAtMs?: number;
  } | null>(null);
  const prematchPhaseHangRef = useRef<{
    sponsorId: string;
    untilMs: number;
    startedAtMs: number;
    startedAtSlotIdx?: number;
    lastSeenAtMs?: number;
  } | null>(null);
  const prematchOriginRef = useRef<number | null>(null);
  /** Was “scorebord + sponsors” vorige tick actief? (sync bij late inschakeling) */
  const matchSponsorRotationWasActiveRef = useRef(false);

  useEffect(() => {
    sponsorPhaseHangRef.current = null;
    prematchPhaseHangRef.current = null;
    prematchOriginRef.current = null;
    sponsorScheduleClockRef.current.initialized = false;
    halftimeScheduleClockRef.current.initialized = false;
    prematchScheduleClockRef.current.initialized = false;
    matchSponsorRotationWasActiveRef.current = false;
  }, [match?.id]);

  /** Nieuwe fase (bijv. helft → rust): hang uit vorig segment mag niet doorlopen. */
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

  /** Tijdens deze modi loopt een overlay (goal/speler/kaart/wissel/halftime/fulltime).
   * Sponsor-hang vriest dan in zodat de clip later volledig kan afspelen. */
  const sponsorInterrupted =
    activeScheduledCue != null ||
    mode === "GOAL" ||
    mode === "GOAL_INTRO_VIDEO" ||
    mode === "GOAL_PLAYER_VIDEO" ||
    mode === "SUBSTITUTION" ||
    mode === "CARD" ||
    mode === "HALFTIME" ||
    mode === "FULLTIME";

  const matchTimerRunning = state?.timerRunning ?? false;

  const sponsorDistView = useMemo(() => {
    const now = Date.now();

    if (sponsorBesideConfigured && match) {
      /**
       * Tijdens een speelhelft volgt het sponsorrooster de wedstrijdklok:
       * pauze ⇒ geen voortgang / hang / video; Set time / preset ⇒ hard reset + hang wissen.
       */
      const matchClockFrozen = !matchTimerRunning;
      const rotationActive = mode === "SPONSOR_ROTATION";
      const scheduleFrozen = !rotationActive || sponsorInterrupted || matchClockFrozen;
      const hangFrozen = sponsorInterrupted || matchClockFrozen;

      const tLive = halfWindowElapsed(elapsed, match.status, match.halfDurationSec);
      if (rotationActive) {
        tInterruptFrozen.current = tLive;
        /**
         * Bij switch van “alleen scorebord” → “scorebord + sponsors” moet het rooster
         * naar de actuele wedstrijdtijd springen (niet blijven hangen op bevroren t≈0).
         */
        if (!matchSponsorRotationWasActiveRef.current) {
          sponsorScheduleClockRef.current.initialized = false;
          sponsorPhaseHangRef.current = null;
        }
      }
      matchSponsorRotationWasActiveRef.current = rotationActive;

      const t = sponsorScheduleTime(
        sponsorScheduleClockRef,
        `${match.id}:${match.status}:match`,
        rotationActive ? tLive : tInterruptFrozen.current,
        scheduleFrozen,
        Math.max(60, match.halfDurationSec),
      );
      if (sponsorScheduleClockRef.current.hardReset) {
        sponsorPhaseHangRef.current = null;
      }
      const v = lookupSponsorAtSecond(sponsorSlotMapMatch, t);
      const section = sectionForStatus(match.status);
      const base = resolveSponsorSpreadPhase(v, sponsors, section, match.status, now, sponsorPhaseHangRef, {
        slotMap: sponsorSlotMapMatch,
        slotT: t,
        interrupted: hangFrozen,
      });
      return ledgerAwareSponsorDistOverride(match, section, sponsorLedger, base);
    }
    if (liveAutoHalftime && match && rustEpochRef.current != null) {
      const H = Math.max(60, match.halfBreakSec);
      const { t: rawT, timelineComplete } = sectionSpreadClock(
        (Date.now() - rustEpochRef.current) / 1000,
        H,
        sponsorRepeatBudgetCycles,
      );
      /** Rusttijd om: rooster klaar → scorebord, niet opnieuw beginnen. */
      if (timelineComplete) {
        sponsorPhaseHangRef.current = null;
        return { phase: "scoreboard" as const, sponsorFilterId: null as string | null };
      }
      const t = sponsorScheduleTime(
        halftimeScheduleClockRef,
        `${match.id}:${match.status}:halftime`,
        rawT,
        sponsorInterrupted,
        H,
      );
      if (halftimeScheduleClockRef.current.hardReset) {
        sponsorPhaseHangRef.current = null;
      }
      const v = lookupSponsorAtSecond(sponsorSlotMapHalftime, t);
      const base = resolveSponsorSpreadPhase(v, sponsors, "halftime", undefined, now, sponsorPhaseHangRef, {
        slotMap: sponsorSlotMapHalftime,
        slotT: t,
        interrupted: sponsorInterrupted,
      });
      return ledgerAwareSponsorDistOverride(match, "halftime", sponsorLedger, base);
    }
    sponsorPhaseHangRef.current = null;
    return { phase: "scoreboard" as const, sponsorFilterId: null as string | null };
  }, [
    sponsorBesideConfigured,
    liveAutoHalftime,
    match,
    sponsors,
    elapsed,
    scoreboardClock,
    shotClock,
    mode,
    sponsorInterrupted,
    matchTimerRunning,
    sponsorSlotMapMatch,
    sponsorSlotMapHalftime,
    phaseTick,
    embedInControl,
    sponsorLedger,
    sponsorRepeatBudgetCycles,
  ]);

  const prematchDistView = useMemo(() => {
    const now = Date.now();
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
    const t = sponsorScheduleTime(
      prematchScheduleClockRef,
      "prematch",
      rawT,
      sponsorInterrupted,
      H,
    );
    if (prematchScheduleClockRef.current.hardReset) {
      prematchPhaseHangRef.current = null;
    }
    const v = lookupSponsorAtSecond(sponsorSlotMapPrematch, t);
    const base = resolveSponsorSpreadPhase(v, sponsors, "prematch", undefined, now, prematchPhaseHangRef, {
      slotMap: sponsorSlotMapPrematch,
      slotT: t,
      interrupted: sponsorInterrupted,
    });
    /**
     * Zelfde ledger-regel als helft/rust: de telemetry mag een lopende clip **bevestigen**,
     * maar nooit een start annuleren. Deed dit eerder wél (else → scorebord + hang wissen),
     * dan bleef het rooster hangen: de clip mocht pas starten als de ledger al een actieve
     * clip had, en de ledger kreeg er pas een als de clip startte. Na de eerste clip
     * betekende dat: nooit meer een sponsor, terwijl de HUD wel bleef aftellen.
     */
    if (!match || !timing.rosterRunning) return base;
    return ledgerAwareSponsorDistOverride(match, "prematch", sponsorLedger, base);
  }, [
    prematchSpreadActive,
    sponsorSlotMapPrematch,
    sponsors,
    phaseTick,
    embedInControl,
    match,
    sponsorLedger,
    sponsorInterrupted,
  ]);

  const postmatchDistView = useMemo(() => {
    const now = Date.now();
    if (!postmatchSpreadActive || !match || postmatchEpochRef.current == null) {
      return { phase: "scoreboard" as const, sponsorFilterId: null as string | null };
    }
    const H = postmatchSpreadTimelineSeconds(sponsors);
    const { t: rawT, timelineComplete } = sectionSpreadClock(
      (now - postmatchEpochRef.current) / 1000,
      H,
      sponsorRepeatBudgetCycles,
    );
    /** Geboekte na-wedstrijdtijd op: rooster klaar → scorebord. */
    if (timelineComplete) {
      postmatchPhaseHangRef.current = null;
      return { phase: "scoreboard" as const, sponsorFilterId: null as string | null };
    }
    const t = sponsorScheduleTime(
      postmatchScheduleClockRef,
      `${match.id}:postmatch`,
      rawT,
      sponsorInterrupted,
      H,
    );
    if (postmatchScheduleClockRef.current.hardReset) {
      postmatchPhaseHangRef.current = null;
    }
    const v = lookupSponsorAtSecond(sponsorSlotMapPostmatch, t);
    const base = resolveSponsorSpreadPhase(v, sponsors, "postmatch", undefined, now, postmatchPhaseHangRef, {
      slotMap: sponsorSlotMapPostmatch,
      slotT: t,
      interrupted: sponsorInterrupted,
    });
    return ledgerAwareSponsorDistOverride(match, "postmatch", sponsorLedger, base);
  }, [
    postmatchSpreadActive,
    match,
    sponsors,
    sponsorSlotMapPostmatch,
    phaseTick,
    sponsorInterrupted,
    sponsorLedger,
    sponsorRepeatBudgetCycles,
  ]);

  const sponsorClipBesideLiveBoard =
    !!match && sponsorRotationBesideScoreboard(match.status);

  const useLeftLayout =
    !!match &&
    !liveAutoBeside &&
    !liveAutoHalftime &&
    (goalVideoBesideLayout ||
      (LEFT_PANEL_INTERRUPT_MODES.has(mode)) ||
      (mode === "SPONSOR_ROTATION" && sponsorBesideShowsPanel(match, sponsors, playlists)) ||
      (mode === "SPONSOR" && sponsorClipBesideLiveBoard));

  const previewForcesSponsorBeside =
    embedInControl &&
    mode === "SPONSOR_ROTATION" &&
    previewFollowClip != null &&
    sponsorBesideConfigured;
  const sponsorBudgetSponsorFilter = previewFollowClip
    ? previewFollowClip.sponsorId
    : sponsorDistView.phase === "sponsor"
      ? sponsorDistView.sponsorFilterId
      : null;

  const liveSponsorBesideContent = useMemo(() => {
    if (
      !state ||
      !match ||
      !sponsorBesideConfigured ||
      (sponsorDistView.phase !== "sponsor" && !previewForcesSponsorBeside)
    ) {
      return null;
    }
    const section = sectionForStatus(match.status);
    if (hasSponsorsForSection(sponsors, section, match.status)) {
      return (
        <SponsorBudgetRotation
          key={`sbr-beside-${match.id}-${section}`}
          sponsors={sponsors}
          section={section}
          matchStatus={match.status}
          sponsorIdFilter={sponsorBudgetSponsorFilter}
          playbackTelemetry={sponsorPlaybackTelemetry}
          followPlayback={embedInControl}
          followClip={previewFollowClip}
          showPreviewProgress={embedInControl}
          renderVideo
          fallback={sponsorBudgetFallbackScoreboard}
          cycleBudgetForever={sponsorRepeatBudgetCycles}
          paused={
            sponsorInterrupted ||
            mode !== "SPONSOR_ROTATION" ||
            !matchTimerRunning
          }
          {...matchSponsorPinProps}
        />
      );
    }
    return (
      <SponsorRotation
        key="sr-panel-stable"
        playlist={pickSponsorPlaylist(playlists, match.status) ?? playlists.IDLE}
        showPreviewProgress={embedInControl}
        idleEmptyFallback={idleEmptyFallback}
      />
    );
  }, [
    state,
    match,
    sponsorBesideConfigured,
    sponsorDistView.phase,
    previewForcesSponsorBeside,
    sponsorBudgetSponsorFilter,
    sponsors,
    playlists,
    embedInControl,
    previewFollowClip,
    sponsorPlaybackTelemetry,
    sponsorBudgetFallbackScoreboard,
    sponsorRepeatBudgetCycles,
    sponsorInterrupted,
    matchTimerRunning,
    mode,
    idleEmptyFallback,
  ]);

  const keepLiveSponsorBesideMounted =
    !!state &&
    !!match &&
    sponsorBesideConfigured &&
    (mode === "SPONSOR_ROTATION" || sponsorInterrupted) &&
    (sponsorDistView.phase === "sponsor" || previewForcesSponsorBeside) &&
    liveSponsorBesideContent != null;
  const showLiveSponsorBeside =
    keepLiveSponsorBesideMounted && mode === "SPONSOR_ROTATION";

  // Content that goes in the right panel (when the left scoreboard is shown)
  // or fullscreen (when it isn't).
  const activeContent = useMemo(() => {
    if (!state) return null;
    if (mode === "MATCH" && match) {
      return null;
    }
    if (goalVideoBesideLayout && match) {
      const section = sectionForStatus(match.status);
      const sponsorUnder =
        hasSponsorsForSection(sponsors, section, match.status) ? (
          <SponsorBudgetRotation
            key={`sbr-under-goal-${match.id}-${section}`}
            sponsors={sponsors}
            section={section}
            matchStatus={match.status}
            sponsorIdFilter={sponsorBudgetSponsorFilter}
            playbackTelemetry={sponsorPlaybackTelemetry}
            followPlayback={embedInControl}
            followClip={previewFollowClip}
            showPreviewProgress={embedInControl}
            renderVideo
            fallback={sponsorBudgetFallbackScoreboard}
            cycleBudgetForever={sponsorRepeatBudgetCycles}
            paused
            {...matchSponsorPinProps}
          />
        ) : null;
      if (mode === "GOAL_INTRO_VIDEO") {
        return (
          <div key="goal-intro-beside-stack" className="absolute inset-0">
            {sponsorUnder}
            <div className="absolute inset-0 z-[3] bg-black">
              {activeMedia ? (
                <SingleMediaMode
                  key="goal-intro"
                  media={activeMedia}
                  loop
                  fallback={<GoalIntroFallback />}
                  showPreviewProgress={embedInControl}
                />
              ) : (
                <GoalIntroFallback key="goal-intro-fallback-only" />
              )}
            </div>
          </div>
        );
      }
      if (mode === "GOAL_PLAYER_VIDEO" && activeMedia) {
        return (
          <div key="goal-player-beside-stack" className="absolute inset-0">
            {sponsorUnder}
            <div className="absolute inset-0 z-[3]">
              <SingleMediaMode
                key={`goal-player-${activeMedia.id}`}
                media={activeMedia}
                showPreviewProgress={embedInControl}
                onVideoEnded={() => {
                  if (embedInControl) return;
                  void sendCommand({ type: "display:setMode", mode: "SPONSOR_ROTATION" });
                }}
              />
            </div>
          </div>
        );
      }
    }
    if (mode === "SPONSOR_ROTATION" && match && sponsorRotationBesideScoreboard(match.status)) {
      const section = sectionForStatus(match.status);
      if (hasSponsorsForSection(sponsors, section, match.status)) {
        return (
          <SponsorBudgetRotation
            key={`sbr-fs-panel-${match.id}-${section}`}
            sponsors={sponsors}
            section={section}
            matchStatus={match.status}
            sponsorIdFilter={sponsorBudgetSponsorFilter}
            playbackTelemetry={sponsorPlaybackTelemetry}
            followPlayback={embedInControl}
            followClip={previewFollowClip}
            showPreviewProgress={embedInControl}
            renderVideo
            fallback={sponsorBudgetFallbackScoreboard}
            cycleBudgetForever={sponsorRepeatBudgetCycles}
            paused={
              sponsorInterrupted ||
              mode !== "SPONSOR_ROTATION" ||
              !matchTimerRunning
            }
            {...matchSponsorPinProps}
          />
        );
      }
      return (
        <SponsorRotation
          key="sr-panel"
          playlist={pickSponsorPlaylist(playlists, match.status) ?? playlists.IDLE}
          showPreviewProgress={embedInControl}
          idleEmptyFallback={idleEmptyFallback}
        />
      );
    }
    if (mode === "GOAL" && match) {
      return (
        <GoalMode key="goal" match={match} scorer={scorer} side={goalSide} />
      );
    }
    if (mode === "CARD" && match) {
      return (
        <CardMode
          key="card"
          player={cardPlayer}
          color={"YELLOW"}
          minute={currentMinute}
        />
      );
    }
    if (mode === "SPONSOR" && match && sponsorClipBesideLiveBoard) {
      if (activeMedia) {
        return (
          <SingleMediaMode
            key={`sm-panel-${activeMedia.id}`}
            media={activeMedia}
            showPreviewProgress={embedInControl}
          />
        );
      }
      return (
        <MatchScoreboardFull
          key="sponsor-panel-scoreboard"
          match={match}
          elapsed={scoreboardClock}
          shotClock={shotClock}
          running={state.timerRunning ?? false}
          period={period}
          addedTime={addedTimeMinutes}
          theme={scoreboardTheme}
        />
      );
    }
    return null;
  }, [
    state,
    mode,
    match,
    sponsors,
    playlists,
    embedInControl,
    scorer,
    goalSide,
    cardPlayer,
    currentMinute,
    activeMedia,
    sponsorBudgetSponsorFilter,
    sponsorDistView.phase,
    sponsorDistView.sponsorFilterId,
    elapsed,
    period,
    addedTimeMinutes,
    sponsorPlaybackTelemetry,
    previewFollowClip,
    scoreboardTheme,
    sponsorBudgetFallbackScoreboard,
    sponsorRepeatBudgetCycles,
    idleEmptyFallback,
    goalVideoBesideLayout,
    sponsorInterrupted,
    matchTimerRunning,
  ]);

  return (
    <ScaleContainer
      variant={embedInControl ? "embedded" : "fullscreen"}
      width={displayCanvas.width}
      height={displayCanvas.height}
      scalingMode={displayCanvas.mode}
      safeZoneVisible={displayCanvas.safeZoneVisible && !embedInControl}
      safeZoneMarginPx={displayCanvas.safeZoneMarginPx}
    >
      {!embedInControl && <DisplayWatchdog />}

      {/* Fullscreen modes */}
      <AnimatePresence mode="sync">
        {!state && <IdleScreen key="ix" connecting={!connected} />}

        {state && mode === "IDLE" && (() => {
          if (hasSponsorsForSection(sponsors, "prematch")) {
            if (prematchDistView.phase === "sponsor") {
              return (
                <SponsorBudgetRotation
                  key="idle-sbr-spread"
                  sponsors={sponsors}
                  section="prematch"
                  sponsorIdFilter={prematchDistView.sponsorFilterId ?? undefined}
                  playbackTelemetry={sponsorPlaybackTelemetry}
                  followPlayback={embedInControl}
                  followClip={previewFollowClip}
                  showPreviewProgress={embedInControl}
                  renderVideo
                  fallback={sponsorBudgetFallbackScoreboard}
                  cycleBudgetForever={sponsorRepeatBudgetCycles}
                  matchSponsorMediaId={null}
                  matchSponsorMedia={null}
                />
              );
            }
            if (match) {
              return (
                <MatchScoreboardFull
                  key="idle-prematch-scoreboard"
                  match={match}
                  elapsed={scoreboardClock}
                  shotClock={shotClock}
                  running={state.timerRunning ?? false}
                  period={period}
                  addedTime={addedTimeMinutes}
                  theme={scoreboardTheme}
                />
              );
            }
            return (
              <SponsorRotation
                key="idle-pl-spread"
                playlist={playlists.PREMATCH ?? playlists.IDLE}
                showPreviewProgress={embedInControl}
                idleEmptyFallback={idleEmptyFallback}
              />
            );
          }
          return (
            <SponsorRotation
              key="idle"
              playlist={playlists.IDLE}
              showPreviewProgress={embedInControl}
              idleEmptyFallback={idleEmptyFallback}
            />
          );
        })()}

        {/* Sponsor-slides fullscreen wanneer géén actieve speelhelft (rust, prematch, …). */}
        {state &&
          mode === "SPONSOR_ROTATION" &&
          !(match && sponsorRotationBesideScoreboard(match.status)) &&
          !liveAutoHalftime && (
            <SponsorRotationLiveContent
              key="sponsor-rotation-fs"
              match={match}
              playlists={playlists}
              sponsors={sponsors}
              showPreviewProgress={embedInControl}
              playbackTelemetry={sponsorPlaybackTelemetry}
              followPlayback={embedInControl}
              followClip={previewFollowClip}
              prematchSpread={prematchSpreadActive ? prematchDistView : null}
              postmatchSpread={postmatchSpreadActive ? postmatchDistView : null}
              prematchScoreboardNode={
                match && state ? (
                  <MatchScoreboardFull
                    key="prematch-spread-gap-board"
                    match={match}
                    elapsed={scoreboardClock}
                    shotClock={shotClock}
                    running={state.timerRunning ?? false}
                    period={period}
                    addedTime={addedTimeMinutes}
                    theme={scoreboardTheme}
                  />
                ) : null
              }
              sponsorBudgetFallback={sponsorBudgetFallbackScoreboard}
              cycleBudgetForever={sponsorRepeatBudgetCycles}
              idleEmptyFallback={idleEmptyFallback}
            />
          )}

        {state &&
          match &&
          liveAutoHalftime &&
          sponsorDistView.phase === "scoreboard" && (
            <HalfTimeMode key="ht-live-cycle" match={match} />
          )}

        {state &&
          match &&
          (shouldShowFullScreenMatchBoard(match, mode, sponsors, playlists) ||
            (liveAutoBeside && sponsorDistView.phase === "scoreboard" && !previewForcesSponsorBeside)) &&
          !(liveAutoHalftime && sponsorDistView.phase === "scoreboard") && (
            <MatchScoreboardFull
              key="match-board-full"
              match={match}
              elapsed={scoreboardClock}
              shotClock={shotClock}
              running={state.timerRunning ?? false}
              period={period}
              addedTime={addedTimeMinutes}
              theme={scoreboardTheme}
            />
          )}

        {state && match && liveAutoHalftime && sponsorDistView.phase === "sponsor" && (
          <motion.div
            key="ht-sponsor-cycle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 z-[5] bg-black"
          >
            {hasSponsorsForSection(sponsors, "halftime") ? (
              <SponsorBudgetRotation
                key={`ht-sbr-${match.id}`}
                sponsors={sponsors}
                section="halftime"
                sponsorIdFilter={sponsorDistView.sponsorFilterId}
                playbackTelemetry={sponsorPlaybackTelemetry}
                followPlayback={embedInControl}
                followClip={previewFollowClip}
                showPreviewProgress={embedInControl}
                renderVideo
                fallback={halftimeSponsorFallback}
                cycleBudgetForever={sponsorRepeatBudgetCycles}
                {...matchSponsorPinProps}
              />
            ) : (
              <SponsorRotationLiveContent
                match={match}
                playlists={playlists}
                sponsors={sponsors}
                showPreviewProgress={embedInControl}
                idleEmptyFallback={idleEmptyFallback}
              />
            )}
          </motion.div>
        )}

        {state && mode === "TEAM_INTRO" && match && (
          <TeamIntroMode key="ti" match={match} />
        )}

        {state &&
          mode === "PLAYER_INTRO" &&
          match &&
          !activePlayer && (
            <MatchScoreboardFull
              key="player-intro-fallback-board"
              match={match}
              elapsed={scoreboardClock}
              shotClock={shotClock}
              running={state.timerRunning ?? false}
              period={period}
              addedTime={addedTimeMinutes}
              theme={scoreboardTheme}
            />
          )}

        {state &&
          mode === "PLAYER_INTRO" &&
          activePlayer &&
          match &&
          (activePlayer.teamId === match.homeTeamId ? match.homeTeam : match.awayTeam) && (
            <PlayerIntroMode
              key="pi"
              player={activePlayer}
              team={
                activePlayer.teamId === match.homeTeamId ? match.homeTeam : match.awayTeam!
              }
            />
          )}

        {state && mode === "HALFTIME" && match && (
          <HalfTimeMode key="ht" match={match} />
        )}

        {state && mode === "FULLTIME" && match && (
          <FullTimeMode key="ft" match={match} />
        )}

        {/* Wissel: fullscreen (geen scorestrip); tijdens speelhelft blijft score bij handmatige SPONSOR wel zichtbaar. */}
        {state && mode === "SUBSTITUTION" && match && (
          <SubstitutionMode
            key="sub-fs"
            team={subTeam}
            playerIn={subIn}
            playerOut={subOut}
            minute={currentMinute}
          />
        )}

        {state &&
          mode === "SPONSOR" &&
          !(match && sponsorRotationBesideScoreboard(match.status)) &&
          activeMedia && (
            <SingleMediaMode
              key={`sm-${activeMedia.id}`}
              media={activeMedia}
              showPreviewProgress={embedInControl}
            />
          )}
        {state &&
          mode === "SPONSOR" &&
          !(match && sponsorRotationBesideScoreboard(match.status)) &&
          !activeMedia &&
          match && (
            <MatchScoreboardFull
              key="sponsor-fs-scoreboard"
              match={match}
              elapsed={scoreboardClock}
              shotClock={shotClock}
              running={state.timerRunning ?? false}
              period={period}
              addedTime={addedTimeMinutes}
              theme={scoreboardTheme}
            />
          )}

        {/* Fullscreen generic "GOAL" intro video, played while the
            operator is picking the scorer. */}
        {state &&
          mode === "GOAL_INTRO_VIDEO" &&
          !(match && sponsorBesideConfigured && sponsorRotationBesideScoreboard(match.status)) && (
          <SingleMediaMode
            key="goal-intro"
            media={activeMedia}
            loop
            fallback={<GoalIntroFallback />}
            showPreviewProgress={embedInControl}
          />
        )}

        {/* Fullscreen celebration video of the confirmed scorer. */}
        {state &&
          mode === "GOAL_PLAYER_VIDEO" &&
          activeMedia &&
          !(match && sponsorBesideConfigured && sponsorRotationBesideScoreboard(match.status)) && (
          <SingleMediaMode
            key={`goal-player-${activeMedia.id}`}
            media={activeMedia}
            showPreviewProgress={embedInControl}
            onVideoEnded={() => {
              if (embedInControl) return;
              sendCommand({ type: "display:setMode", mode: "SPONSOR_ROTATION" });
            }}
          />
        )}

        {state && mode === "BLACKOUT" && <BlackoutMode key="bo" />}
      </AnimatePresence>

      {activeScheduledCue && mode !== "BLACKOUT" && match && sponsorRotationBesideScoreboard(match.status) && (
        <div className="absolute inset-0 z-[88]">
          <LeftScoreboardLayout
            match={match}
            elapsed={scoreboardClock}
            shotClock={shotClock}
            running={state?.timerRunning ?? false}
            period={period}
            addedTime={addedTimeMinutes}
            theme={scoreboardTheme}
          >
            <SingleMediaMode
              key={`scheduled-cue-panel-${activeScheduledCue.id}`}
              media={activeScheduledCue.media}
              showPreviewProgress={embedInControl}
              onVideoEnded={() => dismissActiveScheduledCue()}
            />
          </LeftScoreboardLayout>
        </div>
      )}

      {activeScheduledCue && mode !== "BLACKOUT" && !(match && sponsorRotationBesideScoreboard(match.status)) && (
        <div className="absolute inset-0 z-[88] bg-black">
          <SingleMediaMode
            key={`scheduled-cue-fullscreen-${activeScheduledCue.id}`}
            media={activeScheduledCue.media}
            showPreviewProgress={embedInControl}
            onVideoEnded={() => dismissActiveScheduledCue()}
          />
        </div>
      )}

      {state &&
        prematchMatchSponsorOverlay &&
        match?.matchSponsorMedia &&
        mode !== "BLACKOUT" && (
          <div className="absolute inset-0 z-[87] pointer-events-none" aria-hidden>
            <SingleMediaMode
              key={`prematch-ms-${match.matchSponsorMedia.id}`}
              media={match.matchSponsorMedia}
              loop={false}
              showPreviewProgress={embedInControl}
              previewProgressWallClock={
                embedInControl && match.kickoffAt
                  ? (() => {
                      const ko = new Date(match.kickoffAt).getTime();
                      return {
                        windowStartMs: ko - PREMATCH_MATCH_SPONSOR_LEAD_MS,
                        windowEndMs: ko,
                        tick: prematchClock,
                      };
                    })()
                  : undefined
              }
            />
          </div>
        )}

      {/* Speelhelft + “Scorebord + sponsors”: sponsorfase naast vaste score/timer-kolom (niet fullscreen). */}
      {keepLiveSponsorBesideMounted && match && liveSponsorBesideContent && (
        <div
          className={
            showLiveSponsorBeside
              ? "absolute inset-0 z-[12]"
              : "pointer-events-none absolute inset-0 z-0 opacity-0"
          }
          aria-hidden={!showLiveSponsorBeside}
        >
          <LeftScoreboardLayout
            match={match}
            elapsed={scoreboardClock}
            shotClock={shotClock}
            running={state.timerRunning ?? false}
            period={period}
            addedTime={addedTimeMinutes}
            theme={scoreboardTheme}
          >
            <AnimatePresence mode="sync">
              <motion.div
                key="live-sponsor-beside"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="absolute inset-0"
              >
                {liveSponsorBesideContent}
              </motion.div>
            </AnimatePresence>
          </LeftScoreboardLayout>
        </div>
      )}

      {/* Active-match modes: wrap content in the left-scoreboard layout */}
      {useLeftLayout && match && (
        <LeftScoreboardLayout
          match={match}
          elapsed={scoreboardClock}
          shotClock={shotClock}
          running={state?.timerRunning ?? false}
          period={period}
          addedTime={addedTimeMinutes}
          theme={scoreboardTheme}
        >
          <AnimatePresence mode="wait">{activeContent}</AnimatePresence>
        </LeftScoreboardLayout>
      )}

      {state?.externalCaptureToDisplay &&
        state.externalCaptureSourceId &&
        mode !== "BLACKOUT" && (
          <div className="absolute inset-0 z-[55] bg-black">
            <ExternalCaptureVideo
              sourceId={state.externalCaptureSourceId}
              audio={readExternalCaptureAudioPref()}
            />
          </div>
        )}
    </ScaleContainer>
  );
}

/** Fullscreen sponsor-slides tijdens "Sponsors (Live)" — zelfde logica als voorheen, maar niet in LeftScoreboardLayout. */
function SponsorRotationLiveContent({
  match,
  playlists,
  sponsors,
  showPreviewProgress = false,
  playbackTelemetry = null,
  followPlayback = false,
  followClip = null,
  prematchSpread = null,
  postmatchSpread = null,
  prematchScoreboardNode = null,
  sponsorBudgetFallback = null,
  cycleBudgetForever = false,
  idleEmptyFallback = null,
}: {
  match: Match | null;
  playlists: Record<PlaylistSlot, Playlist | null>;
  sponsors: Sponsor[];
  showPreviewProgress?: boolean;
  playbackTelemetry?: { matchId: string; matchStatus: string } | null;
  followPlayback?: boolean;
  followClip?: {
    sponsorId: string;
    mediaId: string;
    startedAtMs: number;
    expectedPlaySec: number;
    clipSessionId: string;
  } | null;
  prematchSpread?: {
    phase: "scoreboard" | "sponsor";
    sponsorFilterId: string | null;
  } | null;
  /** Na-wedstrijd-rooster, zelfde vorm als `prematchSpread`. */
  postmatchSpread?: {
    phase: "scoreboard" | "sponsor";
    sponsorFilterId: string | null;
  } | null;
  /** Tijdens prematch-rooster in «scoreboard»-gap: echte scorebordweergave i.p.v. PREMATCH-playlist. */
  prematchScoreboardNode?: ReactNode | null;
  sponsorBudgetFallback?: ReactNode;
  cycleBudgetForever?: boolean;
  idleEmptyFallback?: IdleEmptyFallback | null;
}) {
  if (!match) {
    return (
      <SponsorRotation
        playlist={playlists.IDLE}
        showPreviewProgress={showPreviewProgress}
        idleEmptyFallback={idleEmptyFallback}
      />
    );
  }
  const section = sectionForStatus(match.status);
  if (
    section === "prematch" &&
    prematchSpread &&
    hasSponsorsForSection(sponsors, "prematch")
  ) {
    if (prematchSpread.phase === "sponsor") {
      return (
        <SponsorBudgetRotation
          sponsors={sponsors}
          section="prematch"
          sponsorIdFilter={prematchSpread.sponsorFilterId ?? undefined}
          playbackTelemetry={playbackTelemetry}
          followPlayback={followPlayback}
          followClip={followClip}
          showPreviewProgress={showPreviewProgress}
          renderVideo
          fallback={sponsorBudgetFallback ?? undefined}
          cycleBudgetForever={cycleBudgetForever}
          /**
           * Géén matchsponsor-pin op het rooster: `applyMatchSponsorMediaPin` vervangt dan
           * de hele medialijst van de sponsor door die ene clip, waardoor een sponsor met
           * meerdere bestanden er in «voor wedstrijd» maar één afspeelt. De fullscreen
           * matchsponsor-overlay is hier al uitgezet ten gunste van het rooster
           * (`prematchMatchSponsorOverlay`), dus het rooster bepaalt wat er speelt.
           */
          matchSponsorMediaId={null}
          matchSponsorMedia={null}
        />
      );
    }
    if (prematchScoreboardNode) {
      return <>{prematchScoreboardNode}</>;
    }
    return (
      <SponsorRotation
        playlist={pickSponsorPlaylist(playlists, match.status) ?? playlists.IDLE}
        showPreviewProgress={showPreviewProgress}
        idleEmptyFallback={idleEmptyFallback}
      />
    );
  }
  if (
    section === "postmatch" &&
    postmatchSpread &&
    hasSponsorsForSection(sponsors, "postmatch")
  ) {
    if (postmatchSpread.phase === "sponsor") {
      return (
        <SponsorBudgetRotation
          sponsors={sponsors}
          section="postmatch"
          matchStatus={match.status}
          sponsorIdFilter={postmatchSpread.sponsorFilterId ?? undefined}
          playbackTelemetry={playbackTelemetry}
          followPlayback={followPlayback}
          followClip={followClip}
          showPreviewProgress={showPreviewProgress}
          renderVideo
          fallback={sponsorBudgetFallback ?? undefined}
          cycleBudgetForever={cycleBudgetForever}
          /** Zelfde reden als bij het prematch-rooster: geen pin over de rotatie heen. */
          matchSponsorMediaId={null}
          matchSponsorMedia={null}
        />
      );
    }
    if (prematchScoreboardNode) {
      return <>{prematchScoreboardNode}</>;
    }
    return (
      <SponsorRotation
        playlist={pickSponsorPlaylist(playlists, match.status) ?? playlists.IDLE}
        showPreviewProgress={showPreviewProgress}
        idleEmptyFallback={idleEmptyFallback}
      />
    );
  }
  if (hasSponsorsForSection(sponsors, section, match.status)) {
    return (
      <SponsorBudgetRotation
        sponsors={sponsors}
        section={section}
        matchStatus={match.status}
        playbackTelemetry={playbackTelemetry}
        followPlayback={followPlayback}
        followClip={followClip}
        showPreviewProgress={showPreviewProgress}
        renderVideo
        fallback={sponsorBudgetFallback ?? undefined}
        cycleBudgetForever={cycleBudgetForever}
        matchSponsorMediaId={match.matchSponsorMediaId ?? null}
        matchSponsorMedia={match.matchSponsorMedia ?? null}
      />
    );
  }
  return (
    <SponsorRotation
      /** Na de wedstrijd hoort de POSTMATCH-playlist te draaien, niet die van vóór de match. */
      playlist={pickSponsorPlaylist(playlists, match.status) ?? playlists.IDLE}
      showPreviewProgress={showPreviewProgress}
      idleEmptyFallback={idleEmptyFallback}
    />
  );
}

function IdleScreen({ connecting }: { connecting: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 bg-black">
      <div className="text-[140px] font-black text-white/90 tracking-tight">
        STADIUM
      </div>
      <div className="text-[48px] text-white/40">
        {connecting ? "Connecting..." : "Ready"}
      </div>
    </div>
  );
}

function BlackoutMode() {
  return <div className="absolute inset-0 z-[90] bg-black" aria-hidden />;
}

function SingleMediaMode({
  media,
  loop = false,
  fallback,
  showPreviewProgress = false,
  previewProgressWallClock,
  onVideoEnded,
}: {
  media: MediaItem | null;
  loop?: boolean;
  fallback?: React.ReactNode;
  showPreviewProgress?: boolean;
  /** Preview-balk over muurklok-tijdvenster (bijv. 5 min matchsponsor), niet media-duur. */
  previewProgressWallClock?: {
    windowStartMs: number;
    windowEndMs: number;
    tick: number;
  };
  /** Callback wanneer de video natuurlijk eindigt (alleen relevant zonder loop). */
  onVideoEnded?: () => void;
}) {
  const [videoElapsed01, setVideoElapsed01] = useState(0);
  const [videoDurSec, setVideoDurSec] = useState(0);

  const imageTotalMs =
    media?.type === "IMAGE" &&
    showPreviewProgress &&
    !previewProgressWallClock
      ? Math.max(1500, Math.max(1, media.durationSec) * 1000)
      : 0;
  const imageElapsed = useTimedSlideProgress(
    imageTotalMs,
    media?.type === "IMAGE" ? media.id : "img-off",
  );
  const videoRef = useRef<HTMLVideoElement>(null);

  const logMediaDiag = (event: string, v: HTMLVideoElement) => {
    if (showPreviewProgress || !media || media.type !== "VIDEO") return;
    const throttleMs =
      event === "error"
        ? 0
        : event === "loaded_metadata"
          ? 5000
          : event === "stalled" || event === "waiting" || event === "suspend"
            ? 15000
            : 0;
    reportDisplayMediaDiagnostic(
      {
        source: "single-media",
        event,
        mediaId: media.id,
        mediaTitle: media.title,
        mediaPath: media.path,
        ...videoElementDiagnosticFields(v),
        atMs: Date.now(),
      },
      throttleMs,
    );
  };

  useEffect(() => {
    setVideoElapsed01(0);
    setVideoDurSec(0);
  }, [media?.id, media?.path]);

  useEffect(() => {
    if (media?.type !== "VIDEO" || !(media.playAudio ?? false)) return;
    const v = videoRef.current;
    if (!v) return;
    const id = window.setTimeout(() => {
      void v.play().catch(() => {});
    }, 0);
    return () => clearTimeout(id);
  }, [media?.id, media?.path, media?.playAudio, media?.type]);

  useEffect(() => {
    if (media?.type !== "VIDEO") return;
    return () => {
      releaseHtmlVideoElement(videoRef.current);
    };
  }, [media?.id, media?.path, media?.type]);

  useEffect(() => {
    if (showPreviewProgress) return;
    if (!media) return;
    reportDisplayPlaybackToMain({
      source: "single-media",
      mediaId: media.id,
      mediaTitle: media.title,
      mediaPath: media.path,
      mediaType: media.type,
      atMs: Date.now(),
    });
  }, [media?.id, media?.path, media?.title, media?.type, showPreviewProgress]);

  if (!media) {
    return <>{fallback ?? <div className="absolute inset-0 bg-black" />}</>;
  }

  const videoTotalMs =
    videoDurSec > 0
      ? videoDurSec * 1000
      : Math.max(1500, Math.max(1, media.durationSec) * 1000);

  let wallClockBar: ReactNode = null;
  if (showPreviewProgress && previewProgressWallClock) {
    void previewProgressWallClock.tick;
    const span = Math.max(
      1,
      previewProgressWallClock.windowEndMs - previewProgressWallClock.windowStartMs,
    );
    const elapsed01 = Math.min(
      1,
      Math.max(0, (Date.now() - previewProgressWallClock.windowStartMs) / span),
    );
    wallClockBar = <PreviewSlideProgressBar elapsed01={elapsed01} totalMs={span} />;
  }

  return (
    <div className="absolute inset-0 overflow-hidden bg-black contain-layout contain-paint">
      {media.type === "VIDEO" ? (
        <video
          ref={videoRef}
          src={mediaUrl(media.path)}
          autoPlay
          muted={!(media.playAudio ?? false)}
          playsInline
          loop={loop}
          preload="metadata"
          style={DISPLAY_COVER_MEDIA_STYLE}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (d > 0 && Number.isFinite(d)) setVideoDurSec(d);
            logMediaDiag("loaded_metadata", e.currentTarget);
          }}
          onTimeUpdate={(e) => {
            if (!showPreviewProgress || previewProgressWallClock) return;
            const v = e.currentTarget;
            const d = v.duration;
            if (d > 0 && Number.isFinite(d)) {
              setVideoElapsed01(Math.min(1, v.currentTime / d));
            }
          }}
          onEnded={() => {
            if (!loop) onVideoEnded?.();
          }}
          onStalled={(e) => logMediaDiag("stalled", e.currentTarget)}
          onWaiting={(e) => logMediaDiag("waiting", e.currentTarget)}
          onSuspend={(e) => logMediaDiag("suspend", e.currentTarget)}
          onError={(e) => logMediaDiag("error", e.currentTarget)}
        />
      ) : (
        <img src={mediaUrl(media.path)} alt="" decoding="async" style={DISPLAY_COVER_MEDIA_STYLE} />
      )}
      {wallClockBar}
      {showPreviewProgress &&
        !previewProgressWallClock &&
        media.type === "IMAGE" &&
        imageTotalMs > 0 && (
          <PreviewSlideProgressBar elapsed01={imageElapsed} totalMs={imageTotalMs} />
        )}
      {showPreviewProgress && !previewProgressWallClock && media.type === "VIDEO" && (
        <PreviewSlideProgressBar elapsed01={videoElapsed01} totalMs={videoTotalMs} />
      )}
    </div>
  );
}

function GoalIntroFallback() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-green-600 via-emerald-700 to-slate-900">
      <div
        className="font-black text-white leading-none animate-pulse"
        style={{ fontSize: 360, textShadow: "0 20px 80px rgba(0,0,0,0.5)" }}
      >
        GOAL!
      </div>
    </div>
  );
}

function humanPeriod(match: Match | null): string {
  const status = match?.status;
  if (match && (status === "FIRST_HALF" || status === "SECOND_HALF" || status === "EXTRA_TIME")) {
    return sportPeriodLabel(match.sport, match.currentPeriod);
  }
  switch (status) {
    case "FIRST_HALF":
      return "1ST HALF";
    case "SECOND_HALF":
      return "2ND HALF";
    case "HALF_TIME":
      return "PAUZE";
    case "FULL_TIME":
      return "FULL-TIME";
    case "EXTRA_TIME":
      return "EXTRA TIME";
    default:
      return "LIVE";
  }
}
