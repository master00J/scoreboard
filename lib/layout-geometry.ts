/** Slepen, vergroten en magnetisch uitlijnen van vakken op het canvas. Alles in procenten. */
import type { LayoutSlot } from "./scoreboard-theme";

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const RESIZE_HANDLES: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/** Binnen deze afstand (in %) springt een rand of midden naar een hulplijn. */
export const SNAP_EPS = 0.55;
export const GRID_PCT = [10, 20, 30, 40, 60, 70, 80, 90];
export const THIRD_PCT = [100 / 3, 200 / 3];

export function nearPct(a: number, b: number, eps = SNAP_EPS): boolean {
  return Math.abs(a - b) <= eps;
}

export function boxEdges(box: LayoutSlot) {
  return {
    left: box.x,
    right: box.x + box.w,
    cx: box.x + box.w / 2,
    top: box.y,
    bottom: box.y + box.h,
    cy: box.y + box.h / 2,
  };
}

/** Lijnen waar een vak naartoe kan springen: canvasranden, midden, derden, raster en andere vakken. */
export function snapTargets(others: LayoutSlot[]): { vertical: number[]; horizontal: number[] } {
  const vertical = [0, 50, 100, ...THIRD_PCT, ...GRID_PCT];
  const horizontal = [...vertical];
  for (const other of others) {
    const e = boxEdges(other);
    vertical.push(e.left, e.cx, e.right);
    horizontal.push(e.top, e.cy, e.bottom);
  }
  return { vertical, horizontal };
}

function snapTo(value: number, targets: number[]): number {
  let best = value;
  let bestDistance = SNAP_EPS;
  for (const target of targets) {
    const distance = Math.abs(value - target);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = target;
    }
  }
  return best;
}

/** Verplaatst vak: het midden of de linker-/bovenrand springt naar de dichtstbijzijnde lijn. */
export function snapMovedBox(box: LayoutSlot, others: LayoutSlot[]): LayoutSlot {
  const { vertical, horizontal } = snapTargets(others);
  const e = boxEdges(box);
  return {
    ...box,
    x: snapAxis(e.left, e.cx, box.w, vertical),
    y: snapAxis(e.top, e.cy, box.h, horizontal),
  };
}

/** Eén as: springt met het midden of met de begin-rand, wat het dichtst bij een lijn ligt. */
function snapAxis(start: number, center: number, size: number, targets: number[]): number {
  const snappedCenter = snapTo(center, targets);
  const snappedStart = snapTo(start, targets);
  const centerMoved = snappedCenter !== center;
  const startMoved = snappedStart !== start;
  if (!centerMoved && !startMoved) return start;
  if (!startMoved) return snappedCenter - size / 2;
  if (!centerMoved) return snappedStart;
  return Math.abs(snappedCenter - center) <= Math.abs(snappedStart - start) ? snappedCenter - size / 2 : snappedStart;
}

/**
 * Nieuwe maat na trekken aan een greep. Met `heightPerWidth` blijft de verhouding vast
 * (hoogte% = breedte% × die factor), bv. voor een videovak dat 16:9 moet blijven.
 */
export function resizeBox(
  box: LayoutSlot,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  heightPerWidth: number | null = null,
): LayoutSlot {
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  let x = box.x;
  let y = box.y;
  let w = box.w;
  let h = box.h;

  if (handle.includes("e")) w = box.w + dx;
  if (handle.includes("s")) h = box.h + dy;
  if (handle.includes("w")) {
    x = box.x + dx;
    w = right - x;
  }
  if (handle.includes("n")) {
    y = box.y + dy;
    h = bottom - y;
  }

  if (heightPerWidth && heightPerWidth > 0) {
    const fromW = handle.includes("e") || handle.includes("w");
    const fromH = handle.includes("n") || handle.includes("s");
    let width = box.w;
    if (fromW && fromH) width = Math.max(w, h / heightPerWidth);
    else if (fromW) width = w;
    else if (fromH) width = h / heightPerWidth;
    const height = width * heightPerWidth;
    x = handle.includes("w") ? right - width : box.x;
    y = handle.includes("n") ? bottom - height : box.y;
    w = width;
    h = height;
  }

  return { x, y, w, h };
}

/** Vergroot vak: de rand waaraan getrokken wordt springt naar de dichtstbijzijnde lijn. */
export function snapResizedBox(box: LayoutSlot, handle: ResizeHandle, others: LayoutSlot[]): LayoutSlot {
  const { vertical, horizontal } = snapTargets(others);
  let { x, y, w, h } = box;
  const right = x + w;
  const bottom = y + h;
  if (handle.includes("e")) w = snapTo(right, vertical) - x;
  if (handle.includes("w")) {
    x = snapTo(x, vertical);
    w = right - x;
  }
  if (handle.includes("s")) h = snapTo(bottom, horizontal) - y;
  if (handle.includes("n")) {
    y = snapTo(y, horizontal);
    h = bottom - y;
  }
  return { x, y, w, h };
}
