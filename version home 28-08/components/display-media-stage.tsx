"use client";

import type { CSSProperties, ReactNode } from "react";

const STAGE_STYLE: CSSProperties = {
  containerType: "size",
};

/** Grootste 16:9-kader dat in de parent past (letterbox / pillarbox). */
const FRAME_STYLE: CSSProperties = {
  position: "relative",
  overflow: "hidden",
  background: "#000",
  width: "min(100%, calc(100cqh * 16 / 9))",
  height: "min(100%, calc(100cqw * 9 / 16))",
};

/**
 * LED-media blijft altijd 16:9, ook als het scorebordvak een ander formaat heeft.
 * Cover/contain van het bestand gebeurt binnen dit kader.
 */
export function DisplayMediaStage({ children }: { children: ReactNode }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-black"
      style={STAGE_STYLE}
    >
      <div style={FRAME_STYLE}>{children}</div>
    </div>
  );
}
