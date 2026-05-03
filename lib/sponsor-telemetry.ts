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

/** Totale geschatte verbruikte seconden inclusief lopende clip (display-sync). */
export function sponsorTelemetryConsumedSec(
  ledger: SponsorLedgerPayload,
  sponsorId: string,
  nowMs: number,
): number {
  let total = ledger.bySponsorSec[sponsorId] ?? 0;
  const ac = ledger.activeClip;
  if (ac && ac.sponsorId === sponsorId) {
    total += Math.max(0, (nowMs - ac.startedAtMs) / 1000);
  }
  return total;
}
