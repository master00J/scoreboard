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
  mediaObjectFit = "cover",
  showPreviewProgress = false,
  fallback = null,
  cycleBudgetForever = false,
}: {
  sponsors: Sponsor[];
  section: SponsorSection;
  matchStatus?: string;
  sponsorIdFilter?: string | null;
  playbackTelemetry?: { matchId: string; matchStatus: string } | null;
  mediaObjectFit?: "cover" | "contain";
  showPreviewProgress?: boolean;
  /** Getoond nadat minstens één clip is gespeeld en er geen budget meer over is. */
  fallback?: ReactNode;
  /** Zet spent terug naar nul zodra iedereen zijn quotum haalde — oneindige cyclus binnen de fase. */
  cycleBudgetForever?: boolean;
}) {
  const activeSponsors = useMemo(() => {
    let list = sponsors.filter(
      (s) =>
        s.active &&
        budgetFor(s, section, matchStatus) > 0 &&
        (s.media?.some((m) => m.active) ?? false),
    );
    if (sponsorIdFilter) {
      list = list.filter((s) => s.id === sponsorIdFilter);
    }
    return list;
  }, [sponsors, section, matchStatus, sponsorIdFilter]);

  const [cycleId, setCycleId] = useState(0);
  const [slideTick, setSlideTick] = useState(0);
  const [current, setCurrent] = useState<Plan | null>(null);
  const [videoProgressDurationMs, setVideoProgressDurationMs] = useState(0);

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

  useEffect(() => {
    stateRef.current = {
      mediaCursor: {},
      spentPerSponsor: {},
    };
    tieBreakCursorRef.current = 0;
    playedClipRef.current = false;
    setCycleId((c) => c + 1);
    setSlideTick(0);
    setCurrent(null);
    setVideoProgressDurationMs(0);
  }, [section, activeSponsors.map((s) => s.id).join(",")]);

  const budgetFn = useCallback(
    (s: Sponsor) => budgetFor(s, section, matchStatus),
    [section, matchStatus],
  );

  const pickNext = useCallback((): Plan | null => {
    const st = stateRef.current;

    let eligibleAll = activeSponsors.filter(
      (s) => (st.spentPerSponsor[s.id] ?? 0) < budgetFn(s),
    );
    if (eligibleAll.length === 0 && cycleBudgetForever) {
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
  }, [activeSponsors, budgetFn, section, cycleBudgetForever]);

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
      if (next) {
        setCurrent(next);
        setSlideTick((t) => t + 1);
      } else {
        setCurrent(null);
      }
    },
    [pickNext],
  );

  useEffect(() => {
    if (activeSponsors.length === 0) return;

    if (!current) {
      const next = pickNext();
      if (next) {
        setCurrent(next);
        setSlideTick((t) => t + 1);
      }
    }
  }, [activeSponsors.length, current, pickNext, cycleId]);

  useEffect(() => {
    if (!current || activeSponsors.length === 0) return;

    if (current.item.type === "VIDEO") {
      const expectedMs = Math.max(5_000, current.playSec * 1000);
      const fallbackMs = Math.min(
        900_000,
        Math.max(8_000, expectedMs + 20_000),
      );
      videoFallbackTimerRef.current = setTimeout(() => {
        videoFallbackTimerRef.current = null;
        advanceAfterSlide(
          current.sponsorId,
          current.mediaIndex,
          current.playSec,
        );
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
  }, [current, activeSponsors.length, cycleId, advanceAfterSlide]);

  const handleVideoEnded = useCallback(
    (actualSec: number) => {
      if (!current || current.item.type !== "VIDEO") return;
      if (videoFallbackTimerRef.current != null) {
        clearTimeout(videoFallbackTimerRef.current);
        videoFallbackTimerRef.current = null;
      }
      const sec =
        Number.isFinite(actualSec) && actualSec > 0 ? actualSec : current.playSec;
      advanceAfterSlide(current.sponsorId, current.mediaIndex, sec);
    },
    [current, advanceAfterSlide],
  );

  useEffect(() => {
    if (!playbackTelemetry || !current) return;
    const segmentKey = sponsorTelemetrySegmentKey(
      playbackTelemetry.matchId,
      playbackTelemetry.matchStatus,
      section,
    );
    if (!segmentKey) return;

    const startedAtMs = Date.now();
    const clipSessionId = `${playbackTelemetry.matchId}-${segmentKey}-${slideTick}-${current.sponsorId}-${current.mediaId}`;

    void reportSponsorClipStart({
      matchId: playbackTelemetry.matchId,
      segmentKey,
      sponsorId: current.sponsorId,
      mediaId: current.mediaId,
      expectedPlaySec: current.playSec,
      clipSessionId,
      startedAtMs,
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
      const actualSec = (Date.now() - startedAtMs) / 1000;
      void reportSponsorClipEnd({ ...ended, actualSec });
    };
  }, [current, slideTick, section, playbackTelemetry]);

  useEffect(() => {
    if (current) playedClipRef.current = true;
  }, [current]);

  const slideMs =
    current != null
      ? current.item.type === "VIDEO" && videoProgressDurationMs > 0
        ? videoProgressDurationMs
        : Math.max(1500, current.playSec * 1000)
      : 0;
  const slideElapsed = useTimedSlideProgress(
    showPreviewProgress && current ? slideMs : 0,
    current ? `${current.sponsorId}-${current.mediaId}-${slideTick}` : "none",
  );

  if (activeSponsors.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
        <div className="text-white/40 text-[56px]">No sponsors configured</div>
      </div>
    );
  }

  const showBudgetFallback =
    fallback != null &&
    !cycleBudgetForever &&
    !current &&
    playedClipRef.current;

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {showBudgetFallback ? (
        <div className="absolute inset-0 size-full">{fallback}</div>
      ) : (
        <AnimatePresence mode="sync">
        {current && (
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
              onVideoEnded={handleVideoEnded}
              onVideoPlaybackFault={() => {
                if (!current || current.item.type !== "VIDEO") return;
                if (videoFallbackTimerRef.current != null) {
                  clearTimeout(videoFallbackTimerRef.current);
                  videoFallbackTimerRef.current = null;
                }
                advanceAfterSlide(
                  current.sponsorId,
                  current.mediaIndex,
                  current.playSec,
                );
              }}
              onVideoDurationMs={(ms) => {
                if (ms > 0) setVideoProgressDurationMs(ms);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      )}
      {showPreviewProgress && current && slideMs > 0 && (
        <PreviewSlideProgressBar elapsed01={slideElapsed} totalMs={slideMs} />
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
  onVideoEnded,
  onVideoPlaybackFault,
  onVideoDurationMs,
}: {
  item: MediaItem;
  objectFit: "cover" | "contain";
  onVideoEnded: (actualSec: number) => void;
  /** Decode-/netwerkfout: clip kan geen `ended` geven; ga door zonder volledige buffertime-out. */
  onVideoPlaybackFault?: () => void;
  onVideoDurationMs?: (ms: number) => void;
}) {
  const src = mediaUrl(item.path);
  const videoRef = useRef<HTMLVideoElement>(null);
  const endedRef = useRef(false);

  useEffect(() => {
    endedRef.current = false;
  }, [item.id, item.path]);

  useEffect(() => {
    if (item.type !== "VIDEO" || !(item.playAudio ?? false)) return;
    const v = videoRef.current;
    if (!v) return;
    const id = window.setTimeout(() => void v.play().catch(() => {}), 0);
    return () => clearTimeout(id);
  }, [item.id, item.path, item.playAudio, item.type]);

  const fireEndedOnce = (video: HTMLVideoElement) => {
    if (endedRef.current) return;
    endedRef.current = true;
    const d = video.duration;
    const useDur =
      Number.isFinite(d) && d > 0 ? d : Math.max(0.1, video.currentTime || 0);
    onVideoEnded(useDur);
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
    },
    onEnded: (e: SyntheticEvent<HTMLVideoElement>) => {
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
