"use client";

import { useMemo } from "react";
import { isVideoMediaPath, sanitizeMediaPath } from "@/lib/livestream";
import { mediaUrl } from "@/lib/media-url";

export function StreamMediaPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const mediaPath = sanitizeMediaPath(params.get("path") ?? "");
  const loop = params.get("loop") !== "0";
  const src = mediaUrl(mediaPath);

  if (!mediaPath || !src) {
    return <div className="h-full w-full bg-black" />;
  }

  if (isVideoMediaPath(mediaPath)) {
    return (
      <video
        key={src}
        src={src}
        autoPlay
        playsInline
        loop={loop}
        className="h-full w-full bg-black object-contain"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={src} src={src} alt="" className="h-full w-full bg-black object-contain" />
  );
}
