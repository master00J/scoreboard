"use client";

import { useEffect, useRef } from "react";
import { getCaptureStream } from "@/lib/get-desktop-capture-stream";
import { DISPLAY_COVER_MEDIA_STYLE } from "@/lib/display-cover-media-style";

/** Live capture: desktop/venster (desktopCapturer-id) of webcam (`camera:deviceId`). */
export function ExternalCaptureVideo({
  sourceId,
  className = "",
}: {
  sourceId: string;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    void (async () => {
      try {
        stream = await getCaptureStream(sourceId);
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      } catch (err) {
        console.error("[ExternalCaptureVideo]", err);
      }
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [sourceId]);

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      autoPlay
      className={className}
      style={DISPLAY_COVER_MEDIA_STYLE}
    />
  );
}
