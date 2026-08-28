"use client";

import { useEffect, useRef, useState } from "react";

type ScaleVariant = "fullscreen" | "embedded";
export type ScalingMode = "cover" | "contain" | "exact";

/**
 * Configureerbaar logisch canvas voor LED/projectie-output.
 * - `fullscreen` (stadiondisplay): standaard **cover** (vult, kan croppen).
 *   Met scalingMode=`contain`: alles zichtbaar, eventueel zwarte rand bij afwijkende aspect.
 *   Met scalingMode=`exact`: geen scaling, pixel-perfect 1:1 (ideaal voor native LED-resolutie).
 * - `embedded` (preview): altijd `contain` voor controlepaneel.
 *
 * Safe zone: optionele rand-overlay (alleen tijdens setup) als hulplijn voor LED-canvas
 * waarbij randen door de cabinets niet zichtbaar zijn.
 */
export function ScaleContainer({
  children,
  background = "#000",
  variant = "fullscreen",
  width = 1920,
  height = 1080,
  scalingMode = "cover",
  safeZoneVisible = false,
  safeZoneMarginPx = 40,
}: {
  children: React.ReactNode;
  background?: string;
  variant?: ScaleVariant;
  width?: number;
  height?: number;
  scalingMode?: ScalingMode;
  safeZoneVisible?: boolean;
  safeZoneMarginPx?: number;
}) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    function update() {
      if (variant === "fullscreen") {
        if (scalingMode === "exact") {
          setScale(1);
          return;
        }
        const w = window.innerWidth;
        const h = window.innerHeight;
        const calc =
          scalingMode === "contain"
            ? Math.min(w / width, h / height)
            : Math.max(w / width, h / height);
        setScale(calc || 1);
        return;
      }
      const el = outerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const s = Math.min(r.width / width, r.height / height);
      setScale(s > 0 ? s : 1);
    }

    update();

    if (variant === "fullscreen") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const el = outerRef.current;
    const ro = new ResizeObserver(() => update());
    if (el) ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [variant, width, height, scalingMode]);

  const clipW = width * scale;
  const clipH = height * scale;

  const safeZone = safeZoneVisible ? (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: safeZoneMarginPx,
        top: safeZoneMarginPx,
        right: safeZoneMarginPx,
        bottom: safeZoneMarginPx,
        border: "2px dashed rgba(34, 197, 94, 0.85)",
        borderRadius: 6,
        pointerEvents: "none",
        zIndex: 200,
        boxShadow: "0 0 0 9999px rgba(220, 38, 38, 0.10)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 4,
          left: 8,
          fontFamily: "ui-monospace, monospace",
          fontSize: 14,
          color: "rgba(34, 197, 94, 0.95)",
          background: "rgba(0,0,0,0.55)",
          padding: "2px 6px",
          borderRadius: 4,
        }}
      >
        SAFE ZONE · {width}×{height}
      </div>
    </div>
  ) : null;

  const scaledLogical = (
    <div
      style={{
        width: clipW,
        height: clipH,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
          position: "absolute",
          left: 0,
          top: 0,
          background: "#050607",
        }}
      >
        {children}
        {safeZone}
      </div>
    </div>
  );

  if (variant === "fullscreen") {
    return (
      <div ref={outerRef} className="fixed inset-0 overflow-hidden" style={{ background }}>
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            marginLeft: -(clipW / 2),
            marginTop: -(clipH / 2),
          }}
        >
          {scaledLogical}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={outerRef}
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
      style={{ background }}
    >
      {scaledLogical}
    </div>
  );
}
