"use client";

import { useMemo } from "react";
import { ExternalCaptureVideo } from "@/components/external-capture-video";
import { NetworkCaptureVideo } from "@/components/network-capture-video";
import { StreamLayerFrame } from "@/components/stream-layer-frame";
import { isVideoMediaPath, type LivestreamVideoInput } from "@/lib/livestream";
import { mediaUrl } from "@/lib/media-url";
import { layerColorSupported, type StreamScene } from "@/lib/stream-scenes";

export type SceneLayerHandle = { isPlaying: () => boolean } | null;

/**
 * Alle lagen van een beeld-in-beeld-scène in de streampagina: camera's, mediabestanden en één
 * netwerkbron, elk in zijn eigen kader.
 *
 * De volgorde in de DOM blijft altijd dezelfde (op laag-id); wat boven ligt bepaalt `z-index`. Een
 * `<video>` die React in de DOM verplaatst, pauzeert: dan zou een camera even stilstaan zodra je een
 * laag naar voren haalt.
 */
export function StreamSceneLayers({
  scene,
  inputs,
  liveCameras = true,
  liveNetwork = true,
  registerHandle,
  onActive,
}: {
  scene: StreamScene;
  inputs: LivestreamVideoInput[];
  /** Uit in de studio terwijl de stream loopt: dan heeft het streamvenster de camera's. */
  liveCameras?: boolean;
  /** De netwerkbron speelt alleen in het streamvenster, waar het hoofdproces de stukken heen stuurt. */
  liveNetwork?: boolean;
  registerHandle?: (layerId: string, handle: SceneLayerHandle) => void;
  onActive?: () => void;
}) {
  const ordered = useMemo(
    () => [...scene.layers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    [scene.layers],
  );
  /** Eén ontvanger voor de netwerkbron: alleen de eerste laag daarvan speelt hem af. */
  const networkLayerId = scene.layers.find(
    (layer) => inputs.find((input) => input.id === layer.inputId)?.kind === "network",
  )?.id;

  return (
    // Eigen stapelvolgorde (isolate): de lagen blijven onder de score, sponsors en kaarten.
    <div className="absolute inset-0 isolate" data-stream-scene-layers>
      {ordered.map((layer) => {
        const input = inputs.find((item) => item.id === layer.inputId);
        const z = scene.layers.findIndex((item) => item.id === layer.id);
        if (!input) return null;
        const placeholder = (className: string) => (
          <div className={`${className} grid place-items-center bg-zinc-900 text-[2vmin] text-white/50`}>
            {input.name}
          </div>
        );
        let content: (className: string) => React.ReactNode = placeholder;
        if (input.kind === "camera" && input.cameraDevice && liveCameras) {
          content = (className) => (
            <ExternalCaptureVideo
              ref={(handle) => registerHandle?.(layer.id, handle)}
              sourceId={input.cameraDevice}
              className={className}
              onActive={onActive}
            />
          );
        } else if (input.kind === "network" && liveNetwork && layer.id === networkLayerId) {
          content = (className) => (
            <NetworkCaptureVideo
              ref={(handle) => registerHandle?.(layer.id, handle)}
              className={className}
              onActive={onActive}
            />
          );
        } else if (input.kind === "media" && input.mediaPath) {
          const src = mediaUrl(input.mediaPath);
          content = (className) =>
            isVideoMediaPath(input.mediaPath) ? (
              // Zonder geluid: het geluid van een mediabestand loopt via de mixer, niet via dit venster.
              <video key={src} src={src} autoPlay muted playsInline loop={input.mediaLoop} className={className} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt="" className={className} />
            );
        }
        return (
          <div key={layer.id} className="absolute inset-0" style={{ zIndex: z }} data-stream-scene-layer={layer.id}>
            <StreamLayerFrame layer={layer} colorSupported={layerColorSupported(input.kind, true)}>
              {content}
            </StreamLayerFrame>
          </div>
        );
      })}
    </div>
  );
}
