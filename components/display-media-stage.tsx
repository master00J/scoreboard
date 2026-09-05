"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Grootste 16:9-kader in de parent. Gemeten in pixels — `cqw`/`cqh` vallen in
 * geneste of absolute vakken stil, waardoor het kader 0×0 werd en alleen zwart zichtbaar was.
 */
export function DisplayMediaStage({ children }: { children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const update = () => {
      // clientWidth/Height = layoutpixels vóór ScaleContainer-transform.
      // getBoundingClientRect() is al geschaald → video werd een thumbnail in de preview.
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width < 2 || height < 2) {
        setFrame(null);
        return;
      }
      const scale = Math.min(width / 16, height / 9);
      setFrame({ w: scale * 16, h: scale * 9 });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={hostRef} className="absolute inset-0 flex items-center justify-center bg-black">
      <div
        className="relative overflow-hidden bg-black"
        style={
          frame
            ? { width: frame.w, height: frame.h }
            : { position: "absolute", inset: 0 }
        }
      >
        {children}
      </div>
    </div>
  );
}
