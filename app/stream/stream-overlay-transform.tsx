"use client";

import { useRef, type PointerEvent, type ReactNode } from "react";
import { clampWidget } from "@/lib/stream-score-widget";

export type StreamOverlayTransformValue = {
  xPct: number;
  yPct: number;
  scale: number;
};

export function StreamOverlayTransform({
  xPct,
  yPct,
  scale,
  interactive,
  onChange,
  children,
}: {
  xPct: number;
  yPct: number;
  scale: number;
  interactive: boolean;
  onChange?: (next: StreamOverlayTransformValue, commit: boolean) => void;
  children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: "move" | "scale";
    startX: number;
    startY: number;
    start: StreamOverlayTransformValue;
    canvasW: number;
    canvasH: number;
    last: StreamOverlayTransformValue;
  } | null>(null);

  const begin = (e: PointerEvent<HTMLElement>, mode: "move" | "scale") => {
    if (!interactive || !onChange) return;
    e.preventDefault();
    e.stopPropagation();
    const box = boxRef.current;
    const canvas = box?.closest("[data-stream-canvas]");
    if (!box || !canvas) return;
    const cr = canvas.getBoundingClientRect();
    const start = { xPct, yPct, scale };
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      start,
      canvasW: Math.max(1, cr.width),
      canvasH: Math.max(1, cr.height),
      last: start,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const move = (e: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || !onChange) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const next: StreamOverlayTransformValue =
      drag.mode === "move"
        ? {
            xPct: clampWidget(drag.start.xPct + (dx / drag.canvasW) * 100, 0, 92),
            yPct: clampWidget(drag.start.yPct + (dy / drag.canvasH) * 100, 0, 92),
            scale: drag.start.scale,
          }
        : {
            xPct: drag.start.xPct,
            yPct: drag.start.yPct,
            scale: clampWidget(drag.start.scale + (dx + dy) / 420, 0.5, 2.5),
          };
    drag.last = next;
    onChange(next, false);
  };

  const end = () => {
    const drag = dragRef.current;
    if (!drag || !onChange) return;
    onChange(drag.last, true);
    dragRef.current = null;
  };

  return (
    <div
      ref={boxRef}
      className={`absolute z-40 ${interactive ? "cursor-move" : "pointer-events-none"}`}
      style={{
        left: `${xPct}%`,
        top: `${yPct}%`,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        fontFamily: "Inter, system-ui, sans-serif",
        outline: interactive ? "2px solid #38bdf8" : undefined,
        outlineOffset: 3,
      }}
      onPointerDown={(e) => begin(e, "move")}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {children}
      {interactive ? (
        <button
          type="button"
          aria-label="Resize"
          className="absolute -right-1.5 -bottom-1.5 h-3.5 w-3.5 cursor-se-resize rounded-sm border-2 border-white bg-sky-400 shadow"
          onPointerDown={(e) => begin(e, "scale")}
        />
      ) : null}
    </div>
  );
}
