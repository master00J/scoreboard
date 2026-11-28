"use client";

import type { CSSProperties, ReactNode } from "react";
import { useFitToBox } from "./use-fit-to-box";

/**
 * Tekst die nooit buiten zijn vak valt: te brede of te hoge tekst krimpt tot hij past, tekst die al
 * past blijft exact zoals hij was. Het vak is de dichtstbijzijnde ouder met `data-fit-box`.
 */
export function FitText({
  as: Tag = "span",
  boost = 1,
  origin = "center",
  className,
  style,
  children,
}: {
  as?: "span" | "div";
  /** Vergroting die het vak zelf al op de tekst zet ("Tekstgrootte"). */
  boost?: number;
  origin?: CSSProperties["transformOrigin"];
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const fit = useFitToBox<HTMLElement>(boost, origin);
  return (
    <Tag ref={fit.ref as never} className={className} style={{ ...style, ...fit.style }}>
      {children}
    </Tag>
  );
}

/** Waar een tekst naartoe krimpt, volgens de uitlijning van het vak. */
export function fitOrigin(align: "left" | "center" | "right" | undefined): CSSProperties["transformOrigin"] {
  return align === "left" ? "left center" : align === "right" ? "right center" : "center";
}
