"use client";

import { AnimatePresence, motion } from "framer-motion";
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
import { matchPlayBudgetSeconds } from "@/lib/sponsor-distribution";
import { sponsorTelemetrySegmentKey } from "@/lib/sponsor-telemetry";
import { reportSponsorClipEnd, reportSponsorClipStart } from "@/lib/use-socket";
import { mediaUrl } from "@/lib/media-url";
import { filterMediaForSponsorSpreadSection } from "@/lib/sponsor-match-spread-media";
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
  fallback = null,
  cycleBudgetForever = false,
  paused = false,
}: {
  sponsors: Sponsor[];
  section: SponsorSection;
  matchStatus?: string;
  sponsorIdFilter?: string | null;
  playbackTelemetry?: { matchId: string; matchStatus: string } | null;
  /** Preview blijft in volgmodus, ook wanneer main geen actieve clip meer heeft. */
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
  /** Getoond nadat minstens één clip is gespeeld en er geen budget meer over is. */
  fallback?: ReactNode;
  /** Zet spent terug naar nul zodra iedereen zijn quotum haalde — oneindige cyclus binnen de fase. */
  cycleBudgetForever?: boolean;
  /** Tijdelijk pauzeren zonder current clip te vergeten, bv. tijdens goal/wissel-overlay. */
  paused?: boolean;
}) {
  const followMode = followPlayback;
  const activeSponsors = useMemo(() => {
    let list = sponsors.filter((s) => {
      const sectionMedia = filterMediaForSponsorSpreadSection(
        (s.media ?? []).filter((m) => m.active),
        section,
        matchStatus,
      );
      return (
        s.active &&
        budgetFor(s, section, matchStatus) > 0 &&
        sectionMedia.length > 0
      );
    });
    if (sponsorIdFilter) {
      list = list.filter((s) => s.id === sponsorIdFilter);
    }
    return list;
  }, [sponsors, section, matchStatus, sponsorIdFilter]);

  const [cycleId, setCycleId] = useState(0);
  const [slideTick, setSlideTick] = useState(0);
  const [current, setCurrent] = useState<Plan | null>(null);
  const [videoProgressDurationMs, setVideoProgressDurationMs] = useState(0);
  const playbackProgressMsRef = useRef(0);

  const stateRef = useRef<{
    mediaCursor: Record<string, number>;
    spentPerSponsor: Record<string, number>;
  }>({
    mediaCursor: {},
    spentPerSponsor: {},
  });
  const tieBreakCursorRef = useRef(0);
  const videoFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playedClipRef = useRef(false);
  const finishedClipKeyRef = useRef<string | null>(null);
  const clipSessionRef = useRef<{ key: string; id: string } | null>(null);

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
  const activeSponsorSignature = useMemo(
    () => activeSponsors.map((s) => s.id).sort().join("|"),
    [activeSponsors],
  );

  useEffect(() => {
    stateRef.current = {
      mediaCursor: {},
      spentPerSponsor: {},
    };
    tieBreakCursorRef.current = 0;
    playedClipRef.current = false;
    clipSessionRef.current = null;
    setCycleId((c) => c + 1);
    setSlideTick(0);
    setCurrent(null);
    setVideoProgressDurationMs(0);
    playbackProgressMsRef.current = 0;
  }, [section, activeSponsorSignature]);

  const budgetFn = useCallback(
    (s: Sponsor) => budgetFor(s, section, matchStatus),
    [section, matchStatus],
  );

  const pickNext = useCallback((): Plan | null => {
    const st = stateRef.current;

    const scheduledSponsorMode = sponsorIdFilter != null;
    let eligibleAll = scheduledSponsorMode
      ? activeSponsors
      : activeSponsors.filter((s) => (st.spentPerSponsor[s.id] ?? 0) < budgetFn(s));
    if (!scheduledSponsorMode && eligibleAll.length === 0 && cycleBudgetForever) {
      st.spentPerSponsor = {};
      eligibleAll = activeSponsors.filter(
        (s) => (st.spentPerSponsor[s.id] ?? 0) < budgetFn(s),
      );
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

    const media = filterMediaForSponsorSpreadSection(
      (sponsor.media ?? []).filter((m) => m.active),
      section,
      matchStatus,
    );
    if (media.length === 0) return null;

    const mi = (st.mediaCursor[sponsor.id] ?? 0) % media.length;
    const item = media[mi]!;
    const playSec = estimatePlaySec(item, sponsor);

    return {
      sponsorId: sponsor.id,
      mediaId: item.id,
      item,
      mediaIndex: mi,
      playSec,
    };
  }, [activeSponsors, budgetFn, section, cycleBudgetForever, sponsorIdFilter]);

  const advanceAfterSlide = useCallback(
    (sponsorId: string, mediaIndex: number, seconds: number) => {
      if (videoFallbackTimerRef.current != null) {
        clearTimeout(videoFallbackTimerRef.current);
        videoFallbackTimerRef.current = null;
      }
      const st = stateRef.current;
      st.mediaCursor[sponsorId] = mediaIndex + 1;
      tieBreakCursorRef.current++;
      const prev = st.spentPerSponsor[sponsorId] ?? 0;
      st.spentPerSponsor[sponsorId] = prev + Math.max(0, seconds);

      const next = pickNext();
      setVideoProgressDurationMs(0);
      playbackProgressMsRef.current = 0;
      if (next) {
        setCurrent(next);
        setSlideTick((t) => t + 1);
      } else {
        setCurrent(null);
      }
    },
    [pickNext],
  );

  const finishClipOnce = useCallback(
    (plan: Plan, seconds: number) => {
      const key = `${plan.sponsorId}-${plan.mediaId}-${cycleId}-${slideTick}`;
      if (finishedClipKeyRef.current === key) return;
      finishedClipKeyRef.current = key;
      advanceAfterSlide(plan.sponsorId, plan.mediaIndex, seconds);
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
    if (followMode) return;
    if (activeSponsors.length === 0) return;

    if (!current) {
      const next = pickNext();
      if (next) {
        setCurrent(next);
        setSlideTick((t) => t + 1);
      }
    }
  }, [activeSponsors.length, current, pickNext, cycleId, followMode]);

  useEffect(() => {
    if (followMode) return;
    if (paused) return;
    if (!current || activeSponsors.length === 0) return;

    if (current.item.type === "VIDEO") {
      const actualVideoSec =
        videoProgressDurationMs > 0 ? videoProgressDurationMs / 1000 : current.playSec;
      const expectedMs = Math.max(5_000, actualVideoSec * 1000);
      const fallbackMs = Math.min(
        900_000,
        Math.max(8_000, expectedMs + 20_000),
      );
      videoFallbackTimerRef.current = setTimeout(() => {
        videoFallbackTimerRef.current = null;
        finishClipOnce(current, actualVideoSec);
      }, fallbackMs);
      return () => {
        if (videoFallbackTimerRef.current != null) {
          clearTimeout(videoFallbackTimerRef.current);
          videoFallbackTimerRef.current = null;
        }
      };
    }

    const ms = Math.max(1500, current.playSec * 1000);
    const id = setTimeout(() => {
      advanceAfterSlide(current.sponsorId, current.mediaIndex, current.playSec);
    }, ms);
    return () => clearTimeout(id);
  }, [
    current,
    activeSponsors.length,
    cycleId,
    advanceAfterSlide,
    finishClipOnce,
    followMode,
    paused,
    videoProgressDurationMs,
  ]);

  const handleVideoEnded = useCallback(
    (actualSec: number) => {
      if (followMode) return;
      if (!current || current.item.type !== "VIDEO") return;
      if (videoFallbackTimerRef.current != null) {
        clearTimeout(videoFallbackTimerRef.current);
        videoFallbackTimerRef.current = null;
      }
      const sec =
        Number.isFinite(actualSec) && actualSec > 0 ? actualSec : current.playSec;
      finishClipOnce(current, sec);
    },
    [current, finishClipOnce, followMode],
  );

  useEffect(() => {
    if (followMode) return;
    if (!playbackTelemetry || !current) return;
    const segmentKey = sponsorTelemetrySegmentKey(
      playbackTelemetry.matchId,
      playbackTelemetry.matchStatus,
      section,
    );
    if (!segmentKey) return;

    const startedAtMs = Date.now();
    const clipSessionId = stableClipSessionId(segmentKey, current);

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

    const ended = {
      matchId: playbackTelemetry.matchId,
      segmentKey,
      sponsorId: current.sponsorId,
      mediaId: current.mediaId,
      clipSessionId,
      startedAtMs,
    };

    return () => {
      const playbackSec = playbackProgressMsRef.current / 1000;
      const actualSec =
        current.item.type === "VIDEO" && playbackSec > 0
          ? playbackSec
          : (Date.now() - startedAtMs) / 1000;
      void reportSponsorClipEnd({ ...ended, actualSec });
    };
  }, [current, slideTick, section, playbackTelemetry, followMode]);

  useEffect(() => {
    if (followMode) return;
    if (!playbackTelemetry || !current) return;
    const segmentKey = sponsorTelemetrySegmentKey(
      playbackTelemetry.matchId,
      playbackTelemetry.matchStatus,
      section,
    );
    if (!segmentKey) return;
    const clipSessionId = stableClipSessionId(segmentKey, current);
    const positionMs = Math.max(0, playbackProgressMsRef.current);
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
  }, [paused, current, slideTick, section, playbackTelemetry, followMode]);

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
    const mediaList = filterMediaForSponsorSpreadSection(
      (sponsor.media ?? []).filter((m) => m.active),
      section,
      matchStatus,
    );
    const mediaIndex = mediaList.findIndex((m) => m.id === followClip.mediaId);
    const item = mediaIndex >= 0 ? mediaList[mediaIndex] : null;
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
  }, [followMode, followClip, sponsorsById, section]);

  useEffect(() => {
    if (current) playedClipRef.current = true;
  }, [current]);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!followMode || !current) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(id);
  }, [followMode, current?.sponsorId, current?.mediaId]);

  const slideMs =
    current != null
      ? current.item.type === "VIDEO" && videoProgressDurationMs > 0
        ? videoProgressDurationMs
        : Math.max(1500, current.playSec * 1000)
      : 0;
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

  const showBudgetFallback = followMode
    ? fallback != null && (!current || followClipExpired)
    : fallback != null && !cycleBudgetForever && !current && playedClipRef.current;

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {showBudgetFallback ? (
        <div className="absolute inset-0 size-full">{fallback}</div>
      ) : (
        <AnimatePresence mode="sync">
        {current && !followClipExpired && (
          <motion.div
            key={`${current.sponsorId}-${current.mediaId}-${cycleId}-${slideTick}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 size-full min-h-0 min-w-0"
          >
            <MediaRenderer
              item={current.item}
              objectFit={mediaObjectFit}
              paused={paused}
              syncPlaybackMs={
                followMode && followClip ? Math.max(0, followElapsedMs) : undefined
              }
              onVideoEnded={handleVideoEnded}
              onVideoPlaybackFault={() => {
                if (!current || current.item.type !== "VIDEO") return;
                if (followMode) return;
                if (videoFallbackTimerRef.current != null) {
                  clearTimeout(videoFallbackTimerRef.current);
                  videoFallbackTimerRef.current = null;
                }
                finishClipOnce(current, current.playSec);
              }}
              onVideoDurationMs={(ms) => {
                if (ms > 0) setVideoProgressDurationMs(ms);
              }}
              onVideoProgressMs={(ms) => {
                const next = Math.max(0, ms);
                playbackProgressMsRef.current = next;
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
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
  paused,
  syncPlaybackMs,
  onVideoEnded,
  onVideoPlaybackFault,
  onVideoDurationMs,
  onVideoProgressMs,
}: {
  item: MediaItem;
  objectFit: "cover" | "contain";
  paused: boolean;
  /** Voor embedded preview: houd de video exact op dezelfde positie als main. */
  syncPlaybackMs?: number;
  onVideoEnded: (actualSec: number) => void;
  /** Decode-/netwerkfout: clip kan geen `ended` geven; ga door zonder volledige buffertime-out. */
  onVideoPlaybackFault?: () => void;
  onVideoDurationMs?: (ms: number) => void;
  onVideoProgressMs?: (ms: number) => void;
}) {
  const src = mediaUrl(item.path);
  const videoRef = useRef<HTMLVideoElement>(null);
  const endedRef = useRef(false);
  const lastFollowSeekAtRef = useRef(0);

  useEffect(() => {
    endedRef.current = false;
  }, [item.id, item.path]);

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

  const fireEndedOnce = (video: HTMLVideoElement) => {
    if (endedRef.current) return;
    endedRef.current = true;
    const d = video.duration;
    const useDur =
      Number.isFinite(d) && d > 0 ? d : Math.max(0.1, video.currentTime || 0);
    onVideoEnded(useDur);
  };

  const maybeFireEarlyEnd = (video: HTMLVideoElement) => {
    if (endedRef.current) return;
    if (syncPlaybackMs != null) return;
    const d = video.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    if (video.currentTime >= d - 0.2) {
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
    onLoadedMetadata: (e: SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget;
      const d = v.duration;
      if (Number.isFinite(d) && d > 0) {
        onVideoDurationMs?.(d * 1000);
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
    },
    onTimeUpdate: (e: SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget;
      onVideoProgressMs?.(v.currentTime * 1000);
      maybeFireEarlyEnd(v);
    },
    onEnded: (e: SyntheticEvent<HTMLVideoElement>) => {
      onVideoProgressMs?.(e.currentTarget.currentTime * 1000);
      fireEndedOnce(e.currentTarget);
    },
    onError: () => {
      if (!onVideoPlaybackFault) return;
      if (endedRef.current) return;
      endedRef.current = true;
      onVideoPlaybackFault();
    },
  };

  if (objectFit === "contain") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        {item.type === "VIDEO" ? (
          <video
            key={`${item.id}-${src}`}
            {...videoProps}
            className="max-h-full max-w-full"
            style={{ objectFit: "contain", objectPosition: "center" }}
          />
        ) : (
          <img
            src={src}
            alt={item.title}
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
          style={DISPLAY_COVER_MEDIA_STYLE}
        />
      </div>
    );
  }
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <img src={src} alt={item.title} style={DISPLAY_COVER_MEDIA_STYLE} />
    </div>
  );
}
