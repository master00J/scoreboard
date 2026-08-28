import type { CSSProperties } from "react";

/** Inline cover-stijl: wint altijd op Tailwind-preflight (`video { height: auto }`). */
export const DISPLAY_COVER_MEDIA_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "block",
  width: "100%",
  height: "100%",
  maxWidth: "none",
  maxHeight: "none",
  objectFit: "cover",
  objectPosition: "center",
};
