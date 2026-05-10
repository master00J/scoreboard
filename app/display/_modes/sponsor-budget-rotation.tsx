"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { DISPLAY_COVER_MEDIA_STYLE } from "@/lib/display-cover-media-style";
import type { MediaItem, Sponsor, SponsorSection } from "@/lib/types";
import type { DisplayMediaDiagnosticPayload } from "@/lib/desktop-bridge";
import { matchPlayBudgetSeconds } from "@/lib/sponsor-distribution";
import { sponsorTelemetrySegmentKey } from "@/lib/sponsor-telemetry";
import { reportSponsorClipEnd, reportSponsorClipStart } from "@/lib/use-socket";
import { releaseHtmlVideoElement } from "@/lib/html-video-release";
import { mediaUrl } from "@/lib/media-url";
import { reportDisplayPlaybackToMain } from "@/lib/report-display-playback";
import {
  reportDisplayMediaDiagnostic,
  videoElementDiagnosticFields,
} from "@/lib/report-display-media-diagnostic";
import { filterMediaForSponsorSpreadSection } from "@/lib/sponsor-match-spread-media";
import { mediaAllowedForSponsorPhase } from "@/lib/sponsor-media-phases";
import { buildSponsorRotationMediaList } from "@/lib/sponsor-playback-order";
import {
  PreviewSlideProgressBar,
  useTimedSlideProgress,
} from "../_components/preview-slide-progress";
import { sponsorTelemetryActiveClipElapsedSec } from "@/lib/sponsor-telemetry";

type Plan = {
  sponsorId: string;
  mediaId: string;
  item: MediaItem;
  /** Index in de actieve media-lijst van deze sponsor; pas na afloop clip wordt de cursor verhoogd (Strict Mode-safe). */
  mediaIndex: number;
  /** Schatting voor telemetry / voorbeeldbalk; video gebruikt echte eindtijd waar mogelijk. */
  playSec: number;
};

const SPONSOR_VIDEO_FAULT_PAUSE_MS = 20_000;
const SPONSOR_MEDIA_FAULT_COOLDOWN_MS = 5 * 60_000;
const SPONSOR_CROSS_SPONSOR_VIDEO_RELEASE_MS = 1_200;
const sponsorBudgetPlaybackOwners = new Map<string, string>();
let sponsorBudgetPlaybackOwnerSeq = 0;

function estimatePlaySec(item: MediaItem, sponsor: Sponsor): number {
  if (item.type === "VIDEO") {
    return Math.max(3, item.durationSec > 0 ? item.durationSec : 30);
  }
  return Math.max(
    1,
    item.durationSec > 0 ? item.durationSec : sponsor.imageDefaultSec || 10,
  );
}

/**
 * Voorkomt dat een corrupte / extreem lange container-`duration` het sponsor-budget
 * in één keer leegtrekt (`spentPerSponsor` schiet omhoog → geen eligible sponsors meer).
 */
function capBilledSecondsForSponsorBudget(
  item: MediaItem,
  scheduledPlaySec: number,
  rawSeconds: number,
): number {
  const raw = Math.max(0, rawSeconds);
  const catalogBase =
    item.durationSec > 0
      ? item.durationSec
      : item.type === "VIDEO"
        ? Math.max(8, scheduledPlaySec)
        : scheduledPlaySec;
  const basis = Math.max(catalogBase, scheduledPlaySec, 8);
  const ceiling = Math.min(30 * 60, Math.max(45, basis * 8 + 180));
  return Math.min(raw, ceiling);
}

/**
 * Sponsorroulering met budget per sectie (prematch / wedstrijd / rust).
 *
 * - Budget (seconden) = gewenste schermtijd in die sectie (minimum; clips lopen altijd uit).
 * - Per clip: sponsor met laagste gebruiksgraad (spent/budget) eerst;
 *   bij gelijke stand round-robin zodat niet steeds dezelfde sponsor wint.
 * - Afbeelding: duur via timer. Video: doorspelen tot `ended`, met fallback-timeout.
 * - Verbruik (spent) wordt pas bij het einde van de clip bijgeschreven (werkelijke videolengte).
 * - Als elke actieve sponsor zijn budget gehaald heeft: rotatie stopt, tenzij `cycleBudgetForever`
 *   (nieuwe ronde / doorlopende loop tot de fase wisselt).
 * - Optioneel `fallback` wanneer budget op is en niet opnieuw wordt gestart (typisch scorebord).
 */
