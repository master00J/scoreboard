"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  PreviewSlideProgressBar,
  useTimedSlideProgress,
} from "./_components/preview-slide-progress";
import { DISPLAY_COVER_MEDIA_STYLE } from "@/lib/display-cover-media-style";
import { AnimatePresence, motion } from "framer-motion";
import { ScaleContainer } from "@/components/scale-container";
import { useSocketSync, sendCommand } from "@/lib/use-socket";
import type { DisplayModeT } from "@/lib/validation/commands";
import { useDisplayStore } from "@/lib/store";
import { useLiveTimerSeconds } from "@/lib/use-timer";
import type {
  AppSettings,
  Match,
  MediaItem,
  Player,
  Playlist,
  PlaylistSlot,
  Sponsor,
} from "@/lib/types";
import {
  mergeScoreboardTheme,
  sponsorRepeatBudgetCyclesFromThemeJson,
  type ResolvedScoreboardTheme,
} from "@/lib/scoreboard-theme";
import { mediaUrl } from "@/lib/media-url";
import {
  isPrematchMatchSponsorWindow,
  PREMATCH_MATCH_SPONSOR_LEAD_MS,
} from "@/lib/prematch-match-sponsor";
import {
  activeSponsorsForSection,
  buildSponsorSlotMap,
  halfWindowElapsed,
  lookupSponsorAtSecond,
  resolveSponsorSpreadPhase,
} from "@/lib/sponsor-distribution";
import {
  hasSponsorsForSection,
  pickSponsorPlaylist,
  sectionForStatus,
  shouldShowFullScreenMatchBoard,
  sponsorBesideShowsPanel,
  sponsorHalftimeShowsPanel,
  sponsorRotationBesideScoreboard,
} from "@/lib/sponsor-display-helpers";
import { LeftScoreboardLayout } from "./_modes/left-scoreboard-layout";
import { MatchScoreboardFull } from "./_modes/match-scoreboard-full";
import { GoalMode } from "./_modes/goal";
import { SubstitutionMode } from "./_modes/substitution";
import { CardMode } from "./_modes/card";
import { TeamIntroMode } from "./_modes/team-intro";
import { PlayerIntroMode } from "./_modes/player-intro";
import { SponsorRotation } from "./_modes/sponsor-rotation";
import { SponsorBudgetRotation } from "./_modes/sponsor-budget-rotation";
import { HalfTimeMode, FullTimeMode } from "./_modes/halftime-fulltime";
import { DisplayWatchdog } from "./_components/watchdog";
import { ExternalCaptureVideo } from "@/components/external-capture-video";

