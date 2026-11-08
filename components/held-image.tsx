"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { imageLayersAfterDecoded, imageLayersAfterPainted } from "@/lib/held-image-layers";

/** Toon het nieuwe beeld hoe dan ook na deze tijd, ook als `load` uitblijft. */
const SHOW_ANYWAY_MS = 2000;
/** Zo lang na `load` van het bovenste beeld blijft het vorige eronder liggen. */
const DROP_BELOW_MS = 120;

/**
 * Afbeelding in het mediavak die bij een wissel het vorige beeld laat staan tot het nieuwe
 * geladen is. Zo is er geen leeg (zwart) tussenbeeld. Bij de eerste afbeelding is het vak,
 * net als voorheen, even leeg tot ze geladen is.
 *
 * Bewust zonder `img.decode()` en `requestAnimationFrame`: in een venster dat Chromium als
 * verborgen ziet, worden die nooit afgerond. `decoding="sync"` laat het beeld decoderen in de
 * frame waarin het voor het eerst getekend wordt, en timers lopen altijd door.
 */
export function HeldImage({ src, style }: { src: string; style?: CSSProperties }) {
  const [layers, setLayers] = useState<string[]>([]);

  useEffect(() => {
    if (!src) {
      setLayers([]);
      return;
    }
    let done = false;
    const preload = new Image();
    const show = () => {
      if (done) return;
      done = true;
      window.clearTimeout(fallback);
      setLayers((current) => imageLayersAfterDecoded(current, src));
    };
    const fallback = window.setTimeout(show, SHOW_ANYWAY_MS);
    // Ook bij een fout tonen: een kapotte afbeelding gaf voorheen een leeg vak, en dat blijft zo.
    preload.onload = show;
    preload.onerror = show;
    preload.src = src;
    if (preload.complete) show();
    return () => {
      done = true;
      window.clearTimeout(fallback);
      preload.onload = null;
      preload.onerror = null;
    };
  }, [src]);

  const top = layers[layers.length - 1];
  const below = layers.length > 1;

  useEffect(() => {
    if (!below || !top) return;
    // Vangnet als `load` van het bovenste beeld nooit komt: niet eeuwig twee beelden stapelen.
    const id = window.setTimeout(
      () => setLayers((current) => imageLayersAfterPainted(current, top)),
      SHOW_ANYWAY_MS,
    );
    return () => window.clearTimeout(id);
  }, [below, top]);

  const dropBelow = (painted: string) => {
    window.setTimeout(
      () => setLayers((current) => imageLayersAfterPainted(current, painted)),
      DROP_BELOW_MS,
    );
  };

  return (
    <>
      {layers.map((layer) => (
        <img
          key={layer}
          src={layer}
          alt=""
          decoding="sync"
          style={style}
          onLoad={layer === top && below ? () => dropBelow(layer) : undefined}
          onError={layer === top && below ? () => dropBelow(layer) : undefined}
        />
      ))}
    </>
  );
}
