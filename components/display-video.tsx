"use client";

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
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
    const paintedRef = useRef(false);
    const [painted, setPainted] = useState(false);
    const objectFit = (style?.objectFit as CSSProperties["objectFit"]) ?? "cover";
    const hideUntilReady = style?.opacity === 0;

    useEffect(() => {
      paintedRef.current = false;
      setPainted(false);
    }, [props.src]);

    useEffect(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      type RvfcVideo = HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
        cancelVideoFrameCallback?: (handle: number) => void;
      };
      const rvfcVideo = video as RvfcVideo;

      let stopped = false;
      let raf = 0;
      let rvfc = 0;
      let looping = false;
      let ctx: CanvasRenderingContext2D | null = null;
      let lastPaintTime = -1;

      const paint = (force = false) => {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w < 2 || h < 2) return;
        const t = video.currentTime;
        if (!force && t === lastPaintTime && paintedRef.current) return;
        lastPaintTime = t;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          ctx = null;
        }
        if (!ctx) {
          ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
        }
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, w, h);
        if (!paintedRef.current) {
          paintedRef.current = true;
          setPainted(true);
        }
      };

      const playingNow = () =>
        !video.paused && !video.ended && video.readyState >= 2;

      const tickRaf = () => {
        if (stopped) return;
        looping = true;
        paint();
        if (playingNow()) raf = requestAnimationFrame(tickRaf);
        else looping = false;
      };

      const tickRvfc = () => {
        if (stopped) return;
        looping = true;
        paint();
        if (!playingNow() || !rvfcVideo.requestVideoFrameCallback) {
          looping = false;
          return;
        }
        rvfc = rvfcVideo.requestVideoFrameCallback(tickRvfc);
      };

      const tryPlay = () => {
        if (stopped || props.autoPlay === false) return;
        void video.play().catch(() => {});
      };

      const ensureLoop = () => {
        if (stopped || looping) return;
        if (rvfcVideo.requestVideoFrameCallback) {
          rvfc = rvfcVideo.requestVideoFrameCallback(tickRvfc);
          looping = true;
          return;
        }
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(tickRaf);
      };

      const paintHold = () => paint(true);
      const onWaiting = () => {
        looping = false;
      };

      video.addEventListener("loadeddata", tryPlay);
      video.addEventListener("canplay", tryPlay);
      video.addEventListener("playing", ensureLoop);
      video.addEventListener("timeupdate", ensureLoop);
      video.addEventListener("waiting", onWaiting);
      video.addEventListener("pause", paintHold);
      video.addEventListener("ended", paintHold);
      ensureLoop();
      tryPlay();

      return () => {
        stopped = true;
        looping = false;
        cancelAnimationFrame(raf);
        rvfcVideo.cancelVideoFrameCallback?.(rvfc);
        video.removeEventListener("loadeddata", tryPlay);
        video.removeEventListener("canplay", tryPlay);
        video.removeEventListener("playing", ensureLoop);
        video.removeEventListener("timeupdate", ensureLoop);
        video.removeEventListener("waiting", onWaiting);
        video.removeEventListener("pause", paintHold);
        video.removeEventListener("ended", paintHold);
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

    const showFrame = painted && !hideUntilReady;
    return (
      <div className={`absolute inset-0 overflow-hidden ${showFrame ? "bg-black" : ""}`}>
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
            opacity: showFrame ? 1 : 0,
          }}
        />
      </div>
    );
  },
);
