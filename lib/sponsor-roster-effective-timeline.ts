import type { MutableRefObject } from "react";
import { halfWindowElapsed } from "@/lib/sponsor-distribution";

/**
 * Zelfde tijd als het display voor de sponsor-slotmap tijdens speelhelft / verlenging:
 * loopt door bij SPONSOR_ROTATION, staat stil bij MATCH / GOAL / … (timer mag wel doorlopen).
 */
export function effectiveMatchPlayRosterSeconds(
  elapsedSec: number,
  status: string | undefined,
  halfDurationSec: number,
  displayMode: string | undefined,
  freezeRef: MutableRefObject<number>,
): number {
  if (status !== "FIRST_HALF" && status !== "SECOND_HALF" && status !== "EXTRA_TIME") {
    return halfWindowElapsed(elapsedSec, status, halfDurationSec);
  }
  const tLive = halfWindowElapsed(elapsedSec, status, halfDurationSec);
  if (displayMode === "SPONSOR_ROTATION") {
    freezeRef.current = tLive;
    return tLive;
  }
  return freezeRef.current;
}
