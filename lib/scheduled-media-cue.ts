/** Optionele eindtijd op de matchklok. Null = oud gedrag (video tot einde, foto via durationSec). */
export function cueEndSec(cue: {
  triggerSec: number;
  endSec?: number | null;
}): number | null {
  const end = cue.endSec;
  if (end == null || !Number.isFinite(end) || end <= cue.triggerSec) return null;
  return Math.round(end);
}

export function cueHasClockWindow(cue: { triggerSec: number; endSec?: number | null }): boolean {
  return cueEndSec(cue) != null;
}

/** Cue hoort nu op het scherm volgens de matchklok. */
export function cueIsDueAtElapsed(
  cue: { triggerSec: number; endSec?: number | null },
  elapsed: number,
): boolean {
  const end = cueEndSec(cue);
  if (end != null) return elapsed >= cue.triggerSec && elapsed < end;
  return elapsed >= cue.triggerSec && elapsed - cue.triggerSec <= 2;
}

const POST_MATCH_STATUSES = new Set(["FULL_TIME", "POST_MATCH"]);
const PREMATCH_STATUSES = new Set(["SETUP", "PREMATCH"]);

/** Time-cues “Na wedstrijd” horen bij zowel Einde als Post-match. */
export function cuePhaseMatches(cueStatus: string, matchStatus: string): boolean {
  if (cueStatus === matchStatus) return true;
  if (POST_MATCH_STATUSES.has(cueStatus) && POST_MATCH_STATUSES.has(matchStatus)) return true;
  return PREMATCH_STATUSES.has(cueStatus) && PREMATCH_STATUSES.has(matchStatus);
}

export function isPostMatchCuePhase(status: string | null | undefined): boolean {
  return status != null && POST_MATCH_STATUSES.has(status);
}

export function isPrematchCuePhase(status: string | null | undefined): boolean {
  return status != null && PREMATCH_STATUSES.has(status);
}

/** Eén klok-fase voor fired-keys (Setup+Voor wedstrijd, Einde+Na wedstrijd). */
export function cueClockPhaseKey(status: string | null | undefined): string | null {
  if (status == null) return null;
  if (isPostMatchCuePhase(status)) return "POST_MATCH";
  if (isPrematchCuePhase(status)) return "PREMATCH";
  return status;
}

/** Seconden sinds Full time / Na wedstrijd — zelfde bron voor display en preview. */
export function postMatchCueElapsedSec(
  startedAt: string | Date | null | undefined,
  now = Date.now(),
): number {
  if (startedAt == null) return 0;
  const t = startedAt instanceof Date ? startedAt.getTime() : new Date(startedAt).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (now - t) / 1000);
}

export type PrematchRundownClock = {
  elapsedSec: number;
  /** Nog vóór kickoff − venster: geen clips tonen (0:00 zou anders te vroeg afgaan). */
  beforeWindow: boolean;
  /** Aftrap bereikt: rundown stopt. */
  pastKickoff: boolean;
  usesKickoffAnchor: boolean;
  windowSec: number;
};

/**
 * Prematch-rundownklok:
 * - Met geplande aftrap: 0:00 = kickoff − venster (formulier) of kickoff − cliplengte.
 * - Zonder aftrap: vanaf het moment dat Voor wedstrijd actief werd.
 */
export function computePrematchRundownClock(
  match: { kickoffAt?: string | Date | null; prematchSpreadWindowSec?: number | null } | null | undefined,
  cycleSec: number,
  fallbackStartedAt: string | Date | null | undefined,
  now = Date.now(),
): PrematchRundownClock {
  const configured = match?.prematchSpreadWindowSec ?? 0;
  const windowSec =
    typeof configured === "number" && configured > 0
      ? Math.min(86400, Math.max(60, Math.floor(configured)))
      : Math.max(1, Math.round(cycleSec) || 1);
  const ko = match?.kickoffAt != null ? new Date(match.kickoffAt).getTime() : Number.NaN;

  if (Number.isFinite(ko)) {
    const start = ko - windowSec * 1000;
    if (now < start) {
      return { elapsedSec: 0, beforeWindow: true, pastKickoff: false, usesKickoffAnchor: true, windowSec };
    }
    if (now >= ko) {
      return { elapsedSec: windowSec, beforeWindow: false, pastKickoff: true, usesKickoffAnchor: true, windowSec };
    }
    return {
      elapsedSec: (now - start) / 1000,
      beforeWindow: false,
      pastKickoff: false,
      usesKickoffAnchor: true,
      windowSec,
    };
  }

  return {
    elapsedSec: postMatchCueElapsedSec(fallbackStartedAt, now),
    beforeWindow: false,
    pastKickoff: false,
    usesKickoffAnchor: false,
    windowSec,
  };
}

