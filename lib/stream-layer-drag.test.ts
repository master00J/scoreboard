import { describe, expect, it } from "vitest";
import { cropFromHandle, pctToPx, pixelsToRect, rectToPixels, resizeRect, snapEdge } from "./stream-layer-drag";
import { layerPlacement, createSceneLayer } from "./stream-scenes";

const full = { x: 0, y: 0, w: 100, h: 100 };
const noCrop = { top: 0, right: 0, bottom: 0, left: 0 };

describe("resizeRect", () => {
  it("keeps the aspect when pulling a corner", () => {
    expect(resizeRect(full, "se", -50, -10, false)).toEqual({ x: 0, y: 0, w: 90, h: 90 });
  });

  it("resizes freely with Shift", () => {
    expect(resizeRect(full, "se", -50, -10, true)).toEqual({ x: 0, y: 0, w: 50, h: 90 });
  });

  it("anchors the opposite corner", () => {
    expect(resizeRect(full, "nw", 50, 50, false)).toEqual({ x: 50, y: 50, w: 50, h: 50 });
    expect(resizeRect(full, "ne", -20, 20, false)).toEqual({ x: 0, y: 20, w: 80, h: 80 });
  });

  it("moves one side with an edge handle", () => {
    expect(resizeRect(full, "w", 30, 99, false)).toEqual({ x: 30, y: 0, w: 70, h: 100 });
    expect(resizeRect(full, "s", 99, -40, false)).toEqual({ x: 0, y: 0, w: 100, h: 60 });
  });

  it("never collapses the box", () => {
    const tiny = resizeRect(full, "se", -500, -500, false);
    expect(tiny.w).toBeGreaterThanOrEqual(2);
    expect(tiny.h).toBeGreaterThanOrEqual(2);
  });
});

describe("cropFromHandle", () => {
  it("eats into the source and shrinks the box, so the rest stays put", () => {
    const { rect, crop } = cropFromHandle(full, noCrop, "w", 25, 0);
    expect(crop.left).toBe(25);
    expect(rect).toEqual({ x: 25, y: 0, w: 75, h: 100 });
    // Wat overblijft staat op dezelfde pixels als voor het bijsnijden.
    const layer = createSceneLayer({ inputId: "v1", rect, crop, fit: "contain" });
    expect(layerPlacement(1920, 1080, layer, 1920, 1080)).toEqual({
      src: { x: 480, y: 0, w: 1440, h: 1080 },
      dst: { x: 480, y: 0, w: 1440, h: 1080 },
    });
  });

  it("uncrops when dragged back, but not past the source edge", () => {
    const { rect, crop } = cropFromHandle({ x: 25, y: 0, w: 75, h: 100 }, { ...noCrop, left: 25 }, "w", -60, 0);
    expect(crop.left).toBe(0);
    expect(rect.x).toBe(0);
    expect(rect.w).toBe(100);
  });

  it("crops two sides from a corner", () => {
    const { crop } = cropFromHandle(full, noCrop, "se", -10, -20);
    expect(crop.right).toBe(10);
    expect(crop.bottom).toBe(20);
  });
});

describe("rect pixels", () => {
  it("round-trips a 1920×1080 box", () => {
    const rect = { x: 10, y: 20, w: 30, h: 40 };
    const px = rectToPixels(rect, 1920, 1080);
    expect(px).toEqual({ x: 192, y: 216, w: 576, h: 432, left: 192, top: 216, right: 1152, bottom: 432 });
    expect(rectToPixels(pixelsToRect(px, 1920, 1080), 1920, 1080)).toEqual(px);
    expect(pctToPx(100, 1920)).toBe(1920);
  });
});

describe("snapEdge", () => {
  it("snaps to the edges and the middle of the frame", () => {
    expect(snapEdge(1, 40, true)).toBe(0);
    expect(snapEdge(59, 40, true)).toBe(60);
    expect(snapEdge(31, 40, true)).toBe(30);
    expect(snapEdge(10, 40, true)).toBe(10);
    expect(snapEdge(1, 40, false)).toBe(1);
  });
});
