"use client";

import type { ReactNode } from "react";

/**
 * Vult het mediavak tot de randen. Een extra 16:9-letterbox liet zwarte stroken
 * zien tussen het scorebord (L-frame of strip) en de clip.
 */
export function DisplayMediaStage({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 overflow-hidden">{children}</div>;
}
