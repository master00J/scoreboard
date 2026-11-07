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

/**
 * De scènelaag zet `object-fill` of `object-contain` op de bron. Een vast `object-fit: cover`
 * wint daarop en maakt Uitrekken hetzelfde als Vullen. Deze stijl volgt de class.
 */
export function captureMediaStyle(className?: string): CSSProperties {
  let objectFit: CSSProperties["objectFit"] = "cover";
  if (className?.includes("object-fill")) objectFit = "fill";
  else if (className?.includes("object-contain")) objectFit = "contain";
  else if (className?.includes("object-cover")) objectFit = "cover";
  return { ...DISPLAY_COVER_MEDIA_STYLE, objectFit };
}

/** 16:9-spots (1920×1080) zonder crop — letterbox op zwart. */
export const DISPLAY_CONTAIN_MEDIA_STYLE: CSSProperties = {
  ...DISPLAY_COVER_MEDIA_STYLE,
  objectFit: "contain",
};
