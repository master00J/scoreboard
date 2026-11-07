"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { DisplayMediaStage } from "@/components/display-media-stage";
import { DisplayVideo } from "@/components/display-video";
import { captureMediaStyle } from "@/lib/display-cover-media-style";
import {
  NETWORK_SOURCE_CODEC_CANDIDATES,
  NETWORK_SOURCE_H264_CODEC,
} from "@/lib/network-source";

export type NetworkCaptureVideoHandle = {
  isPlaying: () => boolean;
};

/** Hoeveel seconde beeld we achter de voorsprong aanhouden; minder geeft haperingen. */
const TARGET_DELAY_SEC = 0.35;
/** Loopt het verder achter dan dit, dan springen we vooruit in plaats van achterstand op te sparen. */
const MAX_DELAY_SEC = 1.5;
/** Zoveel seconde bewaren we achter de speelkop; de rest gooien we weg of MSE loopt vol. */
const KEEP_BEHIND_SEC = 8;
/** Komt er binnen deze tijd geen bruikbaar init-segment, dan vragen we ffmpeg te herstarten. */
const INIT_WAIT_MS = 4000;

function pickCodec(mode: "copy" | "h264"): string | null {
  const supported = (type: string) =>
    typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(type);
  if (mode === "h264") return supported(NETWORK_SOURCE_H264_CODEC) ? NETWORK_SOURCE_H264_CODEC : null;
  return NETWORK_SOURCE_CODEC_CANDIDATES.find(supported) ?? null;
}

type NetworkCaptureVideoProps = {
  className?: string;
  /** Speler kan de stream niet spelen (bron weg, codec niet ondersteund). */
  onError?: (message: string) => void;
  /** Er loopt beeld. */
  onActive?: () => void;
};

/**
 * Speelt de netwerkbron (RTSP, UDP, SRT, RTMP) af in de streampagina.
 *
 * Het hoofdproces laat ffmpeg de stream hermuxen naar fragmented MP4 en stuurt die stukken hierheen.
 * Deze speler vult ze aan in een MediaSource, zodat Chromium decodeert op de draad van de renderer
 * en de beeldpomp in het hoofdproces alleen maar het venster hoeft te fotograferen — net als bij
 * een camera op een capture-kaart.
 *
 * Twee dingen houden de vertraging klein: de speelkop blijft dicht bij de voorsprong van de buffer,
 * en alles ouder dan een paar seconde gaat eruit. Zonder dat loopt een wedstrijd van twee uur vol
 * en spaart de speler stilletjes vertraging op.
 */
