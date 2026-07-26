"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useDisplayStore } from "@/lib/store";
import { useLiveTimerSeconds } from "@/lib/use-timer";
import { useWallClockMs } from "@/lib/use-wall-clock-tick";
import type { Match, Playlist, PlaylistSlot, Sponsor, SponsorSection } from "@/lib/types";
import {
  activeSponsorsForSection,
  buildSponsorSlotMap,
  halfWindowElapsed,
  holdSecondsCappedBySlotRun,
  lookupSponsorAtSecond,
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
import { sponsorScheduleTime, type SponsorScheduleClock } from "@/lib/sponsor-schedule-clock";
import { useScheduledMediaCueActive } from "@/lib/use-scheduled-media-cue-active";

export type SponsorPhaseHudModel =
  | { kind: "inactive" }
  | { kind: "playlist_only"; label: string }
  | {
      kind: "roster";
      contextLabel: string;
      phase: "scoreboard" | "sponsor";
      sponsorName: string | null;
      sponsorClipProgress: number | null;
      nextSlotEtaSec: number | null;
      clipRemainingSec: number | null;
    };

const EMPTY_PLAYLISTS: Record<PlaylistSlot, Playlist | null> = {
  IDLE: null,
  PREMATCH: null,
  HALFTIME: null,
  POSTMATCH: null,
  GOAL: null,
};

export function useSponsorPhaseHud(match: Match | null): SponsorPhaseHudModel {
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
    if (!sponsorBesideConfigured && !liveAutoHalftime && !prematchSpreadActive) return;
    const id = setInterval(() => setPhaseTick((n) => n + 1), 400);
    return () => clearInterval(id);
  }, [sponsorBesideConfigured, liveAutoHalftime, prematchSpreadActive]);

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

  const tInterruptFrozen = useRef(0);
  const sponsorPhaseHangRef = useRef<{
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
  const sponsorScheduleClockRef = useRef<SponsorScheduleClock>({
    key: "",
    adjustedT: 0,
    lastRawT: 0,
    initialized: false,
    wasFrozen: false,
  });
  const halftimeScheduleClockRef = useRef<SponsorScheduleClock>({
    key: "",
    adjustedT: 0,
    lastRawT: 0,
    initialized: false,
    wasFrozen: false,
  });
  const prematchScheduleClockRef = useRef<SponsorScheduleClock>({
    key: "",
    adjustedT: 0,
    lastRawT: 0,
    initialized: false,
    wasFrozen: false,
  });

  useEffect(() => {
    sponsorPhaseHangRef.current = null;
    prematchPhaseHangRef.current = null;
    prematchOriginRef.current = null;
    sponsorScheduleClockRef.current.initialized = false;
    halftimeScheduleClockRef.current.initialized = false;
    prematchScheduleClockRef.current.initialized = false;
  }, [match?.id]);

  useEffect(() => {
    sponsorPhaseHangRef.current = null;
    sponsorScheduleClockRef.current.initialized = false;
    halftimeScheduleClockRef.current.initialized = false;
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

  const sponsorDistView = useMemo(() => {
    const now = wallNowMs;

    if (sponsorBesideConfigured && match) {
      const tLive = halfWindowElapsed(elapsed, match.status, match.halfDurationSec);
      if (mode === "SPONSOR_ROTATION") {
        tInterruptFrozen.current = tLive;
      }
      const t = sponsorScheduleTime(
        sponsorScheduleClockRef,
        `${match.id}:${match.status}:match`,
        mode === "SPONSOR_ROTATION" ? tLive : tInterruptFrozen.current,
        mode !== "SPONSOR_ROTATION" || sponsorInterrupted,
        Math.max(60, match.halfDurationSec),
      );
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
      const rawT = ((now - rustEpochRef.current) / 1000) % H;
      const t = sponsorScheduleTime(
        halftimeScheduleClockRef,
        `${match.id}:${match.status}:halftime`,
        rawT,
        sponsorInterrupted,
        H,
      );
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
    wallNowMs,
  ]);

  const prematchDistView = useMemo(() => {
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
    const v = lookupSponsorAtSecond(sponsorSlotMapPrematch, t);
    return resolveSponsorSpreadPhase(v, sponsors, "prematch", undefined, now, prematchPhaseHangRef, {
      slotMap: sponsorSlotMapPrematch,
      slotT: t,
      interrupted: sponsorInterrupted,
    });
  }, [prematchSpreadActive, match, sponsorSlotMapPrematch, sponsors, phaseTick, wallNowMs, sponsorInterrupted]);

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
        label: "Speelhelft: sponsorronde draait op playlist (geen budget-rooster om te tonen).",
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
        label: "Rust: sponsorronde draait op playlist (geen budget-rooster om te tonen).",
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
        const ac = sponsorLedger!.activeClip;
        if (ac) {
          if (!acLive) {
            effectivePhase = "scoreboard";
            effectiveSponsorId = null;
          } else {
            /**
             * Actieve clip op het scherm (display → ledger). Overschrijft het slot-rooster
             * zolang de clip loopt; budget-check hieronder kan alsnog naar scorebord als
             * het schermquotum op is (zelfde bron als "Sponsors live · gemeten op scherm").
             */
            effectivePhase = "sponsor";
            effectiveSponsorId = ac.sponsorId;
          }
        } else {
          effectivePhase = "scoreboard";
          effectiveSponsorId = null;
          hangRef.current = null;
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
        sponsorClipProgress,
        nextSlotEtaSec,
        clipRemainingSec,
      };
    }

    if (sponsorBesideConfigured && match && hasSponsorsForSection(sponsors, sectionForStatus(match.status), match.status)) {
      const tLive = halfWindowElapsed(elapsed, match.status, match.halfDurationSec);
      const t = mode === "SPONSOR_ROTATION" ? tLive : tInterruptFrozen.current;
      const section = sectionForStatus(match.status);
      const label =
        match.status === "FIRST_HALF"
          ? "1e helft"
          : match.status === "SECOND_HALF"
            ? "2e helft"
            : "Verlenging";
      return rosterFrom(
        label,
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
        "Rust",
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
      const t = timing.elapsedSec;
      const tNextEta = timing.timelineComplete ? H - 1 : Math.min(t, Math.max(0, H - 1e-6));
      return rosterFrom(
        "Voor wedstrijd",
        "prematch",
        undefined,
        match ? sponsorTelemetrySegmentKey(match.id, match.status, "prematch") : null,
        prematchDistView,
        sponsorSlotMapPrematch,
        t,
        prematchPhaseHangRef,
        tNextEta,
      );
    }

    return { kind: "inactive" as const };
  }, [
    sponsorBesideConfigured,
    liveAutoHalftime,
    prematchSpreadActive,
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
  ]);
}