/** Modes die naast het scorebord in het content-vlak staan (niet fullscreen over het canvas). */
const LEFT_PANEL_INTERRUPT_MODES = new Set(["GOAL", "CARD"]);

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
  const elapsed = useLiveTimerSeconds();

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

  /** Alleen het echte display-venster meldt afgespeelde sponsorclips (niet de ingebouwde preview). */
  const sponsorPlaybackTelemetry = useMemo(
    () =>
      !embedInControl && match ? { matchId: match.id, matchStatus: match.status } : null,
    [embedInControl, match?.id, match?.status],
  );

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
  const period = humanPeriod(match?.status);
  const currentMinute = Math.floor(elapsed / 60);

  const sponsorBudgetFallbackScoreboard = useMemo(() => {
    if (!state) return null;
    if (match) {
      return (
        <MatchScoreboardFull
          match={match}
          elapsed={elapsed}
          running={state.timerRunning ?? false}
          period={period}
          theme={scoreboardTheme}
        />
      );
    }
    return (
      <SponsorRotation
        playlist={playlists.PREMATCH ?? playlists.IDLE}
        showPreviewProgress={embedInControl}
      />
    );
  }, [state, match, elapsed, period, scoreboardTheme, playlists, embedInControl]);

  const halftimeSponsorFallback = useMemo(() => {
    if (!match) return null;
    return <HalfTimeMode match={match} />;
  }, [match]);

  const liveAutoBeside = useMemo(
    () =>
      !!match &&
      !!state &&
      mode === "SPONSOR_ROTATION" &&
      sponsorRotationBesideScoreboard(match.status) &&
      sponsorBesideShowsPanel(match, sponsors, playlists),
    [match, state, mode, sponsors, playlists],
  );

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
    if (mode === "IDLE") return true;
    return !!(
      mode === "SPONSOR_ROTATION" &&
      match &&
      !sponsorRotationBesideScoreboard(match.status) &&
      !liveAutoHalftime &&
      sectionForStatus(match.status) === "prematch"
    );
  }, [state, mode, match, sponsors, liveAutoHalftime]);

  const rustEpochRef = useRef<number | null>(null);
  useEffect(() => {
    if (match?.status === "HALF_TIME" && liveAutoHalftime) {
      if (rustEpochRef.current == null) rustEpochRef.current = Date.now();
    } else {
      rustEpochRef.current = null;
    }
  }, [match?.status, liveAutoHalftime]);

  const [phaseTick, setPhaseTick] = useState(0);
  useEffect(() => {
    if (!liveAutoBeside && !liveAutoHalftime && !prematchSpreadActive) return;
    const id = setInterval(() => setPhaseTick((n) => n + 1), 400);
    return () => clearInterval(id);
  }, [liveAutoBeside, liveAutoHalftime, prematchSpreadActive]);

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
    const budgetTotal = active.reduce((a, s) => a + Math.max(0, s.prematchSeconds), 0);
    const H = Math.max(60, budgetTotal);
    return buildSponsorSlotMap(active, "prematch", H);
  }, [sponsors]);

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
  const prematchPhaseHangRef = useRef<{
    sponsorId: string;
    untilMs: number;
    startedAtMs: number;
    startedAtSlotIdx?: number;
    lastSeenAtMs?: number;
  } | null>(null);
  const prematchOriginRef = useRef<number | null>(null);

  useEffect(() => {
    sponsorPhaseHangRef.current = null;
    prematchPhaseHangRef.current = null;
    prematchOriginRef.current = null;
  }, [match?.id]);

  /** Nieuwe fase (bijv. helft → rust): hang uit vorig segment mag niet doorlopen. */
  useEffect(() => {
    sponsorPhaseHangRef.current = null;
  }, [match?.status, liveAutoBeside, liveAutoHalftime]);

  useEffect(() => {
    if (!prematchSpreadActive) {
      prematchOriginRef.current = null;
      prematchPhaseHangRef.current = null;
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
    mode === "GOAL" ||
    mode === "GOAL_INTRO_VIDEO" ||
    mode === "GOAL_PLAYER_VIDEO" ||
    mode === "SUBSTITUTION" ||
    mode === "CARD" ||
    mode === "HALFTIME" ||
    mode === "FULLTIME";

  const sponsorDistView = useMemo(() => {
    const now = Date.now();

    if (liveAutoBeside && match) {
      const tLive = halfWindowElapsed(elapsed, match.status, match.halfDurationSec);
      if (mode === "SPONSOR_ROTATION") {
        tInterruptFrozen.current = tLive;
      }
      const t = mode === "SPONSOR_ROTATION" ? tLive : tInterruptFrozen.current;
      const v = lookupSponsorAtSecond(sponsorSlotMapMatch, t);
      const section = sectionForStatus(match.status);
      return resolveSponsorSpreadPhase(v, sponsors, section, match.status, now, sponsorPhaseHangRef, {
        slotMap: sponsorSlotMapMatch,
        slotT: t,
        interrupted: sponsorInterrupted,
      });
    }
    if (liveAutoHalftime && match && rustEpochRef.current != null) {
      const H = Math.max(60, match.halfBreakSec);
      const t = ((Date.now() - rustEpochRef.current) / 1000) % H;
      const v = lookupSponsorAtSecond(sponsorSlotMapHalftime, t);
      return resolveSponsorSpreadPhase(v, sponsors, "halftime", undefined, now, sponsorPhaseHangRef, {
        slotMap: sponsorSlotMapHalftime,
        slotT: t,
        interrupted: sponsorInterrupted,
      });
    }
    sponsorPhaseHangRef.current = null;
    return { phase: "scoreboard" as const, sponsorFilterId: null as string | null };
  }, [
    liveAutoBeside,
    liveAutoHalftime,
    match,
    sponsors,
    elapsed,
    mode,
    sponsorInterrupted,
    sponsorSlotMapMatch,
    sponsorSlotMapHalftime,
    phaseTick,
  ]);

  const prematchDistView = useMemo(() => {
    const now = Date.now();
    if (!prematchSpreadActive || prematchOriginRef.current == null) {
      return { phase: "scoreboard" as const, sponsorFilterId: null as string | null };
    }
    const H = Math.max(1, sponsorSlotMapPrematch.length);
    const t = ((now - prematchOriginRef.current) / 1000) % H;
    const v = lookupSponsorAtSecond(sponsorSlotMapPrematch, t);
    return resolveSponsorSpreadPhase(v, sponsors, "prematch", undefined, now, prematchPhaseHangRef, {
      slotMap: sponsorSlotMapPrematch,
      slotT: t,
    });
  }, [prematchSpreadActive, sponsorSlotMapPrematch, sponsors, phaseTick]);

  const sponsorClipBesideLiveBoard =
    !!match && sponsorRotationBesideScoreboard(match.status);

  const useLeftLayout =
    !!match &&
    !liveAutoBeside &&
    !liveAutoHalftime &&
    ((LEFT_PANEL_INTERRUPT_MODES.has(mode)) ||
      (mode === "SPONSOR_ROTATION" && sponsorBesideShowsPanel(match, sponsors, playlists)) ||
      (mode === "SPONSOR" && sponsorClipBesideLiveBoard));

  const sponsorBudgetSponsorFilter =
    sponsorDistView.phase === "sponsor" ? sponsorDistView.sponsorFilterId : null;

  // Content that goes in the right panel (when the left scoreboard is shown)
  // or fullscreen (when it isn't).
  const activeContent = useMemo(() => {
    if (!state) return null;
    if (mode === "MATCH" && match) {
      return null;
    }
    if (mode === "SPONSOR_ROTATION" && match && sponsorRotationBesideScoreboard(match.status)) {
      const section = sectionForStatus(match.status);
      if (hasSponsorsForSection(sponsors, section, match.status)) {
        return (
          <SponsorBudgetRotation
            key={`sbr-panel-${section}-${sponsorBudgetSponsorFilter ?? "all"}`}
            sponsors={sponsors}
            section={section}
            matchStatus={match.status}
            sponsorIdFilter={sponsorBudgetSponsorFilter}
            playbackTelemetry={sponsorPlaybackTelemetry}
            showPreviewProgress={embedInControl}
            fallback={sponsorBudgetFallbackScoreboard}
            cycleBudgetForever={sponsorRepeatBudgetCycles}
          />
        );
      }
      return (
        <SponsorRotation
          key="sr-panel"
          playlist={pickSponsorPlaylist(playlists, match.status) ?? playlists.IDLE}
          showPreviewProgress={embedInControl}
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
          elapsed={elapsed}
          running={state.timerRunning ?? false}
          period={period}
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
    sponsorPlaybackTelemetry,
    scoreboardTheme,
    sponsorBudgetFallbackScoreboard,
    sponsorRepeatBudgetCycles,
  ]);

  return (
    <ScaleContainer variant={embedInControl ? "embedded" : "fullscreen"}>
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
                  showPreviewProgress={embedInControl}
                  fallback={sponsorBudgetFallbackScoreboard}
                  cycleBudgetForever={sponsorRepeatBudgetCycles}
                />
              );
            }
            if (match) {
              return (
                <MatchScoreboardFull
                  key="idle-prematch-scoreboard"
                  match={match}
                  elapsed={elapsed}
                  running={state.timerRunning ?? false}
                  period={period}
                  theme={scoreboardTheme}
                />
              );
            }
            return (
              <SponsorRotation
                key="idle-pl-spread"
                playlist={playlists.PREMATCH ?? playlists.IDLE}
                showPreviewProgress={embedInControl}
              />
            );
          }
          return (
            <SponsorRotation
              key="idle"
              playlist={playlists.IDLE}
              showPreviewProgress={embedInControl}
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
              prematchSpread={prematchSpreadActive ? prematchDistView : null}
              sponsorBudgetFallback={sponsorBudgetFallbackScoreboard}
              cycleBudgetForever={sponsorRepeatBudgetCycles}
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
            (liveAutoBeside && sponsorDistView.phase === "scoreboard")) &&
          !(liveAutoHalftime && sponsorDistView.phase === "scoreboard") && (
            <MatchScoreboardFull
              key="match-board-full"
              match={match}
              elapsed={elapsed}
              running={state.timerRunning ?? false}
              period={period}
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
                key={`ht-sbr-${sponsorDistView.sponsorFilterId ?? "all"}`}
                sponsors={sponsors}
                section="halftime"
                sponsorIdFilter={sponsorDistView.sponsorFilterId}
                playbackTelemetry={sponsorPlaybackTelemetry}
                showPreviewProgress={embedInControl}
                fallback={halftimeSponsorFallback}
                cycleBudgetForever={sponsorRepeatBudgetCycles}
              />
            ) : (
              <SponsorRotationLiveContent
                match={match}
                playlists={playlists}
                sponsors={sponsors}
                showPreviewProgress={embedInControl}
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
              elapsed={elapsed}
              running={state.timerRunning ?? false}
              period={period}
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
              elapsed={elapsed}
              running={state.timerRunning ?? false}
              period={period}
              theme={scoreboardTheme}
            />
          )}

        {/* Fullscreen generic "GOAL" intro video, played while the
            operator is picking the scorer. */}
        {state && mode === "GOAL_INTRO_VIDEO" && (
          <SingleMediaMode
            key="goal-intro"
            media={activeMedia}
            loop
            fallback={<GoalIntroFallback />}
            showPreviewProgress={embedInControl}
          />
        )}

        {/* Fullscreen celebration video of the confirmed scorer. */}
        {state && mode === "GOAL_PLAYER_VIDEO" && activeMedia && (
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

      {state &&
        prematchMatchSponsorShow &&
        match?.matchSponsorMedia &&
        mode !== "BLACKOUT" && (
          <div className="absolute inset-0 z-[87] pointer-events-none" aria-hidden>
            <SingleMediaMode
              key={`prematch-ms-${match.matchSponsorMedia.id}`}
              media={match.matchSponsorMedia}
              loop={match.matchSponsorMedia.type === "VIDEO"}
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
      {state && match && liveAutoBeside && sponsorDistView.phase === "sponsor" && (
        <div className="absolute inset-0 z-[12]">
          <LeftScoreboardLayout
            match={match}
            elapsed={elapsed}
            running={state.timerRunning ?? false}
            period={period}
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
                {activeContent}
              </motion.div>
            </AnimatePresence>
          </LeftScoreboardLayout>
        </div>
      )}

      {/* Active-match modes: wrap content in the left-scoreboard layout */}
      {useLeftLayout && match && (
        <LeftScoreboardLayout
          match={match}
          elapsed={elapsed}
          running={state?.timerRunning ?? false}
          period={period}
          theme={scoreboardTheme}
        >
          <AnimatePresence mode="sync">{activeContent}</AnimatePresence>
        </LeftScoreboardLayout>
      )}

      {state?.externalCaptureToDisplay &&
        state.externalCaptureSourceId &&
        mode !== "BLACKOUT" && (
          <div className="absolute inset-0 z-[55] bg-black">
            <ExternalCaptureVideo sourceId={state.externalCaptureSourceId} />
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
  prematchSpread = null,
  sponsorBudgetFallback = null,
  cycleBudgetForever = false,
}: {
  match: Match | null;
  playlists: Record<PlaylistSlot, Playlist | null>;
  sponsors: Sponsor[];
  showPreviewProgress?: boolean;
  playbackTelemetry?: { matchId: string; matchStatus: string } | null;
  prematchSpread?: {
    phase: "scoreboard" | "sponsor";
    sponsorFilterId: string | null;
  } | null;
  sponsorBudgetFallback?: ReactNode;
  cycleBudgetForever?: boolean;
}) {
  if (!match) {
    return (
      <SponsorRotation
        playlist={playlists.IDLE}
        showPreviewProgress={showPreviewProgress}
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
          showPreviewProgress={showPreviewProgress}
          fallback={sponsorBudgetFallback ?? undefined}
          cycleBudgetForever={cycleBudgetForever}
        />
      );
    }
    return (
      <SponsorRotation
        playlist={playlists.PREMATCH ?? playlists.IDLE}
        showPreviewProgress={showPreviewProgress}
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
        showPreviewProgress={showPreviewProgress}
        fallback={sponsorBudgetFallback ?? undefined}
        cycleBudgetForever={cycleBudgetForever}
      />
    );
  }
  return (
    <SponsorRotation
      playlist={playlists.PREMATCH ?? playlists.IDLE}
      showPreviewProgress={showPreviewProgress}
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
    <div className="absolute inset-0 overflow-hidden bg-black">
      {media.type === "VIDEO" ? (
        <video
          ref={videoRef}
          src={mediaUrl(media.path)}
          autoPlay
          muted={!(media.playAudio ?? false)}
          playsInline
          loop={loop}
          style={DISPLAY_COVER_MEDIA_STYLE}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (d > 0 && Number.isFinite(d)) setVideoDurSec(d);
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
        />
      ) : (
        <img src={mediaUrl(media.path)} alt="" style={DISPLAY_COVER_MEDIA_STYLE} />
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

function humanPeriod(status?: string): string {
  switch (status) {
    case "FIRST_HALF":
      return "1ST HALF";
    case "SECOND_HALF":
      return "2ND HALF";
    case "HALF_TIME":
      return "HALF-TIME";
    case "FULL_TIME":
      return "FULL-TIME";
    case "EXTRA_TIME":
      return "EXTRA TIME";
    default:
      return "LIVE";
  }
}
