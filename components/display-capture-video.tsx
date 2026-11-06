"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { DisplayMediaStage } from "@/components/display-media-stage";
import { DisplayVideo } from "@/components/display-video";
import { DISPLAY_COVER_MEDIA_STYLE } from "@/lib/display-cover-media-style";
import type { ExternalCaptureVideoHandle } from "@/components/external-capture-video";
import { useDisplayPreviewPlayback } from "@/lib/use-display-preview-playback";

function videoIsLive(video: HTMLVideoElement | null): boolean {
  return Boolean(
    video && !video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0,
  );
}

/**
 * Kopie van het stadionscherm als laag, zoals venstercapture in OBS: het LED-venster speelt het
 * beeld; deze laag toont dezelfde pixels, zonder de wedstrijd een tweede keer te decoderen.
 */
export const DisplayCaptureVideo = forwardRef<
  ExternalCaptureVideoHandle,
  { className?: string; onActive?: () => void }
>(function DisplayCaptureVideo({ className = "", onActive }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { stream, jpeg } = useDisplayPreviewPlayback(true);
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;

  useImperativeHandle(
    ref,
    () => ({
      isPlaying: () => videoIsLive(videoRef.current) || Boolean(jpeg),
    }),
    [jpeg],
  );

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) {
      void el.play().catch(() => {});
      onActiveRef.current?.();
    }
    return () => {
      el.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    if (!stream && jpeg) onActiveRef.current?.();
  }, [stream, jpeg]);

  return (
    <DisplayMediaStage>
      <DisplayVideo
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className={className}
        style={DISPLAY_COVER_MEDIA_STYLE}
      />
      {!stream && jpeg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={jpeg} alt="" className={className} style={DISPLAY_COVER_MEDIA_STYLE} />
      ) : null}
    </DisplayMediaStage>
  );
});
