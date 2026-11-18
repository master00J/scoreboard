import type { Prisma } from "@prisma/client";
import type { Db } from "./db";
import type { Sponsor } from "../lib/types";
import { sponsorBudgetSectionFromMatchStatus, sponsorSectionBudgetSeconds } from "../lib/sponsor-distribution";
import { sectionForStatus } from "../lib/sponsor-display-helpers";
import { sponsorTelemetrySegmentKey } from "../lib/sponsor-telemetry";
import { playLogVisibleSec } from "../lib/sponsor-play-ledger";
import {
  GUARANTEE_SEGMENTS,
  bookingTotalsBySponsor,
  carryInForSegment,
  computeShortfall,
  cueGuarantee,
  guaranteeSegmentForStatus,
  guaranteeSegmentOf,
  isCompletePlay,
  parseSponsorGuarantee,
  type GuaranteeSegment,
  type SegmentLedgerEntry,
  type SponsorBookingTotals,
  type SponsorGuarantee,
} from "../lib/sponsor-guarantee";
import { buildSponsorPlayWhere, type SponsorPlayFilters } from "./sponsor-plays";

/**
 * Garanties en tekorten voor de lokale API (`/api/sponsor-guarantees`, rapport) en de start
 * van een fase (`snapshotPhaseBookings`).
 */

type PlayForGuarantee = {
  sponsorId: string | null;
  ledgerSponsorId: string | null;
  mediaId: string | null;
  matchId: string | null;
  segmentKey: string;
  expectedSec: number;
  actualSec: number;
  actualMs: number;
  counted: boolean;
  clipSessionId: string;
};

const PLAY_SELECT = {
  sponsorId: true,
  ledgerSponsorId: true,
  mediaId: true,
  matchId: true,
  segmentKey: true,
  expectedSec: true,
  actualSec: true,
  actualMs: true,
  counted: true,
  clipSessionId: true,
} as const;

function playSponsorId(p: PlayForGuarantee): string | null {
  return p.sponsorId ?? p.ledgerSponsorId;
}

/** Geleverde seconden per fase voor één sponsor, volgens de soort garantie. */
function deliveredLedger(
  plays: readonly PlayForGuarantee[],
  sponsorId: string,
  guarantee: SponsorGuarantee,
): Partial<Record<GuaranteeSegment, { deliveredSec: number; completeSec: number }>> {
  const out: Partial<Record<GuaranteeSegment, { deliveredSec: number; completeSec: number }>> = {};
  for (const p of plays) {
    if (!p.counted || playSponsorId(p) !== sponsorId) continue;
    const seg = guaranteeSegmentOf(p.segmentKey);
    if (!seg) continue;
    const cur = out[seg] ?? { deliveredSec: 0, completeSec: 0 };
    const sec = playLogVisibleSec(p);
    cur.deliveredSec += sec;
    if (isCompletePlay(p)) cur.completeSec += sec;
    out[seg] = cur;
  }
  void guarantee;
  return out;
}

function sponsorLedgerFor(
  bookings: ReadonlyMap<GuaranteeSegment, number>,
  delivered: Partial<Record<GuaranteeSegment, { deliveredSec: number; completeSec: number }>>,
  guarantee: SponsorGuarantee,
): Partial<Record<GuaranteeSegment, SegmentLedgerEntry>> {
  const ledger: Partial<Record<GuaranteeSegment, SegmentLedgerEntry>> = {};
  for (const seg of GUARANTEE_SEGMENTS) {
    const booked = bookings.get(seg);
    const d = delivered[seg];
    if (booked == null && !d) continue;
    ledger[seg] = {
      bookedSec: booked ?? 0,
      deliveredSec: d ? (guarantee.kind === "plays" ? d.completeSec : d.deliveredSec) : 0,
    };
  }
  return ledger;
}

/**
 * Legt bij de start van een fase vast wat elke actieve sponsor er geboekt heeft (plus het tekort
 * dat hij hier mag inhalen). Idempotent: een fase die al vastgelegd is, blijft zoals ze was.
 */
