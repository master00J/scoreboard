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
  onShown,
  onError,
  shownKey,
}: {
  src: string;
  style?: CSSProperties;
  /** Naam van het vak op het scherm, gedeeld door alle elementen die het om beurten vullen. */
  slot?: string;
  /**
   * Het eigen beeld (`src`) staat geladen en gedecodeerd op het scherm. Bewijs voor proof-of-play:
   * pas vanaf dit moment telt de schermtijd. Opnieuw gemeld als `shownKey` wisselt terwijl het
   * beeld al stond (dezelfde foto in een volgende cue).
   */
  onShown?: () => void;
  /** Het eigen beeld kon niet geladen of gedecodeerd worden: er stond niets van deze sponsor. */
  onError?: () => void;
  shownKey?: string | number;
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

  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const imgRef = useRef<HTMLImageElement>(null);
  /** Per beeld en `shownKey` één melding. */
  const reportedRef = useRef<string | null>(null);
  const reportKey = `${src}::${shownKey ?? ""}`;

  const reportShown = () => {
    if (reportedRef.current === reportKey) return;
    reportedRef.current = reportKey;
    onShownRef.current?.();
  };

  // Hetzelfde beeld stond er al (geen nieuwe load-event): meteen melden als het klaar is.
  useEffect(() => {
    if (shown !== src) return;
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) reportShown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, src, reportKey]);

  // Na een wissel is het beeld al gedecodeerd; "sync" zet het in hetzelfde frame neer als de wissel.
  return (
    <img
      ref={imgRef}
      src={shown}
      alt=""
      decoding={swapped ? "sync" : "async"}
      style={style}
      onLoad={(e) => {
        if (shown !== src) return;
        const img = e.currentTarget;
        if (typeof img.decode === "function") img.decode().then(reportShown, reportShown);
        else reportShown();
      }}
      onError={() => {
        if (shown !== src) return;
        onErrorRef.current?.();
      }}
    />
  );
}
