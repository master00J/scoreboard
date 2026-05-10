"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { DISPLAY_COVER_MEDIA_STYLE } from "@/lib/display-cover-media-style";
import { releaseHtmlVideoElement } from "@/lib/html-video-release";
import type { Playlist, PlaylistItemFull } from "@/lib/types";
import { mediaUrl } from "@/lib/media-url";
import { reportDisplayPlaybackToMain } from "@/lib/report-display-playback";
import {
  reportDisplayMediaDiagnostic,
  videoElementDiagnosticFields,
} from "@/lib/report-display-media-diagnostic";
import {
  PreviewSlideProgressBar,
  useTimedSlideProgress,
} from "../_components/preview-slide-progress";

/** Minimale mediabeschrijving voor lege-playlist fallback (instellingen / thuislogo). */
export type IdleEmptyFallback = {
  logoUrl: string | null;
  media: {
    path: string;
    type: string;
    title: string;
    durationSec: number;
    playAudio?: boolean | null;
  } | null;
};

function FallbackMediaSlide({
  media,
  objectFit,
  mediaDiagEnabled = false,
}: {
  media: NonNullable<IdleEmptyFallback["media"]>;
  objectFit: "cover" | "contain";
  /** Alleen stadionscherm: log HTML-video-events naar boot.log */
  mediaDiagEnabled?: boolean;
}) {
  const src = mediaUrl(media.path);
  const videoRef = useRef<HTMLVideoElement>(null);

  const logDiag = (event: string, v?: HTMLVideoElement | null) => {
    if (!mediaDiagEnabled || media.type !== "VIDEO") return;
    const el = v ?? videoRef.current;
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
        source: "idle-fallback",
        event,
        mediaId: media.path,
        mediaTitle: media.title,
        mediaPath: media.path,
        ...videoElementDiagnosticFields(el),
        atMs: Date.now(),
      },
      throttleMs,
    );
  };
  useEffect(() => {
    if (media.type !== "VIDEO") return;
    return () => {
      releaseHtmlVideoElement(videoRef.current);
    };
  }, [media.path, media.type]);
  useEffect(() => {
    if (media.type !== "VIDEO" || !(media.playAudio ?? false)) return;
    const v = videoRef.current;
    if (!v) return;
    const id = window.setTimeout(() => void v.play().catch(() => {}), 0);
    return () => clearTimeout(id);
  }, [media.path, media.playAudio, media.type]);

  if (objectFit === "contain") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        {media.type === "VIDEO" ? (
          <video
            ref={videoRef}
            key={src}
            src={src}
            autoPlay
            loop
            muted={!(media.playAudio ?? false)}
            playsInline
            preload="metadata"
            className="max-h-full max-w-full"
            style={{ objectFit: "contain", objectPosition: "center" }}
            onLoadedMetadata={(e) => logDiag("loaded_metadata", e.currentTarget)}
            onStalled={(e) => logDiag("stalled", e.currentTarget)}
            onWaiting={(e) => logDiag("waiting", e.currentTarget)}
            onSuspend={(e) => logDiag("suspend", e.currentTarget)}
            onError={(e) => logDiag("error", e.currentTarget)}
          />
        ) : (
          <img
            src={src}
            alt={media.title}
            decoding="async"
            className="max-h-full max-w-full"
            style={{ objectFit: "contain", objectPosition: "center" }}
          />
        )}
      </div>
    );
  }
  if (media.type === "VIDEO") {
    return (
      <div className="absolute inset-0 overflow-hidden bg-black">
        <video
          ref={videoRef}
          key={src}
          src={src}
          autoPlay
          loop
          muted={!(media.playAudio ?? false)}
          playsInline
          preload="metadata"
          style={DISPLAY_COVER_MEDIA_STYLE}
          onLoadedMetadata={(e) => logDiag("loaded_metadata", e.currentTarget)}
          onStalled={(e) => logDiag("stalled", e.currentTarget)}
          onWaiting={(e) => logDiag("waiting", e.currentTarget)}
          onSuspend={(e) => logDiag("suspend", e.currentTarget)}
          onError={(e) => logDiag("error", e.currentTarget)}
        />
      </div>
    );
  }
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <img src={src} alt={media.title} decoding="async" style={DISPLAY_COVER_MEDIA_STYLE} />
    </div>
  );
}

