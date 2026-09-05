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
export const ExternalCaptureVideo = forwardRef<
  ExternalCaptureVideoHandle,
  {
    sourceId: string;
    className?: string;
    /** Audio doorgeven aan output (bv. vMix-feed met commentaar). Standaard uit. */
    audio?: boolean;
    /** Forceer HD-resolutie op cameras/capture-kaarten. Standaard aan. */
    preferHighRes?: boolean;
    /** Alleen bij geslaagde play + echt beeld (niet bij getUserMedia-fout). */
    onReady?: () => void;
  }
>(function ExternalCaptureVideo(
  { sourceId, className = "", audio = false, preferHighRes = true, onReady },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useImperativeHandle(ref, () => ({
    isPlaying: () => videoIsLive(videoRef.current),
  }));

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    void (async () => {
      try {
        stream = await getCaptureStream(sourceId, { audio, preferHighRes });
        const video = videoRef.current;
        if (cancelled || !video) return;
        video.srcObject = stream;
        video.muted = !audio;
        await video.play();
        if (cancelled) return;
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) {
          await new Promise<void>((resolve) => {
            const done = () => {
              video.removeEventListener("loadeddata", done);
              resolve();
            };
            video.addEventListener("loadeddata", done);
            window.setTimeout(done, 4000);
          });
        }
        if (!cancelled && videoIsLive(video)) onReadyRef.current?.();
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
});
