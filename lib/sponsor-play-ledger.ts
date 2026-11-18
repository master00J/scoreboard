/**
 * Boekhouding van sponsorvertoningen in het hoofdproces, los van Electron en Prisma zodat ze
 * getest kan worden.
 *
 * - Elke vertoning heeft een bron (rotatie, cue, handmatig). Melden er twee tegelijk zichtbare
 *   tijd, dan beslist de laag die op het scherm bovenaan ligt: een handmatig gestarte clip ligt
 *   boven een cue, een cue boven de rotatie. Wat de onderste laag in die tijd meldt, telt niet.
 * - Een handmatige vertoning telt alleen mee als de operator dat zo instelde; ze wordt wel
 *   bewaard, zodat het rapport ze kan tonen.
 * - Na een herstart wordt de lopende stand per fase opnieuw opgebouwd uit de bewaarde rijen.
 */

import type { SponsorPlaySource } from "./sponsor-telemetry";

/** Hoe hoger, hoe hoger de laag op het stadionscherm. */
export const SPONSOR_PLAY_SOURCE_LAYER: Record<SponsorPlaySource, number> = {
  rotation: 1,
  cue: 2,
  manual: 3,
};

/** Zo lang na zijn laatste zichtbare melding geldt een laag nog als "op het scherm". */
export const PLAY_OVERLAP_WINDOW_MS = 1_500;

/** Zo vaak (hoogstens) wordt de voortgang van een lopende vertoning bewaard. */
export const PLAY_PROGRESS_PERSIST_MS = 3_000;

export type PlayRowState = "running" | "done" | "interrupted";

export type PlaySessionState = {
  clipSessionId: string;
  source: SponsorPlaySource;
  /** Telt deze vertoning mee voor de sponsor (handmatig + instelling uit = nee)? */
  counted: boolean;
  /** Hoogste gemelde zichtbare ms. */
  visibleMs: number;
  /** Het deel van `visibleMs` dat telt (niet bedekt door een hogere laag). */
  countedMs: number;
  /** Laatste moment waarop de zichtbare tijd groeide. */
  lastActiveAtMs: number | null;
  paused: boolean;
};

export function createPlaySessionState(opts: {
  clipSessionId: string;
  source: SponsorPlaySource;
  counted: boolean;
  paused?: boolean;
}): PlaySessionState {
  return {
    clipSessionId: opts.clipSessionId,
    source: opts.source,
    counted: opts.counted,
    visibleMs: 0,
    countedMs: 0,
    lastActiveAtMs: null,
    paused: !!opts.paused,
  };
}

/** Telt een handmatig gestarte sponsorclip mee? Rotatie en cues tellen altijd. */
export function playSourceCounts(source: SponsorPlaySource, countManualPlays: boolean): boolean {
  return source !== "manual" || countManualPlays;
}

function coveredByHigherLayer(
  sessions: Iterable<PlaySessionState>,
  session: PlaySessionState,
  nowMs: number,
): boolean {
  const own = SPONSOR_PLAY_SOURCE_LAYER[session.source];
  for (const other of sessions) {
    if (other === session || other.clipSessionId === session.clipSessionId) continue;
    if (SPONSOR_PLAY_SOURCE_LAYER[other.source] <= own) continue;
    if (other.paused || other.lastActiveAtMs == null) continue;
    if (nowMs - other.lastActiveAtMs <= PLAY_OVERLAP_WINDOW_MS) return true;
  }
  return false;
}

/**
 * Nieuwe stand van de zichtbare tijd van een vertoning. Geeft terug hoeveel ms er bij de
 * getelde tijd kwam: niets als de stand niet groeide, als een hogere laag tegelijk zichtbaar
 * was, of als de vertoning niet meetelt.
 */
export function applyVisibleProgress(
  sessions: Iterable<PlaySessionState>,
  session: PlaySessionState,
  visibleMs: number,
  nowMs: number,
): number {
  if (!Number.isFinite(visibleMs)) return 0;
  const delta = visibleMs - session.visibleMs;
  if (!(delta > 0)) return 0;
  const covered = coveredByHigherLayer(sessions, session, nowMs);
  session.visibleMs = visibleMs;
  if (covered) return 0;
  session.lastActiveAtMs = nowMs;
  if (!session.counted) return 0;
  session.countedMs += delta;
  return delta;
}

/** Ms die de rij van deze vertoning als schermtijd vermeldt. */
export function playRowActualMs(session: PlaySessionState): number {
  return Math.max(0, Math.round(session.counted ? session.countedMs : session.visibleMs));
}

export function shouldPersistPlayProgress(lastPersistAtMs: number, nowMs: number): boolean {
  return nowMs - lastPersistAtMs >= PLAY_PROGRESS_PERSIST_MS;
}

/**
 * Echt zichtbare seconden van een rij, onafgerond. Rijen van vóór `actualMs` hebben daar 0 en
 * tellen met hun oude hele seconden.
 */
export function playLogVisibleSec(row: { actualSec: number; actualMs?: number | null }): number {
  const ms = row.actualMs ?? 0;
  return ms > 0 ? ms / 1000 : Math.max(0, row.actualSec);
}

export type PlayLogLedgerRow = {
  clipSessionId: string;
  matchId: string | null;
  segmentKey: string;
  sponsorId: string | null;
  /** Sponsor-id zoals de telemetrie hem kent (ook `club:…` en `scheduled-cue`). */
  ledgerSponsorId: string | null;
  actualSec: number;
  actualMs: number | null;
  counted: boolean | null;
};

/**
 * Lopende stand per sponsor voor één wedstrijdfase, opgebouwd uit de bewaarde rijen. Rijen van
 * vertoningen die het hoofdproces al in het geheugen bijhoudt, slaan we over (die tellen daar).
 */
export function ledgerSecondsFromRows(
  rows: readonly PlayLogLedgerRow[],
  opts: { matchId: string; segmentKey: string; skipSessionIds?: ReadonlySet<string> },
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (row.matchId !== opts.matchId || row.segmentKey !== opts.segmentKey) continue;
    if (row.counted === false) continue;
    if (opts.skipSessionIds?.has(row.clipSessionId)) continue;
    const id = row.ledgerSponsorId ?? row.sponsorId;
    if (!id) continue;
    const sec = playLogVisibleSec(row);
    if (sec <= 0) continue;
    out[id] = (out[id] ?? 0) + sec;
  }
  return out;
}

/** Wat er bij een start na een herstart met een achtergebleven lopende rij gebeurt. */
export function recoveredPlayRowState(row: { state: string; actualMs: number }): "delete" | "interrupted" | "keep" {
  if (row.state !== "running") return "keep";
  return row.actualMs > 0 ? "interrupted" : "delete";
}