function IdleEmptyVisual({
  fallback,
  mediaObjectFit,
  mediaDiagEnabled = false,
}: {
  fallback: IdleEmptyFallback;
  mediaObjectFit: "cover" | "contain";
  mediaDiagEnabled?: boolean;
}) {
  const { media, logoUrl } = fallback;
  const [imgTick, setImgTick] = useState(0);
  useEffect(() => {
    if (!media || media.type === "VIDEO") return;
    const durMs = Math.max(1500, Math.max(1, media.durationSec) * 1000);
    const id = window.setInterval(() => setImgTick((n) => n + 1), durMs);
    return () => clearInterval(id);
  }, [media]);

  if (media) {
    return (
      <div className="absolute inset-0 overflow-hidden bg-black">
        {media.type === "VIDEO" ? (
          <FallbackMediaSlide media={media} objectFit={mediaObjectFit} mediaDiagEnabled={mediaDiagEnabled} />
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={`${media.path}-${imgTick}`}
              initial={false}
              animate={{ opacity: 1 }}
              exit={{ opacity: 1 }}
              transition={{ duration: 0 }}
              className="absolute inset-0 size-full min-h-0 min-w-0"
            >
              <FallbackMediaSlide media={media} objectFit={mediaObjectFit} mediaDiagEnabled={mediaDiagEnabled} />
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    );
  }
  if (logoUrl) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
        <img
          src={logoUrl}
          alt=""
          className="max-h-[55%] max-w-[55%] object-contain opacity-95"
        />
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
      <div className="text-white/40 text-[56px] tracking-wide text-center px-8">
        Geen media geconfigureerd
      </div>
    </div>
  );
}

export function SponsorRotation({
  playlist,
  preferredItemId,
  mediaObjectFit = "cover",
  showPreviewProgress = false,
  idleEmptyFallback = null,
}: {
  playlist: Playlist | null;
  /** Kept for backwards-compat callers but no longer used: the component
   *  always fills its container (`absolute inset-0`). */
  fullscreen?: boolean;
  preferredItemId?: string | null;
  /** Standaard `cover` (vult het vlak, bijsnijden ok). */
  mediaObjectFit?: "cover" | "contain";
  /** Alleen in control-ingebouwde preview: voortgang resterende slidetijd. */
  showPreviewProgress?: boolean;
  /** Bij lege playlist: voorkeur gekozen clubmedia, anders thuislogo, anders tekst. */
  idleEmptyFallback?: IdleEmptyFallback | null;
}) {
  const items = useMemo(
    () => playlist?.items.filter((i) => i.media.active) ?? [],
    [playlist?.id, playlist?.items],
  );
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [playlist?.id]);

  useEffect(() => {
    if (!preferredItemId) return;
    const idx = items.findIndex((i) => i.id === preferredItemId);
    if (idx >= 0) setIndex(idx);
  }, [preferredItemId, items]);

  const currentForTimer = items[index];

  useEffect(() => {
    if (items.length === 0 || !currentForTimer) return;
    const durMs = Math.max(
      1500,
      (currentForTimer.durationOverrideSec ??
        currentForTimer.media.durationSec) *
        1000,
    );
    const id = setTimeout(() => {
      setIndex((i) => (i + 1) % items.length);
    }, durMs);
    return () => clearTimeout(id);
  }, [
    items.length,
    index,
    currentForTimer?.id,
    currentForTimer?.durationOverrideSec,
    currentForTimer?.media.durationSec,
  ]);

  const current = items[index];
  const slideMs =
    current != null
      ? Math.max(
          1500,
          (current.durationOverrideSec ?? current.media.durationSec) * 1000,
        )
      : 0;
  const slideElapsed = useTimedSlideProgress(
    showPreviewProgress ? slideMs : 0,
    current ? `${current.id}-${index}` : "none",
  );

  useEffect(() => {
    if (showPreviewProgress) return;
    if (!current) return;
    reportDisplayPlaybackToMain({
      source: "sponsor-rotation",
      mode: "playlist",
      mediaId: current.media.id,
      mediaTitle: current.media.title,
      mediaPath: current.media.path,
      mediaType: current.media.type,
      playlistId: playlist?.id ?? null,
      atMs: Date.now(),
    });
  }, [current, playlist?.id, showPreviewProgress]);

  if (items.length === 0) {
    if (idleEmptyFallback && (idleEmptyFallback.media || idleEmptyFallback.logoUrl)) {
      return (
        <div className="absolute inset-0 overflow-hidden bg-black">
          <IdleEmptyVisual fallback={idleEmptyFallback} mediaObjectFit={mediaObjectFit} mediaDiagEnabled={!showPreviewProgress} />
        </div>
      );
    }
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
        <div className="text-white/40 text-[56px] tracking-wide text-center px-8">
          Geen media geconfigureerd
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-hidden bg-black contain-layout contain-paint">
      <AnimatePresence mode="wait">
        <motion.div
          key={current.id + "-" + index}
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 1 }}
          transition={{ duration: 0 }}
          className="absolute inset-0 size-full min-h-0 min-w-0"
        >
          <MediaRenderer
            item={current}
            objectFit={mediaObjectFit}
            mediaDiagEnabled={!showPreviewProgress}
          />
        </motion.div>
      </AnimatePresence>
      {showPreviewProgress && slideMs > 0 && (
        <PreviewSlideProgressBar elapsed01={slideElapsed} totalMs={slideMs} />
      )}
    </div>
  );
}

