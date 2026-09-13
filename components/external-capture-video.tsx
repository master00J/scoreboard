"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { getCaptureStream } from "@/lib/get-desktop-capture-stream";
import { DisplayMediaStage } from "@/components/display-media-stage";
import { DISPLAY_COVER_MEDIA_STYLE } from "@/lib/display-cover-media-style";

export type ExternalCaptureVideoHandle = {
  isPlaying: () => boolean;
};

function videoIsLive(video: HTMLVideoElement | null): boolean {
  return Boolean(video && !video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0);
}

/** Live capture: desktop/venster (desktopCapturer-id) of webcam (`camera:deviceId`). */
export function ExternalCaptureVideo({
  sourceId,
  className = "",
  audio = false,
  preferHighRes = true,
  onError,
  onActive,
  onEnded,
}: {
  sourceId: string;
  className?: string;
  /** Audio doorgeven aan output (bv. vMix-feed met commentaar). Standaard uit. */
  audio?: boolean;
  /** Forceer HD-resolutie op cameras/capture-kaarten. Standaard aan. */
  preferHighRes?: boolean;
  /** Capture kon niet starten (bron weg, geen rechten, driver bezet). */
  onError?: (message: string) => void;
  /** Stream loopt en levert beeld. */
  onActive?: () => void;
  /** Bron is tijdens de wedstrijd weggevallen (venster gesloten, kabel eruit). */
  onEnded?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Callbacks via ref: anders herstart de stream bij elke parent-render.
  const cbRef = useRef({ onError, onActive, onEnded });
  cbRef.current = { onError, onActive, onEnded };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    void (async () => {
      try {
        stream = await getCaptureStream(sourceId, { audio, preferHighRes });
        if (cancelled || !videoRef.current) {
          stream?.getTracks().forEach((t) => t.stop());
          return;
        }
        // Bron kan midden in de wedstrijd verdwijnen (venster dicht, HDMI eruit).
        stream.getTracks().forEach((track) => {
          track.addEventListener("ended", () => {
            if (!cancelled) cbRef.current.onEnded?.();
          });
        });
        videoRef.current.srcObject = stream;
        videoRef.current.muted = !audio;
        await videoRef.current.play().catch(() => {});
        if (!cancelled) cbRef.current.onActive?.();
      } catch (err) {
        console.error("[ExternalCaptureVideo]", err);
        if (!cancelled) {
          cbRef.current.onError?.(err instanceof Error ? err.message : String(err));
        }
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
