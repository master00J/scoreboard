"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FIT_MIN_SCALE, fitScale } from "@/lib/fit-to-box";

/**
 * Krimpt zijn inhoud tot die binnen de beschikbare breedte past.
 *
 * Een vuistregel per teken laat altijd een geval over waarin het misgaat; meten niet. De inhoud
 * houdt zijn eigen lettergrootte en wordt alleen verkleind als het anders niet past, nooit vergroot.
 *
 * Werkt ook binnen een geschaald stadionscherm: we vergelijken kind met ouder binnen dezelfde
 * schaal, dus de verhouding klopt ongeacht de zoom van de ScaleContainer.
 */
export function FitToBox({
  children,
  className = "",
  style,
  minScale = FIT_MIN_SCALE,
  onFitChange,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  minScale?: number;
  /** Meldt of het ook verkleind nog paste; de editor kan daarmee waarschuwen. */
  onFitChange?: (fits: boolean) => void;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  /** De schaal die nu op de inhoud staat; nodig om de meting ervan te kunnen terugrekenen. */
  const scaleRef = useRef(1);
  const reported = useRef<boolean | null>(null);

  useEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content) return;

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // De eigen schaal eruit rekenen, anders meten we onze vorige verkleining mee.
        const current = scaleRef.current;
        const needed = content.scrollWidth / (current || 1);
        const available = box.clientWidth;
        const next = fitScale(needed, available, minScale);
        if (Math.abs(next - current) > 0.005) {
          scaleRef.current = next;
          setScale(next);
        }
        const fits = needed * next <= available + 1;
        if (reported.current !== fits) {
          reported.current = fits;
          onFitChange?.(fits);
        }
      });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(content);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // onFitChange bewust niet in de lijst: een nieuwe functie per render zou blijven hermeten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minScale]);

  return (
    <div ref={outer} className={`min-w-0 max-w-full ${className}`} style={style}>
      <div
        ref={inner}
        style={
          scale === 1
            ? undefined
            : { transform: `scale(${scale})`, transformOrigin: "center center" }
        }
      >
        {children}
      </div>
    </div>
  );
}
