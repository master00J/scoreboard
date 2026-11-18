"use client";

import { useEffect, useRef } from "react";
import { DISPLAY_CONTAIN_MEDIA_STYLE } from "@/lib/display-cover-media-style";
import type { MediaItem } from "@/lib/types";

export function StreamHdMedia({
  src,
  type,
  title,
  onEnded,
  onMediaError,
}: {
  src: string;
  type: MediaItem["type"];
  title: string;
  onEnded?: (video: HTMLVideoElement) => void;
  onMediaError?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const errorRef = useRef(onMediaError);
  errorRef.current = onMediaError;
  const monitor = !!onMediaError;
  useEffect(() => {
    const video = videoRef.current;
    if (!monitor || !video) return;
    let lastTime = video.currentTime;
    let changedAt = performance.now();
    const timer = window.setInterval(() => {
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        changedAt = performance.now();
      } else if (!video.ended && performance.now() - changedAt >= 8000) {
        errorRef.current?.();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [src, type, monitor]);
  if (type === "VIDEO") {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        ref={videoRef}
        onError={onMediaError}
        key={src}
        src={src}
        style={DISPLAY_CONTAIN_MEDIA_STYLE}
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={(e) => onEnded?.(e.currentTarget)}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img onError={onMediaError} key={src} src={src} alt={title} style={DISPLAY_CONTAIN_MEDIA_STYLE} />
  );
}