export async function snapshotPhaseBookings(db: Db, matchId: string): Promise<number> {
  const match = await db.match.findUnique({ where: { id: matchId }, select: { id: true, status: true } });
  if (!match) return 0;
  const segment = guaranteeSegmentForStatus(match.status);
  const segmentKey = sponsorTelemetrySegmentKey(match.id, match.status, sectionForStatus(match.status));
  if (!segment || !segmentKey) return 0;
  const existing = await db.sponsorPhaseBooking.findMany({
    where: { matchId, segmentKey },
    select: { sponsorId: true },
  });
  const have = new Set(existing.map((e) => e.sponsorId));
  const sponsors = (await db.sponsor.findMany({ where: { active: true } })) as unknown as Sponsor[];
  const section = sponsorBudgetSectionFromMatchStatus(match.status);
  const todo = sponsors.filter((s) => !have.has(s.id));
  if (todo.length === 0) return 0;

  const [snapshots, plays] = await Promise.all([
    db.sponsorPhaseBooking.findMany({ where: { matchId } }),
    db.sponsorPlayLog.findMany({ where: { matchId }, select: PLAY_SELECT }),
  ]);
  let written = 0;
  for (const s of todo) {
    const bookedSec = Math.round(sponsorSectionBudgetSeconds(s, section, match.status));
    const guarantee = parseSponsorGuarantee(s.guaranteeJson);
    const bookings = new Map<GuaranteeSegment, number>();
    for (const b of snapshots) {
      if (b.sponsorId !== s.id) continue;
      const seg = guaranteeSegmentOf(b.segmentKey);
      if (seg) bookings.set(seg, b.bookedSec);
    }
    const ledger = sponsorLedgerFor(bookings, deliveredLedger(plays, s.id, guarantee), guarantee);
    const carryInSec = Math.round(carryInForSegment(ledger, guarantee, segment));
    if (bookedSec <= 0 && carryInSec <= 0) continue;
    try {
      await db.sponsorPhaseBooking.create({
        data: {
          matchId,
          segmentKey,
          sponsorId: s.id,
          sponsorName: s.name,
          bookedSec,
          carryInSec,
          guaranteeJson: s.guaranteeJson ?? null,
        },
      });
      written += 1;
    } catch {
      /* tegelijk door een andere aanroep vastgelegd */
    }
  }
  return written;
}

export type GuaranteeCueStatus = {
  cueId: string;
  mediaId: string;
  title: string;
  guarantee: "window" | "fullPlay" | "none";
  triggerSec: number;
  endSec: number | null;
  /** Zichtbare seconden van deze cue in deze fase. */
  deliveredSec: number;
  /** Minstens één vertoning was volledig. */
  completed: boolean;
};

export type GuaranteeSponsorPayload = {
  id: string;
  name: string;
  guarantee: SponsorGuarantee;
  /** Geboekt voor de lopende fase (vastgelegd bij de start, of het huidige budget). */
  bookedSec: number;
  /** Tekort uit eerdere fases dat in deze fase ingehaald mag worden. */
  carryInSec: number;
  /** Geleverd in de lopende fase volgens de soort garantie (bewaarde rijen). */
  deliveredSec: number;
  /** Tekort uit eerdere fases dat nog open staat en hier niet ingehaald mag worden. */
  openFromEarlierSec: number;
  /** Per fase van deze wedstrijd: geboekt, ingehaald, geleverd, tekort. */
  segments: ReturnType<typeof computeShortfall>["bySegment"];
  /** Per bestand in de lopende fase, als de sponsor meer dan één bestand of eigen cue-afspraken heeft. */
  files: { mediaId: string; title: string; deliveredSec: number }[];
  cues: GuaranteeCueStatus[];
};

export type GuaranteeLivePayload = {
  matchId: string;
  status: string;
  segment: GuaranteeSegment | null;
  sponsors: GuaranteeSponsorPayload[];
};

