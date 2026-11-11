"use client";

import type { ReactNode } from "react";

/**
 * Scorebord blijft altijd getekend. Media komt eroverheen in de sponsor-fase.
 * Wisselt het rooster naar het bord, dan verdwijnt alleen de media-laag — het bord
 * hoeft niet opnieuw te mounten, dus geen zwart frame ertussen.
 */
export function DisplaySpreadLayers({
  scoreboard,
  showMedia,
  media,
}: {
  scoreboard: ReactNode;
  showMedia: boolean;
  media: ReactNode;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 z-0">{scoreboard}</div>
      {showMedia ? <div className="absolute inset-0 z-[2]">{media}</div> : null}
    </div>
  );
}