function MediaRenderer({
  item,
  objectFit,
  mediaDiagEnabled = false,
}: {
  item: PlaylistItemFull;
  objectFit: "cover" | "contain";
  mediaDiagEnabled?: boolean;
}) {
  const src = mediaUrl(item.media.path);
  const videoRef = useRef<HTMLVideoElement>(null);

  const logDiag = (event: string, v?: HTMLVideoElement | null) => {
    if (!mediaDiagEnabled || item.media.type !== "VIDEO") return;
    const el = v ?? videoRef.current;
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
        source: "sponsor-rotation",
        event,
        mediaId: item.media.id,
        mediaTitle: item.media.title,
        mediaPath: item.media.path,
        ...videoElementDiagnosticFields(el),
        atMs: Date.now(),
      },
      throttleMs,
    );
  };

  useEffect(() => {
    if (item.media.type !== "VIDEO") return;
    return () => {
      releaseHtmlVideoElement(videoRef.current);
    };
  }, [item.media.id, item.media.path, item.media.type]);

  useEffect(() => {
    if (item.media.type !== "VIDEO" || !(item.media.playAudio ?? false)) return;
    const v = videoRef.current;
    if (!v) return;
    const id = window.setTimeout(() => void v.play().catch(() => {}), 0);
    return () => clearTimeout(id);
  }, [item.media.id, item.media.path, item.media.playAudio, item.media.type]);

  if (objectFit === "contain") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        {item.media.type === "VIDEO" ? (
          <video
            ref={videoRef}
            key={src}
            src={src}
            autoPlay
            muted={!(item.media.playAudio ?? false)}
            playsInline
            preload="metadata"
            className="max-h-full max-w-full"
            style={{ objectFit: "contain", objectPosition: "center" }}
            onLoadedMetadata={(e) => logDiag("loaded_metadata", e.currentTarget)}
            onStalled={(e) => logDiag("stalled", e.currentTarget)}
            onWaiting={(e) => logDiag("waiting", e.currentTarget)}
            onSuspend={(e) => logDiag("suspend", e.currentTarget)}
            onError={(e) => logDiag("error", e.currentTarget)}
          />
        ) : (
          <img
            src={src}
            alt={item.media.title}
            decoding="async"
            className="max-h-full max-w-full"
            style={{ objectFit: "contain", objectPosition: "center" }}
          />
        )}
      </div>
    );
  }
  if (item.media.type === "VIDEO") {
    return (
      <div className="absolute inset-0 overflow-hidden bg-black">
        <video
          ref={videoRef}
          key={src}
          src={src}
          autoPlay
          muted={!(item.media.playAudio ?? false)}
          playsInline
          preload="metadata"
          style={DISPLAY_COVER_MEDIA_STYLE}
          onLoadedMetadata={(e) => logDiag("loaded_metadata", e.currentTarget)}
          onStalled={(e) => logDiag("stalled", e.currentTarget)}
          onWaiting={(e) => logDiag("waiting", e.currentTarget)}
          onSuspend={(e) => logDiag("suspend", e.currentTarget)}
          onError={(e) => logDiag("error", e.currentTarget)}
        />
      </div>
    );
  }
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <img src={src} alt={item.media.title} decoding="async" style={DISPLAY_COVER_MEDIA_STYLE} />
    </div>
  );
}
