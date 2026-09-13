import { useMemo } from "react";
import {
  parseSponsorLayoutsJson,
  resolveSponsorWindow,
  type ResolvedSponsorWindow,
  type SponsorMatchClock,
} from "./sponsor-windows";

export function useResolvedSponsorWindow(
  match: SponsorMatchClock | null | undefined,
  timerRunning: boolean,
  periodBreakPending: boolean,
  layoutsJson?: string | null,
): ResolvedSponsorWindow | null {
  const layouts = useMemo(() => parseSponsorLayoutsJson(layoutsJson), [layoutsJson]);
  return useMemo(() => {
    if (!match) return null;
    return resolveSponsorWindow({
      match,
      timerRunning,
      periodBreakPending,
      layouts,
    });
  }, [
    match,
    match?.sport,
    match?.status,
    match?.currentPeriod,
    match?.halfDurationSec,
    match?.periodDurationSec,
    match?.halfBreakSec,
    timerRunning,
    periodBreakPending,
    layouts,
  ]);
}
