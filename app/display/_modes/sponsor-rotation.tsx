"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { DISPLAY_COVER_MEDIA_STYLE } from "@/lib/display-cover-media-style";
import type { Playlist, PlaylistItemFull } from "@/lib/types";
import { mediaUrl } from "@/lib/media-url";
import {
  PreviewSlideProgressBar,
  useTimedSlideProgress,
} from "../_components/preview-slide-progress";

export function SponsorRotation({
  playlist,
  preferredItemId,
  mediaObjectFit = "cover",
  showPreviewProgress = false,
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

  if (items.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
        <div className="text-white/40 text-[56px]">No media configured</div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <AnimatePresence mode="sync">
        <motion.div
          key={current.id + "-" + index}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="absolute inset-0 size-full min-h-0 min-w-0"
        >
          <MediaRenderer item={current} objectFit={mediaObjectFit} />
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
}: {
  item: PlaylistItemFull;
  objectFit: "cover" | "contain";
}) {
  const src = mediaUrl(item.media.path);
  const videoRef = useRef<HTMLVideoElement>(null);
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
            className="max-h-full max-w-full"
            style={{ objectFit: "contain", objectPosition: "center" }}
          />
        ) : (
          <img
            src={src}
            alt={item.media.title}
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
          style={DISPLAY_COVER_MEDIA_STYLE}
        />
      </div>
    );
  }
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <img src={src} alt={item.media.title} style={DISPLAY_COVER_MEDIA_STYLE} />
    </div>
  );
}
