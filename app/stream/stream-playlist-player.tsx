"use client";

import { useEffect, useRef, useState } from "react";
import { isVideoMediaPath } from "@/lib/livestream";
import { mediaUrl } from "@/lib/media-url";
import { nextPlaylistIndex, playlistHoldMs, type LivestreamPlaylistItem } from "@/lib/stream-playlist";

/**
 * Speelt de items van een livestream-afspeellijst af: video tot het einde (of tot de ingestelde
 * duur), afbeeldingen zolang de operator heeft gezet, daarna het volgende item.
 */
export function StreamPlaylistPlayer({
  items,
  loop,
  className,
  muted = true,
  onActive,
}: {
  items: LivestreamPlaylistItem[];
  loop: boolean;
  className?: string;
  muted?: boolean;
  onActive?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const reported = useRef(false);
  const errors = useRef(0);
  const pathsKey = items.map((item) => item.path).join("|");

  useEffect(() => {
    setIndex(0);
    errors.current = 0;
  }, [pathsKey]);

  useEffect(() => {
    if (index >= items.length && items.length > 0) setIndex(0);
  }, [index, items.length]);

  const item = items[index];
  const src = item ? mediaUrl(item.path) : "";
  const video = Boolean(item && isVideoMediaPath(item.path));
  const holdMs = item ? playlistHoldMs(item) : null;
  const loopThis = Boolean(loop && items.length === 1 && video && holdMs == null);

  const markActive = () => {
    if (reported.current) return;
    reported.current = true;
    onActive?.();
  };

  const advance = (fromError = false) => {
    if (fromError) {
      errors.current += 1;
      if (errors.current >= Math.max(items.length, 1)) return;
    } else {
      errors.current = 0;
    }
    const next = nextPlaylistIndex(index, items.length, loop);
    if (next != null) setIndex(next);
  };

  useEffect(() => {
    if (holdMs == null) return;
    const timer = window.setTimeout(() => advance(), holdMs);
    return () => window.clearTimeout(timer);
    // item/index wisselt de timer; loop hoort bij het einde van de lijst.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.durationSec, holdMs, index, loop, items.length]);

  if (!item || !src) {
    return <div className={`${className ?? ""} bg-black`} />;
  }

  if (video) {
    return (
      <video
        key={`${item.id}:${src}`}
        src={src}
        autoPlay
        muted={muted}
        playsInline
        loop={loopThis}
        className={className}
        onPlaying={markActive}
        onEnded={loopThis ? undefined : () => advance()}
        onError={() => advance(true)}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={`${item.id}:${src}`}
      src={src}
      alt=""
      className={className}
      onLoad={markActive}
      onError={() => advance(true)}
    />
  );
}