export function cueWindowExpired(
  cue: { triggerSec: number; endSec?: number | null },
  elapsed: number,
): boolean {
  const end = cueEndSec(cue);
  return end != null && elapsed >= end;
}

/** Groepeert Setup+Voor wedstrijd en Einde+Na wedstrijd als één rundown. */
export function cueRundownPhaseKey(status: string): string {
  if (status === "FULL_TIME") return "POST_MATCH";
  if (status === "SETUP") return "PREMATCH";
  return status;
}

export function cueWindowLengthSec(cue: {
  triggerSec: number;
  endSec?: number | null;
  media?: { durationSec?: number | null; type?: string };
}): number {
  const end = cueEndSec(cue);
  if (end != null) return Math.max(1, end - cue.triggerSec);
  const dur = cue.media?.durationSec;
  return Math.max(1, Number.isFinite(dur) && dur != null && dur > 0 ? Math.round(dur) : 10);
}

/** Volgende venster achter de laatste cue van een rundown. */
export function nextRundownWindow(
  existing: { triggerSec: number; endSec?: number | null; media?: { durationSec?: number | null } }[],
  durationSec: number,
): { triggerSec: number; endSec: number } {
  const dur = Math.max(1, Math.round(durationSec));
  let start = 0;
  for (const cue of existing) {
    const end = cueEndSec(cue) ?? cue.triggerSec + cueWindowLengthSec(cue);
    if (end > start) start = end;
  }
  return { triggerSec: start, endSec: start + dur };
}

export function restackRundownWindows<T extends {
  id: string;
  triggerSec: number;
  endSec?: number | null;
  media?: { durationSec?: number | null };
}>(cuesInOrder: T[]): { id: string; triggerSec: number; endSec: number }[] {
  let t = 0;
  return cuesInOrder.map((cue) => {
    const len = cueWindowLengthSec(cue);
    const row = { id: cue.id, triggerSec: t, endSec: t + len };
    t += len;
    return row;
  });
}

/** Totale lengte van een rundown (einde van het laatste venster). */
export function rundownCycleSec(
  cues: { triggerSec: number; endSec?: number | null; media?: { durationSec?: number | null } }[],
): number {
  let end = 0;
  for (const cue of cues) {
    const stop = cueEndSec(cue) ?? cue.triggerSec + cueWindowLengthSec(cue);
    if (stop > end) end = stop;
  }
  return end;
}

export function phaseRundownLoops(cues: { loop?: boolean }[]): boolean {
  return cues.some((cue) => cue.loop === true);
}

/** Speelkop binnen de rundown; bij loop wringt de tijd terug naar 0 na de laatste clip. */
export function wrapRundownElapsed(elapsed: number, cycleSec: number, loop: boolean): number {
  const t = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  if (!loop || !(cycleSec > 0)) return t;
  return t % cycleSec;
}

export function rundownCycleIndex(elapsed: number, cycleSec: number, loop: boolean): number {
  const t = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  if (!loop || !(cycleSec > 0)) return 0;
  return Math.floor(t / cycleSec);
}

/** Actieve cue met klokvenster is niet meer aan de beurt (ook na wrap naar 0). */
export function cueLeftClockWindow(
  cue: { triggerSec: number; endSec?: number | null },
  elapsed: number,
): boolean {
  return cueHasClockWindow(cue) && !cueIsDueAtElapsed(cue, elapsed);
}
