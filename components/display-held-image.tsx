"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { heldImageToContinue, type HeldImageMemory } from "@/lib/display-handover";

/** Langer dan dit blijft het vorige beeld niet staan, ook als het volgende zich niet klaar meldt. */
const MAX_HOLD_MS = 1000;

/** Wat elk vak nu toont of net toonde, en welk element dat meldde. */
const slotMemory = new Map<string, HeldImageMemory & { owner: object }>();

/**
 * Beeld dat pas wisselt als het volgende klaar is om te tonen.
 *
 * Krijgt dit element een ander beeld, dan blijft het vorige staan tot het nieuwe geladen en
 * gedecodeerd is. Zonder dat staat het vak een moment leeg bij elke wissel. De eerste keer
 * gedraagt het zich als een gewone `<img>`.
 *
 * Met `slot` geldt hetzelfde tussen elementen die om beurten hetzelfde vak vullen: een nieuw
 * element begint met het beeld dat daar stond en wisselt zodra het zijne klaar is.
 */
export function DisplayHeldImage({
  src,
  style,
  slot,
}: {
  src: string;
  style?: CSSProperties;
  /** Naam van het vak op het scherm, gedeeld door alle elementen die het om beurten vullen. */
  slot?: string;
}) {
  const [continued] = useState(() =>
    slot ? heldImageToContinue(slotMemory.get(slot), performance.now()) : null,
  );
  const [shown, setShown] = useState(continued ?? src);
  // Een overgenomen beeld stond er al en is dus gedecodeerd.
  const [swapped, setSwapped] = useState(continued != null);
  const owner = useRef({}).current;

  useEffect(() => {
    if (!slot) return;
    slotMemory.set(slot, { src: shown, leftAtMs: null, owner });
    return () => {
      const memory = slotMemory.get(slot);
      if (memory?.owner === owner) memory.leftAtMs = performance.now();
    };
  }, [slot, shown, owner]);

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
