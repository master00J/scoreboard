/** Seconden scorebord- vs. sponsorfase per wedstrijdfase (modus “Sponsors (Live)”). */

export type LiveCyclePhasing = {
  firstHalfScoreboardSec: number;
  firstHalfSponsorSec: number;
  halftimeScoreboardSec: number;
  halftimeSponsorSec: number;
  secondHalfScoreboardSec: number;
  secondHalfSponsorSec: number;
};

export const DEFAULT_LIVE_CYCLE_PHASING: LiveCyclePhasing = {
  firstHalfScoreboardSec: 45,
  firstHalfSponsorSec: 15,
  halftimeScoreboardSec: 30,
  halftimeSponsorSec: 15,
  secondHalfScoreboardSec: 45,
  secondHalfSponsorSec: 15,
};

export function liveCyclePhasingFromSettings(
  s: Partial<LiveCyclePhasing> | null | undefined,
): LiveCyclePhasing {
  const d = DEFAULT_LIVE_CYCLE_PHASING;
  const n = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    firstHalfScoreboardSec: n(s?.firstHalfScoreboardSec, d.firstHalfScoreboardSec),
    firstHalfSponsorSec: n(s?.firstHalfSponsorSec, d.firstHalfSponsorSec),
    halftimeScoreboardSec: n(s?.halftimeScoreboardSec, d.halftimeScoreboardSec),
    halftimeSponsorSec: n(s?.halftimeSponsorSec, d.halftimeSponsorSec),
    secondHalfScoreboardSec: n(s?.secondHalfScoreboardSec, d.secondHalfScoreboardSec),
    secondHalfSponsorSec: n(s?.secondHalfSponsorSec, d.secondHalfSponsorSec),
  };
}

/** Tijden voor de huidige wedstrijdstatus (verlenging = zelfde als 2e helft). */
export function cycleSecondsForStatus(
  status: string | undefined,
  p: LiveCyclePhasing,
): { sb: number; sp: number } {
  if (status === "HALF_TIME") {
    return { sb: p.halftimeScoreboardSec, sp: p.halftimeSponsorSec };
  }
  if (status === "SECOND_HALF" || status === "EXTRA_TIME") {
    return { sb: p.secondHalfScoreboardSec, sp: p.secondHalfSponsorSec };
  }
  return { sb: p.firstHalfScoreboardSec, sp: p.firstHalfSponsorSec };
}

export function minScoreboardSecForLiveCycle(status: string | undefined): number {
  return status === "HALF_TIME" ? 0 : 5;
}

/** Actieve speelhelft (incl. verlenging): sponsoren lopen via sponsorbudgetten, niet handmatig “één clip”. */
export function isLivePlayingMatchStatus(status: string | undefined): boolean {
  return (
    status === "FIRST_HALF" ||
    status === "SECOND_HALF" ||
    status === "EXTRA_TIME"
  );
}
