"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Kloktekst (bv. `01:11`) met vaste tekenbreedte zodat `1` vs `0` de layout
 * niet laat springen — ook als het scorebord-font `tabular-nums` slecht ondersteunt.
 */
export function StableClockText({
  value,
  className,
  style,
}: {
  value: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      role="timer"
      aria-label={value}
      className={cn("inline-flex items-baseline justify-center", className)}
      style={{
        fontVariantNumeric: "tabular-nums",
        fontFeatureSettings: '"tnum" 1',
        ...style,
      }}
    >
      {Array.from(value).map((ch, i) => (
        <span
          key={i}
          aria-hidden
          className="inline-block text-center"
          style={{
            width: ch === ":" || ch === "." ? "0.34em" : "0.65em",
          }}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}
