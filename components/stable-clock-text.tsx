"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { useFitToBox } from "./use-fit-to-box";

/**
 * Kloktekst (bv. `01:11`) met vaste tekenbreedte zodat `1` vs `0` de layout
 * niet laat springen — ook als het scorebord-font `tabular-nums` slecht ondersteunt.
 */
export function StableClockText({
  value,
  className,
  style,
  digitEm = 0.65,
  plainDigits = false,
  fitBoost,
}: {
  value: string;
  className?: string;
  style?: CSSProperties;
  /** Breedte per cijfer in em; brede letters hebben meer nodig. Het dubbelpunt krijgt ruim de helft. */
  digitEm?: number;
  /** Geen tabelcijfers: de vaste breedte per teken houdt de klok toch stil. */
  plainDigits?: boolean;
  /**
   * Binnen het vak houden (`data-fit-box`): de vergroting van het vak ("Tekstgrootte"). Zonder deze
   * waarde krimpt de klok niet.
   */
  fitBoost?: number;
}) {
  const fit = useFitToBox<HTMLSpanElement>(fitBoost ?? 1);
  const fits = fitBoost !== undefined;
  return (
    <span
      ref={fits ? fit.ref : undefined}
      role="timer"
      aria-label={value}
      className={cn("inline-flex items-baseline justify-center", className)}
      style={{
        fontVariantNumeric: plainDigits ? "normal" : "tabular-nums",
        fontFeatureSettings: plainDigits ? "normal" : '"tnum" 1',
        ...style,
        ...(fits ? fit.style : {}),
      }}
    >
      {Array.from(value).map((ch, i) => (
        <span
          key={i}
          aria-hidden
          className="inline-block text-center"
          style={{
            width: ch === ":" || ch === "." ? `${(digitEm * 0.52).toFixed(3)}em` : `${digitEm}em`,
          }}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}
