"use client";

import { useEffect, useState, type CSSProperties } from "react";

/** Langer dan dit blijft het vorige beeld niet staan, ook als het volgende zich niet klaar meldt. */
const MAX_HOLD_MS = 1000;

/**
 * Beeld dat pas wisselt als het volgende klaar is om te tonen.
 *
 * Krijgt dit element een ander beeld, dan blijft het vorige staan tot het nieuwe geladen en
 * gedecodeerd is. Zonder dat staat het vak een moment leeg bij elke wissel. De eerste keer
 * gedraagt het zich als een gewone `<img>`.
 */
export function DisplayHeldImage({ src, style }: { src: string; style?: CSSProperties }) {
  const [shown, setShown] = useState(src);
  const [swapped, setSwapped] = useState(false);

  useEffect(() => {
    if (src === shown) return;
    let cancelled = false;
    const next = new Image();
    const swap = () => {
      if (cancelled) return;
      setSwapped(true);
      setShown(src);
    };
    next.src = src;
    // Bij een fout ook wisselen: liever een ontbrekend beeld dan de vorige sponsor die blijft staan.
    if (typeof next.decode === "function") next.decode().then(swap, swap);
    else {
      next.onload = swap;
      next.onerror = swap;
    }
    // Een venster dat niet getekend wordt, meldt nooit dat het beeld klaar is. Dan toch wisselen.
    const fallback = window.setTimeout(swap, MAX_HOLD_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
    };
  }, [src, shown]);

  // Na een wissel is het beeld al gedecodeerd; "sync" zet het in hetzelfde frame neer als de wissel.
  return <img src={shown} alt="" decoding={swapped ? "sync" : "async"} style={style} />;
}
