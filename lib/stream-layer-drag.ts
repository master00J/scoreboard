/**
 * Rekenwerk achter het rode kader op de studiomonitors (`stream-layer-editor.tsx`). Alles in % van
 * het programmabeeld, zoals de scènelaag zelf.
 */
import { LAYER_RECT_MIN, type StreamLayerCrop, type StreamLayerRect } from "./stream-scenes";

export type LayerHandle = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

/** Binnen zoveel % klikt een rand vast aan de rand of het midden van het beeld (Ctrl: niet). */
const SNAP_PCT = 1.5;

export function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** % van het programmabeeld → pixels van de stream (1920×1080 of 1280×720). */
export function pctToPx(pct: number, size: number): number {
  return Math.round((pct / 100) * size);
}

export function pxToPct(px: number, size: number): number {
  return r2((px / Math.max(1, size)) * 100);
}

export function rectToPixels(
  rect: StreamLayerRect,
  canvasW: number,
  canvasH: number,
): { x: number; y: number; w: number; h: number; left: number; top: number; right: number; bottom: number } {
  const x = pctToPx(rect.x, canvasW);
  const y = pctToPx(rect.y, canvasH);
  const w = pctToPx(rect.w, canvasW);
  const h = pctToPx(rect.h, canvasH);
  return { x, y, w, h, left: x, top: y, right: canvasW - x - w, bottom: canvasH - y - h };
}

export function pixelsToRect(
  px: { x: number; y: number; w: number; h: number },
  canvasW: number,
  canvasH: number,
): StreamLayerRect {
  return {
    x: pxToPct(px.x, canvasW),
    y: pxToPct(px.y, canvasH),
    w: pxToPct(px.w, canvasW),
    h: pxToPct(px.h, canvasH),
  };
}

export function snapEdge(value: number, size: number, enabled: boolean): number {
  if (!enabled) return value;
  for (const target of [0, 50 - size / 2, 100 - size]) {
    if (Math.abs(value - target) < SNAP_PCT) return target;
  }
  return value;
}

/** Nieuw kader voor een greep, met de oorspronkelijke verhouding (hoeken) tenzij `free`. */
export function resizeRect(
  start: StreamLayerRect,
  handle: Exclude<LayerHandle, "move">,
  dx: number,
  dy: number,
  free: boolean,
): StreamLayerRect {
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.startsWith("n");
  const south = handle.startsWith("s");
  const corner = (west || east) && (north || south);
  let w = start.w + (east ? dx : west ? -dx : 0);
  let h = start.h + (south ? dy : north ? -dy : 0);
  if (corner && !free) {
    const k = Math.max(w / start.w, h / start.h, LAYER_RECT_MIN / start.w, LAYER_RECT_MIN / start.h);
    w = start.w * k;
    h = start.h * k;
  }
  w = Math.max(LAYER_RECT_MIN, w);
  h = Math.max(LAYER_RECT_MIN, h);
  return {
    x: r2(west ? start.x + start.w - w : start.x),
    y: r2(north ? start.y + start.h - h : start.y),
    w: r2(w),
    h: r2(h),
  };
}

/**
 * Bijsnijden met Alt + een rand, zoals in OBS: de rand eet in de bron en het kader krimpt mee, dus
 * de rest van het beeld blijft staan waar het stond.
 */
export function cropFromHandle(
  startRect: StreamLayerRect,
  startCrop: StreamLayerCrop,
  handle: Exclude<LayerHandle, "move">,
  dx: number,
  dy: number,
): { rect: StreamLayerRect; crop: StreamLayerCrop } {
  const rect = { ...startRect };
  const crop = { ...startCrop };
  const spanX = 100 - startCrop.left - startCrop.right;
  const spanY = 100 - startCrop.top - startCrop.bottom;
  const perX = spanX / startRect.w;
  const perY = spanY / startRect.h;
  if (handle.includes("w")) {
    const d = Math.min(Math.max(dx, -startCrop.left / perX), startRect.w - LAYER_RECT_MIN);
    crop.left = startCrop.left + d * perX;
    rect.x = startRect.x + d;
    rect.w = startRect.w - d;
  }
  if (handle.includes("e")) {
    const d = Math.min(Math.max(-dx, -startCrop.right / perX), startRect.w - LAYER_RECT_MIN);
    crop.right = startCrop.right + d * perX;
    rect.w = startRect.w - d;
  }
  if (handle.startsWith("n")) {
    const d = Math.min(Math.max(dy, -startCrop.top / perY), startRect.h - LAYER_RECT_MIN);
    crop.top = startCrop.top + d * perY;
    rect.y = startRect.y + d;
    rect.h = startRect.h - d;
  }
  if (handle.startsWith("s")) {
    const d = Math.min(Math.max(-dy, -startCrop.bottom / perY), startRect.h - LAYER_RECT_MIN);
    crop.bottom = startCrop.bottom + d * perY;
    rect.h = startRect.h - d;
  }
  return {
    rect: { x: r2(rect.x), y: r2(rect.y), w: r2(rect.w), h: r2(rect.h) },
    crop: { top: r2(crop.top), right: r2(crop.right), bottom: r2(crop.bottom), left: r2(crop.left) },
  };
}
