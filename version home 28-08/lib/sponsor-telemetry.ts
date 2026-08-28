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
  if (section === "postmatch") return `${matchId}:postmatch`;
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
  /** Decode/start-fout: ledger opruimen, maar niet als proof-of-play bewaren. */
  discard?: boolean;
  reason?: string;
};

/** Live sync HUD/preview met echte video-positie en gecorrigeerde spotduur. */
export type SponsorTelemetryClipProgress = {
  matchId: string;
  segmentKey: string;
  clipSessionId: string;
  playbackPositionMs: number;
  /** Verhoogt alleen `expectedPlaySec` in de ledger (nooit verlagen). */
  expectedPlaySec?: number;
  paused?: boolean;
  /** `Date.now() - playbackPositionMs` zodat elapsed = positie in de video. */
  startedAtMs?: number;
};

/** Zelfde logica als display `MediaRenderer` / commit-timers. */
export function resolveVideoExpectedPlaySec(
  item: { type: string; durationSec: number },
  scheduledPlaySec: number,
  browserSec: number,
): number {
  const catalogSec = Math.max(
    0.5,
    scheduledPlaySec,
    item.durationSec > 0 ? item.durationSec : 0,
  );
  if (!(browserSec > 0)) return catalogSec;
  if (browserSec > catalogSec * 3 + 90) return catalogSec;
  return Math.max(catalogSec, browserSec);
}

/**
 * Actieve clip telt alleen mee zolang het scherm hem nog als “lopend” ziet (zelfde marge als
 * `display/page.tsx` / Sponsor-HUD). Daarna: scorebord-fase / clipEnd wacht — geen live doorschieting.
 */
export function ledgerActiveClipStillLiveForMatchSegment(
  match: { id: string; status?: string },
  section: SponsorSection,
  sponsorLedger: SponsorLedgerPayload | null,
  nowMs: number = Date.now(),
): NonNullable<SponsorLedgerPayload["activeClip"]> | null {
  if (!sponsorLedger?.activeClip) return null;
  const segmentKey = sponsorTelemetrySegmentKey(match.id, match.status, section);
  if (
    !segmentKey ||
    sponsorLedger.matchId !== match.id ||
    sponsorLedger.segmentKey !== segmentKey
  ) {
    return null;
  }
  const ac = sponsorLedger.activeClip;
  const elapsedSec = sponsorTelemetryActiveClipElapsedSec(ac, nowMs);
  const totalSec = Math.max(0.1, ac.expectedPlaySec || 0.1);
  if (elapsedSec >= totalSec + 0.75) return null;
  return ac;
}

export function sponsorTelemetryActiveClipElapsedSec(
  activeClip: NonNullable<SponsorLedgerPayload["activeClip"]>,
  nowMs: number,
): number {
  if (activeClip.paused) {
    return Math.max(0, (activeClip.playbackPositionMs ?? 0) / 1000);
  }
  return Math.max(0, (nowMs - activeClip.startedAtMs) / 1000);
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