export function SponsorBudgetRotation({
  sponsors,
  section,
  matchStatus,
  sponsorIdFilter,
  playbackTelemetry = null,
  followPlayback = false,
  followClip = null,
  mediaObjectFit = "cover",
  showPreviewProgress = false,
  renderVideo = true,
  fallback = null,
  cycleBudgetForever = false,
  paused = false,
}: {
  sponsors: Sponsor[];
  section: SponsorSection;
  matchStatus?: string;
  sponsorIdFilter?: string | null;
  playbackTelemetry?: { matchId: string; matchStatus: string } | null;
  /** Embedded control-preview: volg alleen de ledger, nooit een eigen rotatie (die mist verbruikte budget-ticks). */
  followPlayback?: boolean;
  /** Preview volgt exact de actieve clip van het hoofdscherm (via sponsor-ledger). */
  followClip?: {
    sponsorId: string;
    mediaId: string;
    startedAtMs: number;
    expectedPlaySec: number;
    playbackPositionMs?: number;
    paused?: boolean;
  } | null;
  mediaObjectFit?: "cover" | "contain";
  showPreviewProgress?: boolean;
  /** Voor embedded control-preview: toon context/voortgang zonder extra video-decoder. */
  renderVideo?: boolean;
  /** Getoond nadat minstens één clip is gespeeld en er geen budget meer over is. */
  fallback?: ReactNode;
  /** Zet spent terug naar nul zodra iedereen zijn quotum haalde — oneindige cyclus binnen de fase. */
  cycleBudgetForever?: boolean;
  /** Tijdelijk pauzeren zonder current clip te vergeten, bv. tijdens goal/wissel-overlay. */
  paused?: boolean;
}) {
  const followMode = followPlayback;
  const ownerIdRef = useRef<string>("");
  if (!ownerIdRef.current) {
    sponsorBudgetPlaybackOwnerSeq += 1;
    ownerIdRef.current = `sbr-${sponsorBudgetPlaybackOwnerSeq}`;
  }
  const playbackOwnerKey =
    !followMode && playbackTelemetry
      ? `${playbackTelemetry.matchId}:${section}`
      : null;
  const [isPlaybackOwner, setIsPlaybackOwner] = useState(playbackOwnerKey == null);

  useEffect(() => {
    const ownerId = ownerIdRef.current;
    if (!playbackOwnerKey) {
      setIsPlaybackOwner(true);
      return;
    }

    const claimIfAvailable = () => {
      const currentOwner = sponsorBudgetPlaybackOwners.get(playbackOwnerKey);
      if (!currentOwner) {
        sponsorBudgetPlaybackOwners.set(playbackOwnerKey, ownerId);
        setIsPlaybackOwner(true);
        return;
      }
      setIsPlaybackOwner(currentOwner === ownerId);
    };

    claimIfAvailable();
    const id = window.setInterval(claimIfAvailable, 750);
    return () => {
      window.clearInterval(id);
      if (sponsorBudgetPlaybackOwners.get(playbackOwnerKey) === ownerId) {
        sponsorBudgetPlaybackOwners.delete(playbackOwnerKey);
      }
    };
  }, [playbackOwnerKey]);

  const rotationMediaForSponsor = useCallback(
    (sponsor: Sponsor) =>
      buildSponsorRotationMediaList(
        filterMediaForSponsorSpreadSection(
          (sponsor.media ?? []).filter((m) => m.active),
          section,
          matchStatus,
        ),
        sponsor.sponsorPlaybackOrderJson,
        sponsor.sponsorPlaybackRepeatsJson,
      ),
    [section, matchStatus],
  );
  const activeSponsors = useMemo(() => {
    let list = sponsors.filter((s) => {
      const sectionMedia = rotationMediaForSponsor(s);
      return (
        s.active &&
        budgetFor(s, section, matchStatus) > 0 &&
        sectionMedia.length > 0
      );
    });
    /**
     * Alleen control-ingestie: ledger = bron van waarheid. Bij preview moet dezelfde
     * volgorde/fase-filter gebruikt worden als op het stadionscherm.
     */
    if (followMode && followClip) {
      const s = sponsors.find((x) => x.id === followClip.sponsorId);
      if (s?.active && !list.some((x) => x.id === s.id)) {
        const hasPhaseMedia = (s.media ?? []).some(
          (m) => m.active && mediaAllowedForSponsorPhase(m, section, matchStatus),
        );
        if (hasPhaseMedia) list = [...list, s];
      }
    }
    if (sponsorIdFilter) {
      list = list.filter((s) => s.id === sponsorIdFilter);
    }
    return list;
  }, [sponsors, section, matchStatus, sponsorIdFilter, followMode, followClip?.sponsorId, rotationMediaForSponsor]);

  const [cycleId, setCycleId] = useState(0);
  const [slideTick, setSlideTick] = useState(0);
  const [current, setCurrent] = useState<Plan | null>(null);
  const [videoProgressDurationMs, setVideoProgressDurationMs] = useState(0);
  const [videoFaultPauseUntilMs, setVideoFaultPauseUntilMs] = useState(0);
  const playbackProgressMsRef = useRef(0);

  const stateRef = useRef<{
    mediaCursor: Record<string, number>;
    passMediaIds: Record<string, string[]>;
    spentPerSponsor: Record<string, number>;
  }>({
    mediaCursor: {},
    passMediaIds: {},
    spentPerSponsor: {},
  });
  const tieBreakCursorRef = useRef(0);
  const videoCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const earlyEndedCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sponsorSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoFaultBurstRef = useRef<number[]>([]);
  const videoFaultCooldownUntilRef = useRef(0);
  const mediaFaultCooldownUntilRef = useRef<Record<string, number>>({});
  const lastVideoFaultAdvanceAtRef = useRef(0);
  const playedClipRef = useRef(false);
  const finishedClipKeyRef = useRef<string | null>(null);
  const clipSessionRef = useRef<{ key: string; id: string } | null>(null);
  const completedScheduledSponsorSlotRef = useRef<string | null>(null);
  const [sponsorSwitchReleaseUntilMs, setSponsorSwitchReleaseUntilMs] = useState(0);
  const telemetryClipRef = useRef<{
    key: string;
    matchId: string;
    segmentKey: string;
    sponsorId: string;
    mediaId: string;
    clipSessionId: string;
    startedAtMs: number;
    ended: boolean;
  } | null>(null);
  const lastPausedTelemetryRef = useRef<boolean | null>(null);

  const sponsorsById = useMemo(() => {
    const m: Record<string, Sponsor> = {};
    for (const s of sponsors) m[s.id] = s;
    return m;
  }, [sponsors]);

  /**
   * Reset alleen wanneer de fase of de actieve sponsor-set wijzigt.
   * Budget/media-wijzigingen tijdens een fase mogen het reeds verbruikte budget
   * niet wissen; anders krijgt een sponsor na een tijdswijziging onterecht een
   * nieuwe volledige cyclus.
   */
  const phaseSponsorSignature = useMemo(
    () =>
      sponsors
        .filter((s) => {
          const sectionMedia = rotationMediaForSponsor(s);
          return (
            s.active &&
            budgetFor(s, section, matchStatus) > 0 &&
            sectionMedia.length > 0
          );
        })
        .map((s) => s.id)
        .sort()
        .join("|"),
    [sponsors, section, matchStatus, rotationMediaForSponsor],
  );

  useEffect(() => {
    stateRef.current = {
      mediaCursor: {},
      passMediaIds: {},
      spentPerSponsor: {},
    };
    tieBreakCursorRef.current = 0;
    playedClipRef.current = false;
    clipSessionRef.current = null;
    telemetryClipRef.current = null;
    completedScheduledSponsorSlotRef.current = null;
    lastPausedTelemetryRef.current = null;
    setCycleId((c) => c + 1);
    setSlideTick(0);
    setCurrent(null);
    setVideoProgressDurationMs(0);
    setVideoFaultPauseUntilMs(0);
    setSponsorSwitchReleaseUntilMs(0);
    playbackProgressMsRef.current = 0;
    if (sponsorSwitchTimerRef.current != null) {
      clearTimeout(sponsorSwitchTimerRef.current);
      sponsorSwitchTimerRef.current = null;
    }
  }, [section, phaseSponsorSignature]);

  useEffect(() => {
    completedScheduledSponsorSlotRef.current = null;
  }, [sponsorIdFilter]);

  const budgetFn = useCallback(
    (s: Sponsor) => budgetFor(s, section, matchStatus),
    [section, matchStatus],
  );

  const availableMediaForSponsor = useCallback(
    (sponsor: Sponsor, now: number) => {
      const cooldowns = mediaFaultCooldownUntilRef.current;
      return rotationMediaForSponsor(sponsor).filter((m) => (cooldowns[m.id] ?? 0) <= now);
    },
    [rotationMediaForSponsor],
  );

  const planForSponsorMediaList = useCallback(
    (sponsor: Sponsor, mediaIndex: number, media: MediaItem[]): Plan | null => {
      if (media.length === 0) return null;
      const mi = mediaIndex % media.length;
      const item = media[mi]!;
      return {
        sponsorId: sponsor.id,
        mediaId: item.id,
        item,
        mediaIndex,
        playSec: estimatePlaySec(item, sponsor),
      };
    },
    [],
  );

  const mediaFromPassIds = useCallback(
    (sponsor: Sponsor, ids: string[]): MediaItem[] => {
      if (ids.length === 0) return [];
      const byId = new Map(rotationMediaForSponsor(sponsor).map((m) => [m.id, m]));
      return ids.map((id) => byId.get(id)).filter((m): m is MediaItem => m != null);
    },
    [rotationMediaForSponsor],
  );

  const passMediaForSponsor = useCallback(
    (sponsor: Sponsor, mediaIndex: number, _now: number): MediaItem[] => {
      const st = stateRef.current;
      const existingIds = st.passMediaIds[sponsor.id] ?? [];
      const existingMedia = mediaFromPassIds(sponsor, existingIds);
      if (existingMedia.length > 0 && mediaIndex % existingMedia.length !== 0) {
        return existingMedia;
      }

      const pass = rotationMediaForSponsor(sponsor);
      st.passMediaIds[sponsor.id] = pass.map((m) => m.id);
      return pass;
    },
    [mediaFromPassIds, rotationMediaForSponsor],
  );

  const planForSponsor = useCallback(
    (sponsor: Sponsor, mediaIndex: number, now: number): Plan | null => {
      const media = passMediaForSponsor(sponsor, mediaIndex, now);
      return planForSponsorMediaList(sponsor, mediaIndex, media);
    },
    [passMediaForSponsor, planForSponsorMediaList],
  );

  const pickNext = useCallback((): Plan | null => {
    const st = stateRef.current;
    const now = Date.now();

    const scheduledSponsorMode = sponsorIdFilter != null;
    if (sponsorIdFilter && completedScheduledSponsorSlotRef.current === sponsorIdFilter) {
      return null;
    }
    /** Altijd op resterend budget filteren — ook bij `sponsorIdFilter` (prematch-/slot-spread),
     *  anders blijft dezelfde sponsor oneindig roteren na opgebruikt prematch-/segmentbudget. */
    let eligibleAll = activeSponsors.filter((s) => {
      if ((st.spentPerSponsor[s.id] ?? 0) >= budgetFn(s)) return false;
      return availableMediaForSponsor(s, now).length > 0;
    });
    if (eligibleAll.length === 0) {
      eligibleAll = activeSponsors.filter((s) => {
        const media = availableMediaForSponsor(s, now);
        if (media.length === 0) return false;
        return (st.mediaCursor[s.id] ?? 0) < media.length;
      });
    }
    if (!scheduledSponsorMode && eligibleAll.length === 0 && cycleBudgetForever) {
      st.spentPerSponsor = {};
      eligibleAll = activeSponsors.filter((s) => {
        if ((st.spentPerSponsor[s.id] ?? 0) >= budgetFn(s)) return false;
        return availableMediaForSponsor(s, now).length > 0;
      });
    }
    if (eligibleAll.length === 0) return null;

    eligibleAll.sort((a, b) => {
      const ba = Math.max(1, budgetFn(a));
      const bb = Math.max(1, budgetFn(b));
      const ua = (st.spentPerSponsor[a.id] ?? 0) / ba;
      const ub = (st.spentPerSponsor[b.id] ?? 0) / bb;
      if (Math.abs(ua - ub) > 1e-9) return ua - ub;
      return activeSponsors.indexOf(a) - activeSponsors.indexOf(b);
    });

    const minU =
      (st.spentPerSponsor[eligibleAll[0]!.id] ?? 0) /
      Math.max(1, budgetFn(eligibleAll[0]!));
    const tied = eligibleAll.filter((s) => {
      const u = (st.spentPerSponsor[s.id] ?? 0) / Math.max(1, budgetFn(s));
      return Math.abs(u - minU) <= 1e-9;
    });
    tied.sort(
      (a, b) => activeSponsors.indexOf(a) - activeSponsors.indexOf(b),
    );

    const idx = tieBreakCursorRef.current % tied.length;
    const sponsor = tied[idx]!;

    return planForSponsor(sponsor, st.mediaCursor[sponsor.id] ?? 0, now);
  }, [activeSponsors, availableMediaForSponsor, budgetFn, cycleBudgetForever, sponsorIdFilter, planForSponsor]);

  const finishTelemetryClip = useCallback((actualSec: number, opts?: { discard?: boolean; reason?: string }) => {
    const clip = telemetryClipRef.current;
    if (!clip || clip.ended) return;
    clip.ended = true;
    void reportSponsorClipEnd({
      matchId: clip.matchId,
      segmentKey: clip.segmentKey,
      sponsorId: clip.sponsorId,
      mediaId: clip.mediaId,
      clipSessionId: clip.clipSessionId,
      startedAtMs: clip.startedAtMs,
      actualSec,
      discard: opts?.discard,
      reason: opts?.reason,
    });
  }, []);

  const advanceAfterSlide = useCallback(
    (
      sponsorId: string,
      mediaIndex: number,
      seconds: number,
      _previousItemType: MediaItem["type"],
    ) => {
      if (videoFallbackTimerRef.current != null) {
        clearTimeout(videoFallbackTimerRef.current);
        videoFallbackTimerRef.current = null;
      }
      if (videoCommitTimerRef.current != null) {
        clearTimeout(videoCommitTimerRef.current);
        videoCommitTimerRef.current = null;
      }
      if (earlyEndedCommitTimerRef.current != null) {
        clearTimeout(earlyEndedCommitTimerRef.current);
        earlyEndedCommitTimerRef.current = null;
      }
      finishTelemetryClip(seconds);
      const st = stateRef.current;
      st.mediaCursor[sponsorId] = mediaIndex + 1;
      tieBreakCursorRef.current++;
      const prev = st.spentPerSponsor[sponsorId] ?? 0;
      st.spentPerSponsor[sponsorId] = prev + Math.max(0, seconds);

      const now = Date.now();
      /**
       * De scheduler-filter (`sponsorIdFilter`) mag de lopende sponsor niet afkappen.
       * Als Matchsponsor 4 actieve clips heeft, speel die lijst eerst uit voordat
       * een nieuw scheduler-slot naar een andere sponsor mag springen.
       */
      const sameSponsor = sponsorsById[sponsorId];
      const sameSponsorMedia = sameSponsor ? passMediaForSponsor(sameSponsor, st.mediaCursor[sponsorId] ?? 0, now) : [];
      const sameSponsorCursor = st.mediaCursor[sponsorId] ?? 0;
      const sameSponsorHasMoreInPass =
        sameSponsorMedia.length > 0 && sameSponsorCursor % sameSponsorMedia.length !== 0;
      const sameSponsorNext =
        sameSponsor && sameSponsorHasMoreInPass
          ? planForSponsorMediaList(sameSponsor, sameSponsorCursor, sameSponsorMedia)
          : null;
      if (!sameSponsorNext && sponsorIdFilter === sponsorId) {
        completedScheduledSponsorSlotRef.current = sponsorId;
      }
      const next = sameSponsorNext ?? pickNext();
      setVideoProgressDurationMs(0);
      playbackProgressMsRef.current = 0;
      if (next) {
        const crossSponsorVideoSwitch =
          sponsorId !== next.sponsorId &&
          _previousItemType === "VIDEO" &&
          next.item.type === "VIDEO";
        if (crossSponsorVideoSwitch) {
          if (sponsorSwitchTimerRef.current != null) {
            clearTimeout(sponsorSwitchTimerRef.current);
            sponsorSwitchTimerRef.current = null;
          }
          const until = Date.now() + SPONSOR_CROSS_SPONSOR_VIDEO_RELEASE_MS;
          setSponsorSwitchReleaseUntilMs(until);
          setCurrent(null);
          sponsorSwitchTimerRef.current = window.setTimeout(() => {
            sponsorSwitchTimerRef.current = null;
            setSponsorSwitchReleaseUntilMs(0);
            setCurrent(next);
            setSlideTick((t) => t + 1);
          }, SPONSOR_CROSS_SPONSOR_VIDEO_RELEASE_MS);
          return;
        }
        setCurrent(next);
        setSlideTick((t) => t + 1);
      } else {
        setCurrent(null);
      }
    },
    [
      finishTelemetryClip,
      passMediaForSponsor,
      pickNext,
      planForSponsorMediaList,
      sponsorIdFilter,
      sponsorsById,
    ],
  );

  const finishClipOnce = useCallback(
    (plan: Plan, seconds: number) => {
      const key = `${plan.sponsorId}-${plan.mediaId}-${cycleId}-${slideTick}`;
      if (finishedClipKeyRef.current === key) return;
      finishedClipKeyRef.current = key;
      advanceAfterSlide(
        plan.sponsorId,
        plan.mediaIndex,
        capBilledSecondsForSponsorBudget(plan.item, plan.playSec, seconds),
        plan.item.type,
      );
    },
    [advanceAfterSlide, cycleId, slideTick],
  );

  function stableClipSessionId(segmentKey: string, plan: Plan) {
    const key = `${playbackTelemetry?.matchId ?? "match"}-${segmentKey}-${cycleId}-${slideTick}-${plan.sponsorId}-${plan.mediaId}`;
    if (clipSessionRef.current?.key !== key) {
      clipSessionRef.current = {
        key,
        id: `${key}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };
    }
    return clipSessionRef.current.id;
  }

  useEffect(() => {
    finishedClipKeyRef.current = null;
  }, [current?.sponsorId, current?.mediaId, cycleId, slideTick]);

  useEffect(() => {
    if (videoFaultPauseUntilMs <= Date.now()) return;
    const id = window.setTimeout(
      () => setVideoFaultPauseUntilMs(0),
      Math.max(250, videoFaultPauseUntilMs - Date.now()),
    );
    return () => window.clearTimeout(id);
  }, [videoFaultPauseUntilMs]);

  useEffect(() => {
    return () => {
      if (sponsorSwitchTimerRef.current != null) {
        clearTimeout(sponsorSwitchTimerRef.current);
        sponsorSwitchTimerRef.current = null;
      }
      if (videoCommitTimerRef.current != null) {
        clearTimeout(videoCommitTimerRef.current);
        videoCommitTimerRef.current = null;
      }
      if (earlyEndedCommitTimerRef.current != null) {
        clearTimeout(earlyEndedCommitTimerRef.current);
        earlyEndedCommitTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (followMode) return;
    if (!isPlaybackOwner) return;
    if (activeSponsors.length === 0) return;
    if (videoFaultPauseUntilMs > Date.now()) return;
    if (sponsorSwitchReleaseUntilMs > Date.now()) return;

    if (!current) {
      const next = pickNext();
      if (next) {
        setCurrent(next);
        setSlideTick((t) => t + 1);
      }
    }
  }, [activeSponsors.length, current, pickNext, cycleId, followMode, isPlaybackOwner, videoFaultPauseUntilMs, sponsorSwitchReleaseUntilMs]);

  useEffect(() => {
    if (followMode) return;
    if (!isPlaybackOwner) return;
    if (paused) return;
    if (!current || activeSponsors.length === 0) return;

    if (current.item.type === "VIDEO") {
      const catalogSec = Math.max(0.5, current.playSec);
      const browserSec =
        videoProgressDurationMs > 0 ? videoProgressDurationMs / 1000 : 0;
      /**
       * Sommige MP4's melden een container-duur die veel langer is dan de echte spot
       * (of dan de catalogus). Dan bleef `maybeFireEarlyEnd` wachten op currentTime
       * richting uren, en werd de fallback-timer tot 15 min gezet — voelt als vastlopen.
       */
      const durationBasisSec =
        browserSec > 0 && browserSec <= Math.max(600, catalogSec * 5 + 120)
          ? browserSec
          : catalogSec;
      const expectedMs = Math.max(5_000, durationBasisSec * 1000);
      const fallbackMs = Math.min(
        900_000,
        Math.max(8_000, expectedMs + 20_000),
      );
      videoCommitTimerRef.current = setTimeout(() => {
        videoCommitTimerRef.current = null;
        finishClipOnce(
          current,
          capBilledSecondsForSponsorBudget(current.item, current.playSec, current.playSec),
        );
      }, Math.max(1_500, catalogSec * 1000));
      videoFallbackTimerRef.current = setTimeout(() => {
        videoFallbackTimerRef.current = null;
        const progressed = playbackProgressMsRef.current / 1000;
        const sec = Math.max(
          catalogSec,
          progressed > 0.25 ? progressed : durationBasisSec,
        );
        finishClipOnce(
          current,
          capBilledSecondsForSponsorBudget(current.item, current.playSec, sec),
        );
      }, fallbackMs);
      return () => {
        if (videoCommitTimerRef.current != null) {
          clearTimeout(videoCommitTimerRef.current);
          videoCommitTimerRef.current = null;
        }
        if (videoFallbackTimerRef.current != null) {
          clearTimeout(videoFallbackTimerRef.current);
          videoFallbackTimerRef.current = null;
        }
      };
    }

    const ms = Math.max(1500, current.playSec * 1000);
    const id = setTimeout(() => {
      advanceAfterSlide(
        current.sponsorId,
        current.mediaIndex,
        capBilledSecondsForSponsorBudget(current.item, current.playSec, current.playSec),
        current.item.type,
      );
    }, ms);
    return () => clearTimeout(id);
  }, [
    current,
    activeSponsors.length,
    cycleId,
    advanceAfterSlide,
    finishClipOnce,
    followMode,
    isPlaybackOwner,
    paused,
    videoProgressDurationMs,
  ]);

  const handleVideoEnded = useCallback(
    (actualSec: number) => {
      if (followMode) return;
      if (!isPlaybackOwner) return;
      if (!current || current.item.type !== "VIDEO") return;
      const sec =
        Number.isFinite(actualSec) && actualSec > 0 ? actualSec : current.playSec;
      if (earlyEndedCommitTimerRef.current != null) return;
      if (
        current.playSec >= 5 &&
        sec + 0.5 < current.playSec &&
        earlyEndedCommitTimerRef.current == null
      ) {
        const holdMs = Math.min(60_000, Math.max(250, (current.playSec - sec) * 1000));
        playbackProgressMsRef.current = current.playSec * 1000;
        earlyEndedCommitTimerRef.current = window.setTimeout(() => {
          earlyEndedCommitTimerRef.current = null;
          finishClipOnce(current, current.playSec);
        }, holdMs);
        return;
      }
      if (videoFallbackTimerRef.current != null) {
        clearTimeout(videoFallbackTimerRef.current);
        videoFallbackTimerRef.current = null;
      }
      if (videoCommitTimerRef.current != null) {
        clearTimeout(videoCommitTimerRef.current);
        videoCommitTimerRef.current = null;
      }
      finishClipOnce(current, sec);
    },
    [current, finishClipOnce, followMode, isPlaybackOwner],
  );

  /** Beperkt fault → remount-cascades (decode-watchdogs + GPU-druk). */
  const pauseSponsorVideoDecodeAfterFault = useCallback(
    (now: number, reason: string) => {
      videoFaultCooldownUntilRef.current = now + SPONSOR_VIDEO_FAULT_PAUSE_MS;
      setVideoFaultPauseUntilMs(now + SPONSOR_VIDEO_FAULT_PAUSE_MS);
      videoFaultBurstRef.current.length = 0;
      if (videoFallbackTimerRef.current != null) {
        clearTimeout(videoFallbackTimerRef.current);
        videoFallbackTimerRef.current = null;
      }
      if (videoCommitTimerRef.current != null) {
        clearTimeout(videoCommitTimerRef.current);
        videoCommitTimerRef.current = null;
      }
      if (sponsorSwitchTimerRef.current != null) {
        clearTimeout(sponsorSwitchTimerRef.current);
        sponsorSwitchTimerRef.current = null;
      }
      finishTelemetryClip(0, { discard: true, reason });
      setCurrent(null);
      setVideoProgressDurationMs(0);
      setSponsorSwitchReleaseUntilMs(0);
      playbackProgressMsRef.current = 0;
      console.warn(
        `[sponsor] video-fout (${reason}) — ${SPONSOR_VIDEO_FAULT_PAUSE_MS / 1000}s pauze voor sponsorvideo-decode`,
      );
    },
    [finishTelemetryClip],
  );

  const onBudgetVideoPlaybackFault = useCallback((reason = "unknown") => {
    if (followMode) return;
    if (!isPlaybackOwner) return;
    if (!current || current.item.type !== "VIDEO") return;
    const now = Date.now();
    mediaFaultCooldownUntilRef.current[current.mediaId] =
      now + SPONSOR_MEDIA_FAULT_COOLDOWN_MS;
    if (
      reason === "media_error" ||
      reason === "watchdog_no_metadata" ||
      reason === "watchdog_stuck_t0" ||
      reason === "watchdog_dropped_frames" ||
      reason === "ended_never_started"
    ) {
      pauseSponsorVideoDecodeAfterFault(now, reason);
      return;
    }
    if (now < videoFaultCooldownUntilRef.current) return;
    if (now - lastVideoFaultAdvanceAtRef.current < 1100) return;
    const burst = videoFaultBurstRef.current;
    burst.push(now);
    const cutoff = now - 60_000;
    while (burst.length > 0 && burst[0]! < cutoff) burst.shift();
    if (burst.length > 3) {
      pauseSponsorVideoDecodeAfterFault(now, reason);
      return;
    }
    lastVideoFaultAdvanceAtRef.current = now;
    if (videoFallbackTimerRef.current != null) {
      clearTimeout(videoFallbackTimerRef.current);
      videoFallbackTimerRef.current = null;
    }
    finishClipOnce(
      current,
      capBilledSecondsForSponsorBudget(current.item, current.playSec, current.playSec),
    );
  }, [current, finishClipOnce, followMode, isPlaybackOwner, pauseSponsorVideoDecodeAfterFault]);

  useEffect(() => {
    if (followMode) return;
    if (!isPlaybackOwner) return;
    if (!window.electronAPI?.reportDisplayPlaybackContext) return;
    if (!current) {
      reportDisplayPlaybackToMain({
        source: "sponsor-budget",
        section,
        atMs: Date.now(),
      });
      return;
    }
    reportDisplayPlaybackToMain({
      source: "sponsor-budget",
      matchId: playbackTelemetry?.matchId ?? null,
      sponsorId: current.sponsorId,
      mediaId: current.mediaId,
      mediaTitle: current.item.title,
      mediaPath: current.item.path,
      mediaType: current.item.type,
      section,
      followMode: false,
      paused,
      atMs: Date.now(),
    });
  }, [
    current,
    section,
    followMode,
    isPlaybackOwner,
    paused,
    playbackTelemetry?.matchId,
    playbackTelemetry?.matchStatus,
  ]);

  useEffect(() => {
    if (followMode) return;
    if (!isPlaybackOwner) return;
    if (!playbackTelemetry || !current) return;
    const segmentKey = sponsorTelemetrySegmentKey(
      playbackTelemetry.matchId,
      playbackTelemetry.matchStatus,
      section,
    );
    if (!segmentKey) return;

    const startedAtMs = Date.now();
    const clipSessionId = stableClipSessionId(segmentKey, current);
    const telemetryKey = `${segmentKey}-${cycleId}-${slideTick}-${current.sponsorId}-${current.mediaId}`;
    telemetryClipRef.current = {
      key: telemetryKey,
      matchId: playbackTelemetry.matchId,
      segmentKey,
      sponsorId: current.sponsorId,
      mediaId: current.mediaId,
      clipSessionId,
      startedAtMs,
      ended: false,
    };
    lastPausedTelemetryRef.current = false;

    void reportSponsorClipStart({
      matchId: playbackTelemetry.matchId,
      segmentKey,
      sponsorId: current.sponsorId,
      mediaId: current.mediaId,
      expectedPlaySec: current.playSec,
      clipSessionId,
      startedAtMs,
      playbackPositionMs: 0,
      paused: false,
    });

    return () => {
      const clip = telemetryClipRef.current;
      if (!clip || clip.key !== telemetryKey || clip.ended) return;
      const playbackSec = playbackProgressMsRef.current / 1000;
      const actualSec =
        current.item.type === "VIDEO" && playbackSec > 0
          ? playbackSec
          : (Date.now() - startedAtMs) / 1000;
      finishTelemetryClip(actualSec);
    };
  }, [current, slideTick, section, playbackTelemetry, followMode, isPlaybackOwner, cycleId, finishTelemetryClip]);

  useEffect(() => {
    if (followMode) return;
    if (!isPlaybackOwner) return;
    if (!playbackTelemetry || !current) return;
    if (lastPausedTelemetryRef.current === paused) return;
    const segmentKey = sponsorTelemetrySegmentKey(
      playbackTelemetry.matchId,
      playbackTelemetry.matchStatus,
      section,
    );
    if (!segmentKey) return;
    const clipSessionId = stableClipSessionId(segmentKey, current);
    const positionMs = Math.max(0, playbackProgressMsRef.current);
    lastPausedTelemetryRef.current = paused;
    void reportSponsorClipStart({
      matchId: playbackTelemetry.matchId,
      segmentKey,
      sponsorId: current.sponsorId,
      mediaId: current.mediaId,
      expectedPlaySec: current.playSec,
      clipSessionId,
      startedAtMs: Date.now() - positionMs,
      playbackPositionMs: positionMs,
      paused,
    });
  }, [paused, current, slideTick, section, playbackTelemetry, followMode, isPlaybackOwner]);

  useEffect(() => {
    if (!followMode) return;
    if (!followClip) {
      setCurrent(null);
      setVideoProgressDurationMs(0);
      return;
    }
    const sponsor = sponsorsById[followClip.sponsorId];
    if (!sponsor) {
      setCurrent(null);
      return;
    }
    const active = (sponsor.media ?? []).filter((m) => m.active);
    const spreadList = buildSponsorRotationMediaList(
      filterMediaForSponsorSpreadSection(active, section, matchStatus),
      sponsor.sponsorPlaybackOrderJson,
      sponsor.sponsorPlaybackRepeatsJson,
    );
    let mediaIndex = spreadList.findIndex((m) => m.id === followClip.mediaId);
    let item: MediaItem | null = mediaIndex >= 0 ? spreadList[mediaIndex]! : null;
    if (!item) {
      const phaseOk = active.filter((m) => mediaAllowedForSponsorPhase(m, section, matchStatus));
      const fallback = phaseOk.find((m) => m.id === followClip.mediaId) ?? null;
      if (fallback) {
        item = fallback;
        const j = spreadList.findIndex((m) => m.id === fallback.id);
        mediaIndex = j >= 0 ? j : 0;
      }
    }
    if (!item) {
      setCurrent(null);
      return;
    }
    setCurrent((prev) => {
      if (prev && prev.sponsorId === sponsor.id && prev.mediaId === item.id) return prev;
      setSlideTick((t) => t + 1);
      return {
        sponsorId: sponsor.id,
        mediaId: item.id,
        item,
        mediaIndex: Math.max(0, mediaIndex),
        playSec: Math.max(0.5, followClip.expectedPlaySec || estimatePlaySec(item, sponsor)),
      };
    });
  }, [followMode, followClip, sponsorsById, section, matchStatus]);

  useEffect(() => {
    if (current) playedClipRef.current = true;
  }, [current]);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!followMode || !current) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(id);
  }, [followMode, current?.sponsorId, current?.mediaId]);

  /** Geen HTML-video-duration hier: die springt soms (korte metadata → echte lengte) en reset de preview-balk. */
  const slideMs =
    current != null ? Math.max(1500, current.playSec * 1000) : 0;
  const followElapsedMs =
    followMode && followClip
      ? sponsorTelemetryActiveClipElapsedSec(
          { ...followClip, clipSessionId: "follow" },
          nowMs,
        ) * 1000
      : 0;
  const followElapsed01 =
    followMode && current && slideMs > 0 ? Math.min(1, followElapsedMs / slideMs) : null;
  const followClipExpired =
    followMode && current && slideMs > 0 && followElapsedMs >= slideMs + 750;
  const slideElapsed = useTimedSlideProgress(
    showPreviewProgress && current && !followMode ? slideMs : 0,
    current ? `${current.sponsorId}-${current.mediaId}-${slideTick}` : "none",
    paused,
  );

  if (activeSponsors.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
        <div className="text-white/40 text-[56px]">No sponsors configured</div>
      </div>
    );
  }

  if (!followMode && !isPlaybackOwner) {
    return fallback != null ? (
      <div className="absolute inset-0 overflow-hidden bg-black">{fallback}</div>
    ) : (
      <div className="absolute inset-0 bg-black" />
    );
  }

  const videoFaultPaused = !followMode && videoFaultPauseUntilMs > Date.now();
  const sponsorSwitchReleasing =
    !followMode && sponsorSwitchReleaseUntilMs > Date.now();
  const showBudgetFallback = followMode
    ? fallback != null &&
        (followClipExpired || (!followClip && !current && playedClipRef.current))
    : fallback != null &&
        (((videoFaultPaused || sponsorSwitchReleasing) && !current) ||
          (!cycleBudgetForever && !current && playedClipRef.current));

  return (
    <div className="absolute inset-0 overflow-hidden bg-black contain-layout contain-paint">
      {showBudgetFallback ? (
        <div className="absolute inset-0 size-full">{fallback}</div>
      ) : current && !followClipExpired ? (
        <div
          key={`${current.sponsorId}-${current.mediaId}-${cycleId}-${slideTick}`}
          className="absolute inset-0 size-full min-h-0 min-w-0"
        >
          <MediaRenderer
            item={current.item}
            objectFit={mediaObjectFit}
            renderVideo={renderVideo}
            paused={paused || (followMode && !followClip)}
            committedPlaySec={current.item.type === "VIDEO" ? current.playSec : undefined}
            syncPlaybackMs={
              followMode && followClip ? Math.max(0, followElapsedMs) : undefined
            }
            onVideoEnded={handleVideoEnded}
            onVideoPlaybackFault={followMode ? undefined : onBudgetVideoPlaybackFault}
            onVideoDurationMs={(ms) => {
              if (ms > 0) setVideoProgressDurationMs(ms);
            }}
            onVideoProgressMs={(ms) => {
              const next = Math.max(0, ms);
              playbackProgressMsRef.current = next;
            }}
          />
        </div>
      ) : (
        <div className="absolute inset-0 bg-black" />
      )}
      {showPreviewProgress && current && !followClipExpired && slideMs > 0 && (
        <PreviewSlideProgressBar
          elapsed01={followElapsed01 ?? slideElapsed}
          totalMs={slideMs}
        />
      )}
    </div>
  );
}

function budgetFor(s: Sponsor, section: SponsorSection, matchStatus?: string): number {
  if (section === "prematch") return s.prematchSeconds;
  if (section === "halftime") return s.halftimeSeconds;
  return matchPlayBudgetSeconds(s, matchStatus);
}

function MediaRenderer({
  item,
  objectFit,
  renderVideo,
  paused,
  syncPlaybackMs,
  committedPlaySec,
  onVideoEnded,
  onVideoPlaybackFault,
  onVideoDurationMs,
  onVideoProgressMs,
}: {
  item: MediaItem;
  objectFit: "cover" | "contain";
  renderVideo: boolean;
  paused: boolean;
  /** Voor embedded preview: houd de video exact op dezelfde positie als main. */
  syncPlaybackMs?: number;
  /** Geplande spotduur (s) — bij afwijkende browser-metadata toch volledige clip afwachten. */
  committedPlaySec?: number;
  onVideoEnded: (actualSec: number) => void;
  /** Decode-/netwerkfout: clip kan geen `ended` geven; ga door zonder volledige buffertime-out. */
  onVideoPlaybackFault?: (reason?: string) => void;
  onVideoDurationMs?: (ms: number) => void;
  onVideoProgressMs?: (ms: number) => void;
}) {
  const src = mediaUrl(item.path);
  const videoRef = useRef<HTMLVideoElement>(null);
  const endedRef = useRef(false);
  const falseEndedRetriesRef = useRef(0);
  const lastFollowSeekAtRef = useRef(0);
  const earlyEndHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Eerste `playing`-event na mount van dit item (alleen hoofd-display). */
  const firstPlayingAtRef = useRef<number | null>(null);

  const logMediaDiag = useCallback(
    (event: string, v?: HTMLVideoElement | null, extra?: Partial<DisplayMediaDiagnosticPayload>) => {
      if (syncPlaybackMs != null) return;
      const throttleMs =
        event === "error" || event.startsWith("watchdog_")
          ? 0
          : event === "loaded_metadata"
            ? 5000
            : event === "stalled" || event === "waiting" || event === "suspend"
              ? 15000
              : 0;
      const el = v ?? videoRef.current;
      reportDisplayMediaDiagnostic(
        {
          source: "sponsor-budget",
          event,
          mediaId: item.id,
          mediaTitle: item.title,
          mediaPath: item.path,
          ...videoElementDiagnosticFields(el),
          ...extra,
          atMs: Date.now(),
        },
        throttleMs,
      );
    },
    [syncPlaybackMs, item.id, item.title, item.path],
  );

  useEffect(() => {
    if (item.type !== "VIDEO") return;
    return () => {
      if (earlyEndHoldTimerRef.current != null) {
        clearTimeout(earlyEndHoldTimerRef.current);
        earlyEndHoldTimerRef.current = null;
      }
      releaseHtmlVideoElement(videoRef.current);
    };
  }, [item.id, item.path, item.type]);

  useEffect(() => {
    if (earlyEndHoldTimerRef.current != null) {
      clearTimeout(earlyEndHoldTimerRef.current);
      earlyEndHoldTimerRef.current = null;
    }
    endedRef.current = false;
    falseEndedRetriesRef.current = 0;
    firstPlayingAtRef.current = null;
  }, [item.id, item.path]);

  // Decode-watchdog: als een video niet binnen 4s metadata aanlevert,
  // beschouwen we hem als hangend en triggeren we onVideoPlaybackFault zodat
  // de rotatie naar de volgende clip kan. Voorkomt dat het scherm vastloopt
  // op een corrupte of trage clip tijdens een live wedstrijd.
  useEffect(() => {
    if (item.type !== "VIDEO") return;
    if (syncPlaybackMs != null) return; // preview volgt main, niet zelf timer-bewaking
    const v = videoRef.current;
    if (!v) return;
    const watchdog = window.setTimeout(() => {
      if (endedRef.current) return;
      if (Number.isFinite(v.duration) && v.duration > 0) return;
      if (!onVideoPlaybackFault) return;
      endedRef.current = true;
      logMediaDiag("watchdog_no_metadata_4s", v);
      console.warn("[sponsor] video decode-watchdog gevuurd voor", item.title);
      onVideoPlaybackFault("watchdog_no_metadata");
    }, 4000);
    return () => window.clearTimeout(watchdog);
  }, [item.id, item.path, item.type, syncPlaybackMs, onVideoPlaybackFault, item.title, logMediaDiag]);

  /**
   * Sommige clips/drivers geven een zwarte videolaag (score/UI wel zichtbaar) terwijl
   * decode zwaar blijft proberen. Vang vroeg af: vast op t≈0, of extreem veel drops.
   */
  useEffect(() => {
    if (item.type !== "VIDEO") return;
    if (syncPlaybackMs != null) return;
    if (!onVideoPlaybackFault) return;
    const id = window.setInterval(() => {
      if (endedRef.current || paused) return;
      const v = videoRef.current;
      if (!v || v.paused) return;
      const t0 = firstPlayingAtRef.current;
      if (t0 == null) return;
      const sincePlay = Date.now() - t0;
      if (sincePlay > 8500 && v.currentTime < 0.04) {
        endedRef.current = true;
        logMediaDiag("watchdog_stuck_t0", v);
        console.warn("[sponsor] video blijft hangen op t≈0 — clip overgeslagen:", item.title);
        onVideoPlaybackFault("watchdog_stuck_t0");
        return;
      }
      if (sincePlay < 5500 || v.currentTime < 1.75) return;
      const q = typeof v.getVideoPlaybackQuality === "function" ? v.getVideoPlaybackQuality() : null;
      if (!q) return;
      const rendered = q.totalVideoFrames;
      const dropped = q.droppedVideoFrames;
      const denom = rendered + dropped;
      if (denom < 140 || dropped / denom < 0.9) return;
      endedRef.current = true;
      logMediaDiag("watchdog_dropped_frames", v, {
        droppedFrames: dropped,
        totalVideoFrames: rendered,
      });
      console.warn(
        "[sponsor] video extreem veel gedropte frames — clip overgeslagen:",
        item.title,
        { rendered, dropped, currentTime: v.currentTime },
      );
      onVideoPlaybackFault("watchdog_dropped_frames");
    }, 900);
    return () => window.clearInterval(id);
  }, [item.id, item.path, item.type, item.title, paused, syncPlaybackMs, onVideoPlaybackFault, logMediaDiag]);

  useEffect(() => {
    if (item.type !== "VIDEO" || syncPlaybackMs == null) return;
    const v = videoRef.current;
    if (!v) return;
    const applySync = () => {
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
      const syncPlaybackSec = syncPlaybackMs / 1000;
      const target = dur != null ? Math.min(Math.max(0, syncPlaybackSec), Math.max(0, dur - 0.05)) : syncPlaybackSec;
      const now = Date.now();
      const drift = Math.abs(v.currentTime - target);
      if (dur != null && syncPlaybackSec >= dur - 0.1) {
        if (drift > 0.25) {
          try {
            v.currentTime = target;
          } catch {
            /* ignore media seek race */
          }
        }
        v.pause();
        return;
      }
      if (drift > 2.5 && now - lastFollowSeekAtRef.current > 2500) {
        lastFollowSeekAtRef.current = now;
        try {
          v.currentTime = target;
        } catch {
          /* ignore media seek race */
        }
      }
      if (v.paused) void v.play().catch(() => {});
    };
    applySync();
    const id = window.setTimeout(applySync, 50);
    return () => clearTimeout(id);
  }, [item.id, item.path, item.type, syncPlaybackMs]);

  useEffect(() => {
    if (item.type !== "VIDEO" || !(item.playAudio ?? false)) return;
    const v = videoRef.current;
    if (!v) return;
    const id = window.setTimeout(() => void v.play().catch(() => {}), 0);
    return () => clearTimeout(id);
  }, [item.id, item.path, item.playAudio, item.type]);

  useEffect(() => {
    if (item.type !== "VIDEO") return;
    const v = videoRef.current;
    if (!v) return;
    if (paused) {
      onVideoProgressMs?.(v.currentTime * 1000);
      v.pause();
      return;
    }
    void v.play().catch(() => {});
  }, [item.id, item.path, item.type, onVideoProgressMs, paused]);

  /**
   * Facturatie voor rotatie-budget moet gelijk lopen met telemetry (`currentTime`).
   * `video.duration` kan een langere container zijn dan de werkelijk afgespeelde spot;
   * `Math.max(ct, browserDur)` joeg `spentPerSponsor` dan omhoog terwijl de ledger
   * nog resterend budget toonde.
   */
  const resolveBilledVideoSec = (video: HTMLVideoElement): number => {
    const browserDur =
      Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const ct = Math.max(0, video.currentTime || 0);
    let sec = Math.max(0.1, ct);
    if (browserDur > 0 && ct >= browserDur - 2.5) {
      sec = Math.max(sec, browserDur);
    }
    return sec;
  };

  const fireEndedOnce = (video: HTMLVideoElement) => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (earlyEndHoldTimerRef.current != null) {
      clearTimeout(earlyEndHoldTimerRef.current);
      earlyEndHoldTimerRef.current = null;
    }
    onVideoEnded(resolveBilledVideoSec(video));
  };

  const holdEarlyEndedVideoUntilCommittedDuration = (
    video: HTMLVideoElement,
    catalogDur: number,
    playedSec: number,
  ): boolean => {
    if (syncPlaybackMs != null) return false;
    if (catalogDur < 5 || playedSec + 0.5 >= catalogDur) return false;
    if (earlyEndHoldTimerRef.current != null) return true;

    endedRef.current = true;
    const holdMs = Math.min(60_000, Math.max(250, (catalogDur - playedSec) * 1000));
    logMediaDiag("ended_before_committed_hold", video, {
      currentTime: video.currentTime,
    });
    onVideoProgressMs?.(catalogDur * 1000);
    earlyEndHoldTimerRef.current = window.setTimeout(() => {
      earlyEndHoldTimerRef.current = null;
      onVideoEnded(catalogDur);
    }, holdMs);
    return true;
  };

  const maybeFireEarlyEnd = (video: HTMLVideoElement) => {
    if (endedRef.current) return;
    if (syncPlaybackMs != null) return;
    const browserDur = video.duration;
    if (!Number.isFinite(browserDur) || browserDur <= 0) return;
    const catalogDur = Math.max(
      item.durationSec > 0 ? item.durationSec : 0,
      committedPlaySec != null && committedPlaySec > 0 ? committedPlaySec : 0,
    );
    /**
     * Korte browser-duration i.c.m. lange spot: niet afkappen op currentTime >= browserDur.
     * Wacht tot currentTime dicht bij de (max van catalog, geplande) duur zit.
     */
    if (catalogDur >= 10 && browserDur + 5 < catalogDur) {
      if (video.currentTime < catalogDur - 0.35) return;
      fireEndedOnce(video);
      return;
    }
    let endDur: number;
    if (catalogDur > 0 && browserDur > catalogDur * 2 + 10) {
      /** Browser/container veel langer dan spot → niet wachten op fictieve eind-t. */
      endDur = catalogDur;
    } else {
      endDur = catalogDur > 0 ? Math.max(browserDur, catalogDur) : browserDur;
    }
    if (video.currentTime >= endDur - 0.2) {
      fireEndedOnce(video);
    }
  };

  const videoProps = {
    ref: videoRef,
    src,
    autoPlay: true,
    loop: false,
    muted: !(item.playAudio ?? false),
    playsInline: true,
    onPlaying: () => {
      if (syncPlaybackMs != null) return;
      if (firstPlayingAtRef.current == null) firstPlayingAtRef.current = Date.now();
    },
    onLoadedMetadata: (e: SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget;
      const d = v.duration;
      if (Number.isFinite(d) && d > 0) {
        const catalogSec = Math.max(
          0.5,
          item.durationSec > 0 ? item.durationSec : 0,
          committedPlaySec != null && committedPlaySec > 0 ? committedPlaySec : 0,
        );
        const capped =
          d > catalogSec * 3 + 90 ? catalogSec : d;
        onVideoDurationMs?.(capped * 1000);
      }
      if (syncPlaybackMs != null) {
        const syncPlaybackSec = syncPlaybackMs / 1000;
        const target = Number.isFinite(d) && d > 0
          ? Math.min(Math.max(0, syncPlaybackSec), Math.max(0, d - 0.05))
          : syncPlaybackSec;
        try {
          v.currentTime = target;
        } catch {
          /* ignore media seek race */
        }
        if (Number.isFinite(d) && d > 0 && syncPlaybackSec >= d - 0.1) {
          v.pause();
        }
      }
      onVideoProgressMs?.(v.currentTime * 1000);
      logMediaDiag("loaded_metadata", v);
    },
    onTimeUpdate: (e: SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget;
      onVideoProgressMs?.(v.currentTime * 1000);
      maybeFireEarlyEnd(v);
    },
    onEnded: (e: SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget;
      onVideoProgressMs?.(v.currentTime * 1000);
      const catalogDur = Math.max(
        item.durationSec > 0 ? item.durationSec : 0,
        committedPlaySec != null && committedPlaySec > 0 ? committedPlaySec : 0,
      );
      const browserDur =
        Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      const useDur = resolveBilledVideoSec(v);
      /** Metadata nooit geladen → Chromium vuurt `ended` met t≈0; zonder dit telt het als succes en omzeilt de fault-cooldown. */
      const looksLikeNeverStarted =
        item.type === "VIDEO" &&
        syncPlaybackMs == null &&
        catalogDur >= 5 &&
        browserDur === 0 &&
        v.currentTime < 0.1;
      if (looksLikeNeverStarted) {
        if (onVideoPlaybackFault) {
          endedRef.current = true;
          logMediaDiag("ended_never_started_fault", v);
          onVideoPlaybackFault("ended_never_started");
          return;
        }
      }
      const looksLikeFalseEnd =
        item.type === "VIDEO" &&
        syncPlaybackMs == null &&
        catalogDur >= 12 &&
        browserDur > 0 &&
        browserDur <= 6 &&
        catalogDur >= browserDur + 6 &&
        useDur + 3 < catalogDur;
      if (looksLikeFalseEnd) {
        if (falseEndedRetriesRef.current >= 2) {
          endedRef.current = true;
          onVideoProgressMs?.(catalogDur * 1000);
          onVideoEnded(catalogDur);
          falseEndedRetriesRef.current = 0;
          return;
        }
        falseEndedRetriesRef.current += 1;
        endedRef.current = false;
        try {
          v.currentTime = 0;
          void v.play().catch(() => {
            fireEndedOnce(v);
          });
        } catch {
          fireEndedOnce(v);
        }
        return;
      }
      if (holdEarlyEndedVideoUntilCommittedDuration(v, catalogDur, useDur)) {
        return;
      }
      falseEndedRetriesRef.current = 0;
      fireEndedOnce(v);
    },
    onStalled: (e: SyntheticEvent<HTMLVideoElement>) => {
      logMediaDiag("stalled", e.currentTarget);
    },
    onWaiting: (e: SyntheticEvent<HTMLVideoElement>) => {
      logMediaDiag("waiting", e.currentTarget);
    },
    onSuspend: (e: SyntheticEvent<HTMLVideoElement>) => {
      logMediaDiag("suspend", e.currentTarget);
    },
    onError: (e: SyntheticEvent<HTMLVideoElement>) => {
      logMediaDiag("error", e.currentTarget);
      if (!onVideoPlaybackFault) return;
      if (endedRef.current) return;
      endedRef.current = true;
      onVideoPlaybackFault("media_error");
    },
  };

  if (item.type === "VIDEO" && !renderVideo) {
    return <VideoPreviewPlaceholder title={item.title} />;
  }

  if (objectFit === "contain") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        {item.type === "VIDEO" ? (
        <video
          key={`${item.id}-${src}`}
          {...videoProps}
          preload="metadata"
          className="max-h-full max-w-full"
            style={{ objectFit: "contain", objectPosition: "center" }}
          />
        ) : (
          <img
            src={src}
            alt={item.title}
            decoding="async"
            className="max-h-full max-w-full"
            style={{ objectFit: "contain", objectPosition: "center" }}
          />
        )}
      </div>
    );
  }
  if (item.type === "VIDEO") {
    return (
      <div className="absolute inset-0 overflow-hidden bg-black">
        <video
          key={`${item.id}-${src}`}
          {...videoProps}
          preload="metadata"
          style={DISPLAY_COVER_MEDIA_STYLE}
        />
      </div>
    );
  }
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <img src={src} alt={item.title} decoding="async" style={DISPLAY_COVER_MEDIA_STYLE} />
    </div>
  );
}

function VideoPreviewPlaceholder({ title }: { title: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black">
      <div className="max-w-[70%] rounded-xl border border-white/10 bg-white/[0.04] px-6 py-4 text-center text-white/60">
        <div className="text-[22px] font-semibold text-white/80">Sponsorvideo actief</div>
        <div className="mt-2 truncate text-[16px]">{title}</div>
        <div className="mt-2 text-[13px] text-white/40">
          Preview zonder extra video-decoder
        </div>
      </div>
    </div>
  );
}
