"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { fitScale } from "@/lib/fit-scale";

/**
 * Houdt een tekst (score, klok, stand, naam) binnen zijn vak op het scherm. Na het tekenen meet de hook
 * hoe breed en hoog de tekst is, met de vergroting van het vak (`boost`, de "Tekstgrootte") erbij. Is dat
 * meer dan het vak, dan krimpt de tekst met een schaal tot hij past. Past hij al, dan verandert er niets.
 *
 * Het vak is de dichtstbijzijnde ouder met `data-fit-box`. Zet de ref op het element dat zo breed is als
 * zijn tekst (een flex-item of inline element), niet op een blok dat de volle breedte neemt.
 */
export function useFitToBox<T extends HTMLElement>(
  boost = 1,
  origin: CSSProperties["transformOrigin"] = "center",
): { ref: React.RefObject<T | null>; style: CSSProperties } {
  const ref = useRef<T | null>(null);
  const [scale, setScale] = useState(1);

  const measure = useCallback(() => {
    const el = ref.current;
    const box = el?.closest<HTMLElement>("[data-fit-box]");
    if (!el || !box) return;
    const next = fitScale(
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: box.clientWidth, height: box.clientHeight },
      boost,
    );
    setScale((prev) => (Math.abs(prev - next) < 0.005 ? prev : next));
  }, [boost]);

  // Na elke render opnieuw meten: een andere score of tijd kan breder zijn.
  useLayoutEffect(() => {
    measure();
  });

  // Ook als het vak of de tekst van grootte verandert (lettertype geladen, vak versleept).
  useEffect(() => {
    const el = ref.current;
    const box = el?.closest<HTMLElement>("[data-fit-box]");
    if (!el || !box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    observer.observe(box);
    return () => observer.disconnect();
  }, [measure]);

  return { ref, style: scale < 1 ? { transform: `scale(${scale})`, transformOrigin: origin } : {} };
}
