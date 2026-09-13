"use client";

import { DISPLAY_CONTAIN_MEDIA_STYLE } from "@/lib/display-cover-media-style";
import type { MediaItem } from "@/lib/types";

export function StreamHdMedia({
  src,
  type,
  title,
  onEnded,
}: {
  src: string;
  type: MediaItem["type"];
  title: string;
  onEnded?: (video: HTMLVideoElement) => void;
}) {
  if (type === "VIDEO") {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
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
    <img key={src} src={src} alt={title} style={DISPLAY_CONTAIN_MEDIA_STYLE} />
  );
}
