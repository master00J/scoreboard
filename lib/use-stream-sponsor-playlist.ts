"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { streamSponsorSlidesForSlot, type StreamSponsorSlide } from "./stream-sponsor-slides";
import type { StreamSponsorSlotView } from "./use-stream-sponsor-slot";
import type { Match } from "./types";

function mediaFingerprint(slot: StreamSponsorSlotView, match: Match | null): string {
  const media = slot.current?.media ?? [];
  const items = media.map((m) => `${m.id}:${m.path}:${m.active}:${m.type}:${m.durationSec}:${m.mediaCheckJson ?? ""}`).join("|");
  return [
    slot.current?.id ?? "",
    slot.section,
    slot.matchStatus ?? "",
    slot.current?.sponsorPlaybackOrderJson ?? "",
    slot.current?.sponsorPlaybackRepeatsJson ?? "",
    String(slot.current?.imageDefaultSec ?? ""),
    items,
    match?.id ?? "",
    match?.matchSponsorMediaId ?? "",
  ].join("::");
}

function looksLikeFalseEnded(video: HTMLVideoElement, catalogDur: number): boolean {
  const browserDur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  if (catalogDur >= 5 && browserDur === 0 && video.currentTime < 0.1) return true;
  return (
    catalogDur >= 12 &&
    browserDur > 0 &&
    browserDur <= 6 &&
    catalogDur >= browserDur + 6 &&
    video.currentTime + 3 < catalogDur
  );
}

export function useStreamSponsorPlaylist(slot: StreamSponsorSlotView, match: Match | null) {
  const fingerprint = mediaFingerprint(slot, match);
  const orderedSlides = useMemo(
    () => streamSponsorSlidesForSlot(slot, match),
    // fingerprint vangt media/pin-wijzigingen; slot/match zelf zouden elke tick resetten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fingerprint],
  );
  const [failed, setFailed] = useState<{ fingerprint: string; ids: string[] }>({ fingerprint: "", ids: [] });
  const slides = failed.fingerprint === fingerprint ? orderedSlides.filter(s => !failed.ids.includes(s.id)) : orderedSlides;
  const [index, setIndex] = useState(0);
  const endedRef = useRef(false);

  useEffect(() => {
    setIndex(0);
    endedRef.current = false;
  }, [fingerprint]);

  const slide = slides.length > 0 ? slides[index % slides.length]! : null;
  const next = slides.length > 1 ? slides[(index + 1) % slides.length]! : null;

  const advance = () => {
    if (slot.interrupted || slides.length === 0) return;
    endedRef.current = false;
    setIndex((n) => (n + 1) % slides.length);
  };

  useEffect(() => {
    if (!slide || slide.type === "VIDEO" || slot.interrupted) return;
    const id = window.setTimeout(advance, slide.durationSec * 1000);
    return () => window.clearTimeout(id);
  }, [index, slide?.id, slide?.type, slide?.durationSec, slot.interrupted, slides.length]);

  const onMediaError = () => {
    if (!slide) return;
    setFailed(previous => {
      const ids = previous.fingerprint === fingerprint ? previous.ids : [];
      return ids.includes(slide.id) ? previous : { fingerprint, ids: [...ids, slide.id] };
    });
    endedRef.current = false;
  };

  const onVideoEnded = (video: HTMLVideoElement) => {
    if (!slide || endedRef.current) return;
    if (looksLikeFalseEnded(video, slide.durationSec)) {
      onMediaError();
      return;
    }
    endedRef.current = true;
    advance();
  };

  return { slides, slide, next, advance, onVideoEnded, onMediaError };
}

export type { StreamSponsorSlide };
