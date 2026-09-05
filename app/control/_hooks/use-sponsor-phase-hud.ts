"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import { useDisplayStore } from "@/lib/store";
import { tMatchStatus } from "@/lib/i18n/t-phase";
import { useLiveTimerSeconds } from "@/lib/use-timer";
import { useWallClockMs } from "@/lib/use-wall-clock-tick";
import type { Match, Playlist, PlaylistSlot, Sponsor, SponsorSection } from "@/lib/types";
import { filterMediaForSponsorSpreadSection } from "@/lib/sponsor-match-spread-media";
import { buildSponsorRotationMediaList } from "@/lib/sponsor-playback-order";
import {
  activeSponsorsForSection,
  buildSponsorSlotMap,
  halfWindowElapsed,
  sectionSpreadClock,
  holdSecondsCappedBySlotRun,
  lookupSponsorAtSecond,
  postmatchSpreadTimelineSeconds,
  prematchSpreadTimelineSeconds,
  prematchSpreadClock,
  resolveSponsorSpreadPhase,
  sponsorScreenSecondsConsumed,
  sponsorSectionBudgetSeconds,
} from "@/lib/sponsor-distribution";
import { computePrematchSpreadTiming } from "@/lib/prematch-spread-timing";
import { sponsorRepeatBudgetCyclesFromThemeJson } from "@/lib/scoreboard-theme";
import {
  ledgerActiveClipStillLiveForMatchSegment,
  sponsorTelemetryActiveClipElapsedSec,
  sponsorTelemetryConsumedSec,
  sponsorTelemetrySegmentKey,
} from "@/lib/sponsor-telemetry";
import {
  allActiveSponsorSectionBudgetsExhausted,
  hasSponsorsForSection,
  secondsUntilNextSponsorSlot,
  sectionForStatus,
  sponsorBesideShowsPanel,
  sponsorHalftimeShowsPanel,
  sponsorRotationBesideScoreboard,
} from "@/lib/sponsor-display-helpers";
import {
  createSponsorScheduleClock,
  sponsorScheduleTime,
  type SponsorScheduleClock,
} from "@/lib/sponsor-schedule-clock";
import { applySponsorSpreadTick } from "@/lib/sponsor-spread-tick";
import { useScheduledMediaCueActive } from "@/lib/use-scheduled-media-cue-active";

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
      hasLiveClip: boolean;
      sponsorClipProgress: number | null;
      nextSlotEtaSec: number | null;
      clipRemainingSec: number | null;
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

  /** Zelfde onderbrekings-set als `display/page.tsx` `sponsorInterrupted` (incl. geplande cue). */
  const sponsorInterrupted = useMemo(
    () =>
      activeScheduledCue != null ||
      mode === "GOAL" ||
      mode === "GOAL_INTRO_VIDEO" ||
      mode === "GOAL_PLAYER_VIDEO" ||
      mode === "SUBSTITUTION" ||
      mode === "CARD" ||
      mode === "HALFTIME" ||
      mode === "FULLTIME",
    [activeScheduledCue, mode],
  );

  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [playlists, setPlaylists] =
    useState<Record<PlaylistSlot, Playlist | null>>(EMPTY_PLAYLISTS);

  useEffect(() => {
    fetch("/api/sponsors")
      .then((r) => r.json())
      .then((list: Sponsor[]) => setSponsors(list ?? []))
      .catch(() => setSponsors([]));
  }, [state?.updatedAt]);

  /**
   * Detecteer of de display geconfigureerd is om sponsorbudgetten oneindig te herhalen.
   * Bepaalt of de HUD bij budget-uitputting "klaar" toont (rotatie stopte → scorebord)
   * of doorgaat met balk-visualisatie (oneindige cyclus).
   */
  const [cycleBudgetForever, setCycleBudgetForever] = useState(false);
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s: { scoreboardThemeJson?: string | null } | null) => {
        setCycleBudgetForever(
          sponsorRepeatBudgetCyclesFromThemeJson(s?.scoreboardThemeJson ?? null),
        );
      })
      .catch(() => setCycleBudgetForever(false));
  }, [state?.updatedAt]);

  useEffect(() => {
    fetch("/api/playlists")
      .then((r) => r.json())
      .then((list: Playlist[]) => {
        const map: Record<PlaylistSlot, Playlist | null> = { ...EMPTY_PLAYLISTS };
        for (const p of list) {
          map[p.slot as PlaylistSlot] = p;
        }
        setPlaylists(map);
      })
      .catch(() => setPlaylists(EMPTY_PLAYLISTS));
  }, [state?.updatedAt]);

  const sponsorBesideConfigured = useMemo(
    () =>
      !!match &&
      !!state &&
      sponsorRotationBesideScoreboard(match.status) &&
      sponsorBesideShowsPanel(match, sponsors, playlists),
    [match, state, sponsors, playlists],
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

  const matchTimerRunning = state?.timerRunning ?? false;
  const sponsorDistTickRef = useRef<{ key: string; value: { phase: "scoreboard" | "sponsor"; sponsorFilterId: string | null } } | null>(null);
  const prematchDistTickRef = useRef<{ key: string; value: { phase: "scoreboard" | "sponsor"; sponsorFilterId: string | null } } | null>(null);
  const postmatchDistTickRef = useRef<{ key: string; value: { phase: "scoreboard" | "sponsor"; sponsorFilterId: string | null } } | null>(null);

  const sponsorDistView = useMemo(() => {
    const tickKey = `${phaseTick}|${elapsed}|${mode}|${Number(matchTimerRunning)}|${Number(sponsorInterrupted)}|${match?.id}|${match?.status}`;
    return applySponsorSpreadTick(sponsorDistTickRef, tickKey, () => {
    const now = wallNowMs;

    if (sponsorBesideConfigured && match) {
      /** Zelfde regels als display: pauze/reset + sync bij late inschakeling. */
      const matchClockFrozen = !matchTimerRunning;
      const rotationActive = mode === "SPONSOR_ROTATION";
      const scheduleFrozen = !rotationActive || sponsorInterrupted || matchClockFrozen;
      const hangFrozen = sponsorInterrupted || matchClockFrozen;

      const tLive = halfWindowElapsed(elapsed, match.status, match.halfDurationSec);
      if (rotationActive) {
        tInterruptFrozen.current = tLive;
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
      return resolveSponsorSpreadPhase(v, sponsors, section, match.status, now, sponsorPhaseHangRef, {
        slotMap: sponsorSlotMapMatch,
        slotT: t,
        interrupted: hangFrozen,
      });
    }
    if (liveAutoHalftime && match && rustEpochRef.current != null) {
      const H = Math.max(60, match.halfBreakSec);
      const { t: rawT, timelineComplete } = sectionSpreadClock(
        (now - rustEpochRef.current) / 1000,
        H,
        cycleBudgetForever,
      );
      /** Zelfde regel als het display: rusttijd om ⇒ rooster klaar. */
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
      return resolveSponsorSpreadPhase(v, sponsors, "halftime", undefined, now, sponsorPhaseHangRef, {
        slotMap: sponsorSlotMapHalftime,
        slotT: t,
        interrupted: sponsorInterrupted,
      });
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
    wallNowMs,
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
    return resolveSponsorSpreadPhase(v, sponsors, "prematch", undefined, now, prematchPhaseHangRef, {
      slotMap: sponsorSlotMapPrematch,
      slotT: t,
      interrupted: sponsorInterrupted,
    });
    });
  }, [prematchSpreadActive, match, sponsorSlotMapPrematch, sponsors, phaseTick, wallNowMs, sponsorInterrupted]);

  const postmatchDistView = useMemo(() => {
    const tickKey = `${phaseTick}|${Number(postmatchSpreadActive)}|${Number(sponsorInterrupted)}|${match?.id}`;
    return applySponsorSpreadTick(postmatchDistTickRef, tickKey, () => {
    const now = wallNowMs;
    if (!postmatchSpreadActive || !match || postmatchEpochRef.current == null) {
      return { phase: "scoreboard" as const, sponsorFilterId: null as string | null };
    }
    const H = postmatchSpreadTimelineSeconds(sponsors);
    const { t: rawT, timelineComplete } = sectionSpreadClock(
      (now - postmatchEpochRef.current) / 1000,
      H,
      cycleBudgetForever,
    );
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
    return resolveSponsorSpreadPhase(v, sponsors, "postmatch", undefined, now, postmatchPhaseHangRef, {
      slotMap: sponsorSlotMapPostmatch,
      slotT: t,
      interrupted: sponsorInterrupted,
    });
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
  ]);

  return useMemo(() => {
    const now = wallNowMs;

    if (
      sponsorBesideConfigured &&
      match &&
      sponsorBesideShowsPanel(match, sponsors, playlists) &&
      !hasSponsorsForSection(sponsors, sectionForStatus(match.status), match.status)
    ) {
      return {
        kind: "playlist_only" as const,
        label: tUi("sponsors.playlistMatchHalf"),
      };
    }

    if (
      liveAutoHalftime &&
      match &&
      sponsorHalftimeShowsPanel(match, sponsors, playlists) &&
      !hasSponsorsForSection(sponsors, "halftime")
    ) {
      return {
        kind: "playlist_only" as const,
        label: tUi("sponsors.playlistHalftime"),
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
      if (!cycleBudgetForever && effectivePhase === "sponsor" && effectiveSponsorId) {
        const sponsor = sponsors.find((s) => s.id === effectiveSponsorId);
        if (sponsor) {
          const budget = sponsorSectionBudgetSeconds(sponsor, section, matchStatus);
          const consumedSlot = sponsorScreenSecondsConsumed(
            slotMap,
            sponsors,
            section,
            matchStatus,
            t,
            sponsor.id,
          );
          const consumedTelem =
            ledgerMatchesSegment && sponsorLedger
              ? sponsorTelemetryConsumedSec(sponsorLedger, sponsor.id, now)
              : consumedSlot;
          const consumed = Math.max(consumedSlot, consumedTelem);
          if (budget > 0 && consumed >= budget) {
            effectivePhase = "scoreboard";
            effectiveSponsorId = null;
            hangRef.current = null;
          }
        }
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
      const media =
        resolveSponsorMedia(sponsors, liveClip?.mediaId ?? null) ??
        plannedMediaForSponsor(
          sponsors.find((s) => s.id === effectiveSponsorId) ?? null,
          section,
          matchStatus,
        );

      let sponsorClipProgress: number | null = null;
      let clipRemainingSec: number | null = null;
      let nextSlotEtaSec: number | null = null;

      if (ledgerMatchesSegment && match) {
        const acLive = ledgerActiveClipStillLiveForMatchSegment(match, section, sponsorLedger!, now);
        if (effectivePhase === "sponsor" && acLive) {
          const elapsedSec = sponsorTelemetryActiveClipElapsedSec(acLive, now);
          const totalSec = Math.max(0.1, acLive.expectedPlaySec || 0.1);
          sponsorClipProgress = Math.min(1, elapsedSec / totalSec);
          clipRemainingSec = Math.max(0, totalSec - elapsedSec);
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
        hasLiveClip: liveClip != null,
        sponsorClipProgress,
        nextSlotEtaSec,
        clipRemainingSec,
        prematchWindowOpensInSec: null,
        prematchTimelineComplete: false,
      };
    }

    if (sponsorBesideConfigured && match && hasSponsorsForSection(sponsors, sectionForStatus(match.status), match.status)) {
      const tLive = halfWindowElapsed(elapsed, match.status, match.halfDurationSec);
      const t = mode === "SPONSOR_ROTATION" ? tLive : tInterruptFrozen.current;
      const section = sectionForStatus(match.status);
      return rosterFrom(
        tMatchStatus(tUi, match.status),
        section,
        match.status,
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
      hasSponsorsForSection(sponsors, "halftime")
    ) {
      const H = Math.max(60, match.halfBreakSec);
      const tUnbounded = (now - rustEpochRef.current) / 1000;
      const t = tUnbounded % H;
      const tNextEta = Math.min(tUnbounded, Math.max(0, H - 1e-6));
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

    if (postmatchSpreadActive && match && hasSponsorsForSection(sponsors, "postmatch")) {
      const H = postmatchSpreadTimelineSeconds(sponsors);
      const tUnbounded =
        postmatchEpochRef.current != null ? (now - postmatchEpochRef.current) / 1000 : 0;
      const t = Math.min(tUnbounded, Math.max(0, H - 1e-6));
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
      hasSponsorsForSection(sponsors, "prematch")
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
      const t = timing.elapsedSec;
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
  ]);
}

function mediaLabel(title: string, path: string): { title: string; fileName: string } {
  const fileName = path.split(/[/\\]/).pop() || title;
  return { title: title || fileName, fileName };
}

function resolveSponsorMedia(
  sponsors: Sponsor[],
  mediaId: string | null,
): { title: string; fileName: string } | null {
  if (!mediaId) return null;
  for (const sponsor of sponsors) {
    const item = sponsor.media?.find((m) => m.id === mediaId);
    if (!item) continue;
    return mediaLabel(item.title, item.path);
  }
  return null;
}

function plannedMediaForSponsor(
  sponsor: Sponsor | null,
  section: SponsorSection,
  matchStatus?: string,
): { title: string; fileName: string } | null {
  if (!sponsor) return null;
  const active = (sponsor.media ?? []).filter((m) => m.active);
  const list = buildSponsorRotationMediaList(
    filterMediaForSponsorSpreadSection(active, section, matchStatus),
    sponsor.sponsorPlaybackOrderJson,
    sponsor.sponsorPlaybackRepeatsJson,
  );
  const item = list[0];
  if (!item) return null;
  return mediaLabel(item.title, item.path);
}