/** Alles wat de live-weergave van garanties nodig heeft voor één wedstrijd. */
export async function sponsorGuaranteeLive(db: Db, matchId: string): Promise<GuaranteeLivePayload | null> {
  const match = await db.match.findUnique({ where: { id: matchId }, select: { id: true, status: true } });
  if (!match) return null;
  const segment = guaranteeSegmentForStatus(match.status);
  const section = sponsorBudgetSectionFromMatchStatus(match.status);
  const [sponsorsRaw, snapshots, plays, cues] = await Promise.all([
    db.sponsor.findMany({ include: { media: true }, orderBy: { name: "asc" } }),
    db.sponsorPhaseBooking.findMany({ where: { matchId } }),
    db.sponsorPlayLog.findMany({ where: { matchId }, select: PLAY_SELECT }),
    db.scheduledMediaCue.findMany({ where: { enabled: true }, include: { media: true } }),
  ]);
  const sponsors = sponsorsRaw as unknown as Sponsor[];
  const out: GuaranteeSponsorPayload[] = [];
  for (const s of sponsors) {
    const guarantee = parseSponsorGuarantee(s.guaranteeJson);
    const bookings = new Map<GuaranteeSegment, number>();
    let carryFromSnapshot: number | null = null;
    for (const b of snapshots) {
      if (b.sponsorId !== s.id) continue;
      const seg = guaranteeSegmentOf(b.segmentKey);
      if (!seg) continue;
      bookings.set(seg, b.bookedSec);
      if (seg === segment) carryFromSnapshot = b.carryInSec;
    }
    if (segment && !bookings.has(segment) && s.active) {
      const live = Math.round(sponsorSectionBudgetSeconds(s, section, match.status));
      if (live > 0) bookings.set(segment, live);
    }
    const delivered = deliveredLedger(plays, s.id, guarantee);
    const ledger = sponsorLedgerFor(bookings, delivered, guarantee);
    if (Object.keys(ledger).length === 0) continue;
    const result = computeShortfall(ledger, guarantee, segment);
    const carryInSec =
      segment == null ? 0 : (carryFromSnapshot ?? carryInForSegment(ledger, guarantee, segment));
    const current = segment ? ledger[segment] : undefined;
    const idx = segment ? GUARANTEE_SEGMENTS.indexOf(segment) : -1;
    const openBefore = idx > 0 ? computeShortfall(ledger, guarantee, GUARANTEE_SEGMENTS[idx - 1]).openSec : 0;

    const media = (s.media ?? []).filter((m) => m.active);
    const sponsorCues = cues.filter(
      (c) => c.media.sponsorId === s.id && segment != null && guaranteeSegmentForStatus(c.matchStatus) === segment,
    );
    const filesInPhase = new Map<string, number>();
    const cueDelivered = new Map<string, { sec: number; complete: boolean }>();
    for (const p of plays) {
      if (!p.counted || playSponsorId(p) !== s.id || guaranteeSegmentOf(p.segmentKey) !== segment) continue;
      if (p.mediaId) filesInPhase.set(p.mediaId, (filesInPhase.get(p.mediaId) ?? 0) + playLogVisibleSec(p));
      const m = /^cue:[^:]+:([^:]+):/.exec(p.clipSessionId);
      if (m) {
        const cur = cueDelivered.get(m[1]!) ?? { sec: 0, complete: false };
        cur.sec += playLogVisibleSec(p);
        cur.complete = cur.complete || isCompletePlay(p);
        cueDelivered.set(m[1]!, cur);
      }
    }
    out.push({
      id: s.id,
      name: s.name,
      guarantee,
      bookedSec: current?.bookedSec ?? 0,
      carryInSec,
      deliveredSec: current?.deliveredSec ?? 0,
      openFromEarlierSec: Math.max(0, openBefore - carryInSec),
      segments: result.bySegment,
      files:
        media.length > 1 || sponsorCues.length > 0
          ? media.map((m) => ({ mediaId: m.id, title: m.title, deliveredSec: filesInPhase.get(m.id) ?? 0 }))
          : [],
      cues: sponsorCues.map((c) => {
        const d = cueDelivered.get(c.id);
        return {
          cueId: c.id,
          mediaId: c.mediaId,
          title: c.media.title,
          guarantee: cueGuarantee(c),
          triggerSec: c.triggerSec,
          endSec: c.endSec ?? null,
          deliveredSec: d?.sec ?? 0,
          completed: d?.complete ?? false,
        };
      }),
    });
  }
  return { matchId, status: match.status, segment, sponsors: out };
}

