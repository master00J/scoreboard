"use client";

import { useEffect, useRef, useState } from "react";

type ScaleVariant = "fullscreen" | "embedded";

/**
 * Fixed 1920×1080 logisch canvas.
 * - `fullscreen` (projector): schaal **cover** (`Math.max`) — vult het venster, geen zwarte rand door aspectverschil.
 * - `embedded` (live preview in control): **contain** (`Math.min`) — hele scorebord zichtbaar in het vak.
 */
export function ScaleContainer({
  children,
  background = "#000",
  variant = "fullscreen",
}: {
  children: React.ReactNode;
  background?: string;
  variant?: ScaleVariant;
}) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    function update() {
      if (variant === "fullscreen") {
        const w = window.innerWidth;
        const h = window.innerHeight;
        setScale(Math.max(w / 1920, h / 1080) || 1);
        return;
      }
      const el = outerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const s = Math.min(r.width / 1920, r.height / 1080);
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
  }, [variant]);

  const clipW = 1920 * scale;
  const clipH = 1080 * scale;

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
          width: 1920,
          height: 1080,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
          position: "absolute",
          left: 0,
          top: 0,
          background: "#050607",
        }}
      >
        {children}
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