export const NetworkCaptureVideo = forwardRef<NetworkCaptureVideoHandle, NetworkCaptureVideoProps>(
  function NetworkCaptureVideo({ className = "", onError, onActive }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    useImperativeHandle(
      ref,
      () => ({
        isPlaying: () => {
          const video = videoRef.current;
          return Boolean(
            video &&
              !video.paused &&
              video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
              video.videoWidth > 0,
          );
        },
      }),
      [],
    );

    const cbRef = useRef({ onError, onActive });
    cbRef.current = { onError, onActive };

    useEffect(() => {
      const api = window.electronAPI;
      const video = videoRef.current;
      if (!api || !video) return;

      let disposed = false;
      let mediaSource: MediaSource | null = null;
      let sourceBuffer: SourceBuffer | null = null;
      let objectUrl: string | null = null;
      /** Stukken die nog niet aangevuld zijn; MSE neemt er maar één tegelijk. */
      let queue: ArrayBuffer[] = [];
      let codecReported = false;
      let announcedActive = false;
      let initTimer: number | null = null;
      let mode: "copy" | "h264" = "copy";

      const fail = (message: string) => {
        if (disposed) return;
        cbRef.current.onError?.(message);
      };

      /**
       * De pagina kan herladen zijn terwijl de bron al liep. Dan is het init-segment voorbij en
       * kunnen we niets met wat er nu binnenkomt: laat ffmpeg opnieuw beginnen.
       */
      const armInitWatch = () => {
        if (initTimer != null) window.clearTimeout(initTimer);
        initTimer = window.setTimeout(() => {
          if (disposed || announcedActive) return;
          api.requestNetworkSourceInit?.();
          armInitWatch();
        }, INIT_WAIT_MS);
      };

      const trim = () => {
        const sb = sourceBuffer;
        if (!sb || sb.updating || !video) return;
        try {
          if (sb.buffered.length === 0) return;
          const start = sb.buffered.start(0);
          const cutoff = video.currentTime - KEEP_BEHIND_SEC;
          if (cutoff > start + 1) sb.remove(start, cutoff);
        } catch {
          /* remove mag weigeren terwijl er nog iets loopt; volgende keer dan */
        }
      };

      /** Houdt de speelkop dicht bij de voorsprong, zodat vertraging niet oploopt. */
      const keepUp = () => {
        const sb = sourceBuffer;
        if (!sb || !video || sb.buffered.length === 0) return;
        const end = sb.buffered.end(sb.buffered.length - 1);
        if (video.currentTime < end - MAX_DELAY_SEC) {
          video.currentTime = Math.max(0, end - TARGET_DELAY_SEC);
        }
        if (video.paused) void video.play().catch(() => undefined);
      };

      const pump = () => {
        const sb = sourceBuffer;
        if (!sb || sb.updating || queue.length === 0) return;
        const chunk = queue.shift();
        if (!chunk) return;
        try {
          sb.appendBuffer(chunk);
        } catch (e) {
          const name = e instanceof Error ? e.name : "";
          if (name === "QuotaExceededError") {
            // Buffer vol: oud beeld eruit en dit stuk opnieuw proberen.
            queue.unshift(chunk);
            trim();
            return;
          }
          // Een stuk dat MSE niet aanvaardt betekent bijna altijd: deze codec kan hij niet.
          reportCodecProblem(e instanceof Error ? e.message : String(e));
        }
      };

      const reportCodecProblem = (detail: string) => {
        if (codecReported) return;
        codecReported = true;
        queue = [];
        if (mode === "copy") {
          // Een H.265-camera: laat het hoofdproces hercoderen naar H.264 en opnieuw beginnen.
          api.reportNetworkSourceCodecUnsupported?.();
          return;
        }
        fail(`Beeld van de netwerkbron kan niet gespeeld worden: ${detail}`);
      };

      const teardown = () => {
        if (initTimer != null) {
          window.clearTimeout(initTimer);
          initTimer = null;
        }
        queue = [];
        const sb = sourceBuffer;
        sourceBuffer = null;
        const ms = mediaSource;
        mediaSource = null;
        try {
          if (ms && sb && ms.readyState === "open") ms.removeSourceBuffer(sb);
        } catch {
          /* al afgebroken */
        }
        try {
          if (ms && ms.readyState === "open") ms.endOfStream();
        } catch {
          /* al afgebroken */
        }
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
        if (video) video.removeAttribute("src");
      };

      const build = (nextMode: "copy" | "h264") => {
        teardown();
        if (disposed) return;
        mode = nextMode;
        codecReported = false;
        announcedActive = false;
        const codec = pickCodec(nextMode);
        if (!codec) {
          if (nextMode === "copy") {
            api.reportNetworkSourceCodecUnsupported?.();
            return;
          }
          fail("Deze computer kan H.264 niet afspelen in de stream.");
          return;
        }
        const ms = new MediaSource();
        mediaSource = ms;
        objectUrl = URL.createObjectURL(ms);
        video.src = objectUrl;
        video.muted = true;
        ms.addEventListener("sourceopen", () => {
          if (disposed || mediaSource !== ms) return;
          try {
            const sb = ms.addSourceBuffer(codec);
            // Een live stream heeft geen doorlopende tijdlijn vanaf nul: laat MSE de stukken
            // achter elkaar zetten in de volgorde waarin ze binnenkomen.
            sb.mode = "sequence";
            sb.addEventListener("updateend", () => {
              if (disposed) return;
              if (!announcedActive && video.videoWidth > 0) {
                announcedActive = true;
                if (initTimer != null) {
                  window.clearTimeout(initTimer);
                  initTimer = null;
                }
                cbRef.current.onActive?.();
              }
              trim();
              keepUp();
              pump();
            });
            sb.addEventListener("error", () => reportCodecProblem("aanvullen mislukt"));
            sourceBuffer = sb;
            pump();
          } catch (e) {
            reportCodecProblem(e instanceof Error ? e.message : String(e));
          }
        });
        armInitWatch();
      };

      const offReset = api.onNetworkSourceReset?.((info) => {
        if (disposed) return;
        build(info?.mode === "h264" ? "h264" : "copy");
      });

      const offChunk = api.onNetworkSourceChunk?.((chunk) => {
        if (disposed || !chunk || chunk.byteLength === 0) return;
        if (!mediaSource) build(mode);
        // Niet eindeloos opsparen als de speler vastloopt: dan is oud beeld toch waardeloos.
        if (queue.length > 240) queue = queue.slice(-120);
        // Alleen kopiëren als het niet al een eigen buffer is; via IPC is dat meestal zo.
        queue.push(
          chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength
            ? (chunk.buffer as ArrayBuffer)
            : (chunk.slice().buffer as ArrayBuffer),
        );
        pump();
      });

      build("copy");
      // De pagina kan later zijn geladen dan de bron; vraag meteen een nieuw init-segment.
      api.requestNetworkSourceInit?.();

      const keepUpTimer = window.setInterval(() => {
        if (!disposed) keepUp();
      }, 1000);

      return () => {
        disposed = true;
        window.clearInterval(keepUpTimer);
        offChunk?.();
        offReset?.();
        teardown();
      };
    }, []);

    return (
      <DisplayMediaStage>
        <DisplayVideo
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={className}
          style={captureMediaStyle(className)}
        />
      </DisplayMediaStage>
    );
  },
);