/**
 * Geboekte seconden en open tekort per sponsor voor het rapport, met dezelfde filters als de
 * vertoningen (wedstrijd, sponsor, fase, periode).
 */
export async function summarizeSponsorBookings(
  db: Db,
  filters: SponsorPlayFilters,
): Promise<Map<string, SponsorBookingTotals & { sponsorName: string }>> {
  const where: Prisma.SponsorPhaseBookingWhereInput = {};
  if (filters.matchId) where.matchId = filters.matchId;
  if (filters.sponsorId) where.sponsorId = filters.sponsorId;
  const playWhere = buildSponsorPlayWhere(filters);
  if (playWhere.segmentKey) where.segmentKey = playWhere.segmentKey as Prisma.StringFilter;
  if (filters.fromIso || filters.toIso) {
    const range: { gte?: Date; lte?: Date } = {};
    if (filters.fromIso && !Number.isNaN(new Date(filters.fromIso).valueOf())) range.gte = new Date(filters.fromIso);
    if (filters.toIso && !Number.isNaN(new Date(filters.toIso).valueOf())) range.lte = new Date(filters.toIso);
    if (Object.keys(range).length > 0) where.createdAt = range;
  }
  const snapshots = await db.sponsorPhaseBooking.findMany({ where });
  if (snapshots.length === 0) return new Map();
  const matchIds = Array.from(new Set(snapshots.map((s) => s.matchId)));
  const plays = await db.sponsorPlayLog.findMany({
    where: { matchId: { in: matchIds }, sponsorId: { in: Array.from(new Set(snapshots.map((s) => s.sponsorId))) } },
    select: PLAY_SELECT,
  });
  // Alleen fases die in de filter vallen tellen; een fase zonder vastlegging hoort er niet bij.
  const included = new Set(snapshots.map((s) => `${s.matchId}|${s.segmentKey}`));
  const totals = bookingTotalsBySponsor(
    snapshots.map((s) => ({
      sponsorId: s.sponsorId,
      matchId: s.matchId,
      segmentKey: s.segmentKey,
      bookedSec: s.bookedSec,
      guaranteeJson: s.guaranteeJson,
    })),
    plays.filter((p) => included.has(`${p.matchId}|${p.segmentKey}`)),
  );
  const names = new Map(snapshots.map((s) => [s.sponsorId, s.sponsorName]));
  const out = new Map<string, SponsorBookingTotals & { sponsorName: string }>();
  for (const [id, t] of totals) out.set(id, { ...t, sponsorName: names.get(id) ?? id });
  return out;
}

export type SummaryRowWithBooking = {
  sponsorId: string | null;
  sponsorName: string;
  plays: number;
  actualSec: number;
  expectedSec: number;
  bookedSec: number;
  shortfallSec: number;
};

/** Zet geboekt en open tekort bij de rapportregels; sponsors met een boeking maar zonder vertoning komen erbij. */
export function mergeBookingsIntoSummary(
  summary: ReadonlyArray<Omit<SummaryRowWithBooking, "bookedSec" | "shortfallSec">>,
  bookings: ReadonlyMap<string, SponsorBookingTotals & { sponsorName: string }>,
): SummaryRowWithBooking[] {
  const seen = new Set<string>();
  const rows: SummaryRowWithBooking[] = summary.map((r) => {
    const b = r.sponsorId ? bookings.get(r.sponsorId) : undefined;
    if (r.sponsorId && b) seen.add(r.sponsorId);
    return { ...r, bookedSec: b?.bookedSec ?? 0, shortfallSec: b?.shortfallSec ?? 0 };
  });
  for (const [sponsorId, b] of bookings) {
    if (seen.has(sponsorId)) continue;
    rows.push({
      sponsorId,
      sponsorName: b.sponsorName,
      plays: 0,
      actualSec: 0,
      expectedSec: 0,
      bookedSec: b.bookedSec,
      shortfallSec: b.shortfallSec,
    });
  }
  return rows;
}
