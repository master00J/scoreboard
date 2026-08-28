"use client";

import { useEffect, useRef } from "react";
import { getCaptureStream } from "@/lib/get-desktop-capture-stream";
import { DisplayMediaStage } from "@/components/display-media-stage";
import { DISPLAY_COVER_MEDIA_STYLE } from "@/lib/display-cover-media-style";

/** Live capture: desktop/venster (desktopCapturer-id) of webcam (`camera:deviceId`). */
export function ExternalCaptureVideo({
  sourceId,
  className = "",
  audio = false,
  preferHighRes = true,
}: {
  sourceId: string;
  className?: string;
  /** Audio doorgeven aan output (bv. vMix-feed met commentaar). Standaard uit. */
  audio?: boolean;
  /** Forceer HD-resolutie op cameras/capture-kaarten. Standaard aan. */
  preferHighRes?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    void (async () => {
      try {
        stream = await getCaptureStream(sourceId, { audio, preferHighRes });
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        videoRef.current.muted = !audio;
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
  }, [sourceId, audio, preferHighRes]);

  return (
    <DisplayMediaStage>
      <video
        ref={videoRef}
        muted={!audio}
        playsInline
        autoPlay
        className={className}
        style={DISPLAY_COVER_MEDIA_STYLE}
      />
    </DisplayMediaStage>
  );
}
