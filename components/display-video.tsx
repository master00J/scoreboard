"use client";

import {
  forwardRef,
  useEffect,
  useRef,
  type CSSProperties,
  type MutableRefObject,
  type Ref,
  type VideoHTMLAttributes,
} from "react";
import { releaseHtmlVideoElement } from "@/lib/html-video-release";

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else (ref as MutableRefObject<T | null>).current = value;
}

/**
 * Video voor het stadionscherm: decodeert op volle grootte en kopieert frames naar canvas.
 * Native overlay naast het L-frame is op Windows zwart; canvas zit in dezelfde laag als de score.
 */
export const DisplayVideo = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLVideoElement>>(
  function DisplayVideo({ style, className, ...props }, ref) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const objectFit = (style?.objectFit as CSSProperties["objectFit"]) ?? "cover";

    useEffect(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      let stopped = false;
      let raf = 0;
      let looping = false;

      const paint = () => {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w < 2 || h < 2) return;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, w, h);
      };

      const tick = () => {
        if (stopped) return;
        looping = true;
        paint();
        const playing = !video.paused && !video.ended && video.readyState >= 2;
        if (playing) raf = requestAnimationFrame(tick);
        else looping = false;
      };

      const tryPlay = () => {
        if (stopped || props.autoPlay === false) return;
        void video.play().catch(() => {});
      };

      const ensureLoop = () => {
        if (stopped || looping) return;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(tick);
      };

      video.addEventListener("loadeddata", tryPlay);
      video.addEventListener("canplay", tryPlay);
      video.addEventListener("playing", ensureLoop);
      video.addEventListener("timeupdate", ensureLoop);
      video.addEventListener("pause", paint);
      video.addEventListener("ended", paint);
      tick();
      tryPlay();

      return () => {
        stopped = true;
        looping = false;
        cancelAnimationFrame(raf);
        video.removeEventListener("loadeddata", tryPlay);
        video.removeEventListener("canplay", tryPlay);
        video.removeEventListener("playing", ensureLoop);
        video.removeEventListener("timeupdate", ensureLoop);
        video.removeEventListener("pause", paint);
        video.removeEventListener("ended", paint);
      };
    }, [props.src, props.autoPlay]);

    /**
     * Decoder vrijgeven bij unmount. Dit moet hier met het element uit de mount: in een
     * effect-cleanup van de ouder is `ref.current` op dat moment al `null`, waardoor de
     * release daar nooit iets deed. Alleen een losgekoppeld element: StrictMode-cleanups
     * en hergebruik van dezelfde node met een nieuwe `src` laten we met rust.
     */
    useEffect(() => {
      const video = videoRef.current;
      return () => {
        if (video && !video.isConnected) releaseHtmlVideoElement(video);
      };
    }, []);

    return (
      <div className="absolute inset-0 overflow-hidden bg-black">
        <video
          {...props}
          ref={(el) => {
            videoRef.current = el;
            assignRef(ref, el);
          }}
          className={className}
          disablePictureInPicture
          playsInline
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit,
            objectPosition: style?.objectPosition ?? "center",
            opacity: 0.02,
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        <canvas
          ref={canvasRef}
          aria-hidden
          className="absolute inset-0 h-full w-full"
          style={{
            display: "block",
            objectFit,
            objectPosition: style?.objectPosition ?? "center",
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
      </div>
    );
  },
);
