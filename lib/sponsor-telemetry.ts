import type { SponsorSection } from "./types";

/** Gelijk aan budget-segmenten in Sponsors live + roster. */
export function sponsorTelemetrySegmentKey(
  matchId: string | null | undefined,
  matchStatus: string | undefined,
  section: SponsorSection,
): string | null {
  if (!matchId) return null;
  if (section === "prematch") return `${matchId}:prematch`;
  if (section === "halftime") return `${matchId}:halftime`;
  if (section !== "match") return null;
  if (matchStatus === "FIRST_HALF") return `${matchId}:FIRST_HALF`;
  if (matchStatus === "SECOND_HALF") return `${matchId}:SECOND_HALF`;
  if (matchStatus === "EXTRA_TIME") return `${matchId}:EXTRA_TIME`;
  return null;
}

export type SponsorLedgerPayload = {
  matchId: string;
  segmentKey: string;
  /** Afgeronde opgeslagen seconden per sponsor-id (after voltooide clips). */
  bySponsorSec: Record<string, number>;
  /** Huidige slide op het stadionscherm (display-venster). */
  activeClip: {
    sponsorId: string;
    mediaId: string;
    startedAtMs: number;
    expectedPlaySec: number;
    clipSessionId: string;
    /** Laatst bekende echte playback-positie; bevriest HUD/preview tijdens onderbreking. */
    playbackPositionMs?: number;
    paused?: boolean;
  } | null;
  updatedAtMs: number;
};

export type SponsorTelemetryClipStart = {
  matchId: string;
  segmentKey: string;
  sponsorId: string;
  mediaId: string;
  expectedPlaySec: number;
  clipSessionId: string;
  startedAtMs: number;
  playbackPositionMs?: number;
  paused?: boolean;
};

export type SponsorTelemetryClipEnd = {
  matchId: string;
  segmentKey: string;
  sponsorId: string;
  mediaId: string;
  actualSec: number;
  clipSessionId: string;
  startedAtMs: number;
};

export function sponsorTelemetryActiveClipElapsedSec(
  activeClip: NonNullable<SponsorLedgerPayload["activeClip"]>,
  nowMs: number,
): number {
  if (activeClip.paused) {
    return Math.max(0, (activeClip.playbackPositionMs ?? 0) / 1000);
  }
  const basePlaybackMs = Math.max(0, activeClip.playbackPositionMs ?? 0);
  const elapsedSinceStartMs = Math.max(0, nowMs - activeClip.startedAtMs);
  return Math.max(basePlaybackMs / 1000, elapsedSinceStartMs / 1000);
}

/** Totale geschatte verbruikte seconden inclusief lopende clip (display-sync). */
export function sponsorTelemetryConsumedSec(
  ledger: SponsorLedgerPayload,
  sponsorId: string,
  nowMs: number,
): number {
  let total = ledger.bySponsorSec[sponsorId] ?? 0;
  const ac = ledger.activeClip;
  if (ac && ac.sponsorId === sponsorId) {
    /**
     * Live progress maximaal tot de **verwachte** clipduur — voorkomt dat de teller
     * doortikt terwijl er een goal-/spelervideo over de sponsor heen wordt gelegd
     * (waardoor `bySponsorSec` later met de echte playback-duur lager uitvalt).
     */
    const elapsedSec = sponsorTelemetryActiveClipElapsedSec(ac, nowMs);
    const cap = Math.max(0, ac.expectedPlaySec || 0);
    total += cap > 0 ? Math.min(elapsedSec, cap) : elapsedSec;
  }
  return total;
}
