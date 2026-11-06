"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  layerCssFilter,
  layerCssPlacement,
  layerFramingIsIdentity,
  type StreamSceneLayer,
} from "@/lib/stream-scenes";

/** Zolang de bron zijn formaat nog niet meldde: 16:9, zoals bijna elke camera. */
const FALLBACK_SIZE = { w: 1920, h: 1080 };

function pct(value: number): string {
  return `${value}%`;
}

/**
 * Zet één bron (video of beeld) in het kader van zijn scènelaag, met CSS. De boom is altijd
 * dezelfde (vak → binnenvak → bron), ook zonder kader: anders zou de camera opnieuw openen zodra
 * je het kader voor het eerst verschuift. Zonder kader vult de bron het vlak en past hij in
 * (`object-contain`), precies zoals vóór de scènes.
 *
 * `children` krijgt de className voor de bron zelf.
 */
export function StreamLayerFrame({
  layer,
  colorSupported = true,
  children,
}: {
  layer: StreamSceneLayer | null | undefined;
  /** Uit voor bronnen waarvan de stream geen kleur kan aanpassen (zie `layerColorSupported`). */
  colorSupported?: boolean;
  children: (mediaClassName: string) => ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const framed = Boolean(layer) && !layerFramingIsIdentity(layer);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const read = () => {
      const media = box.querySelector("video, img");
      let w = 0;
      let h = 0;
      if (media instanceof HTMLVideoElement) {
        w = media.videoWidth;
        h = media.videoHeight;
      } else if (media instanceof HTMLImageElement) {
        w = media.naturalWidth;
        h = media.naturalHeight;
      }
      if (w > 0 && h > 0) setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    read();
    // Deze gebeurtenissen borrelen niet op, maar komen in de capture-fase wel langs het vak.
    const events = ["loadedmetadata", "resize", "load"] as const;
    for (const name of events) box.addEventListener(name, read, true);
    return () => {
      for (const name of events) box.removeEventListener(name, read, true);
    };
  }, []);

  let boxStyle: CSSProperties = { left: 0, top: 0, width: "100%", height: "100%" };
  let mediaStyle: CSSProperties = { left: 0, top: 0, width: "100%", height: "100%" };
  if (layer && framed) {
    const source = size ?? FALLBACK_SIZE;
    const placed = layerCssPlacement(source.w, source.h, layer);
    boxStyle = { left: pct(placed.box.x), top: pct(placed.box.y), width: pct(placed.box.w), height: pct(placed.box.h) };
    mediaStyle = {
      left: pct(placed.media.x),
      top: pct(placed.media.y),
      width: pct(placed.media.w),
      height: pct(placed.media.h),
    };
  }
  if (layer && !layer.visible) boxStyle.visibility = "hidden";
  if (layer && colorSupported) {
    const filter = layerCssFilter(layer);
    if (filter) boxStyle.filter = filter;
    if (layer.opacity !== 100) boxStyle.opacity = layer.opacity / 100;
  }

  return (
    <div ref={boxRef} className="absolute overflow-hidden" style={boxStyle} data-stream-layer-frame>
      <div className="absolute" style={mediaStyle}>
        {children(`absolute inset-0 h-full w-full ${framed ? "object-fill" : "object-contain"}`)}
      </div>
    </div>
  );
}
