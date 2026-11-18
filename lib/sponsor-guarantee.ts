/**
 * Garanties per boeking: wat een sponsor tegoed heeft, en waar een tekort ingehaald mag worden.
 *
 * Een boeking is één van drie soorten:
 * - **Seconden** (standaard voor de minuten per fase van een sponsor): de zichtbare seconden in
 *   die fase tellen op, ook een clip die halverwege onderbroken werd.
 * - **Volledige vertoningen** (sponsor): alleen clips die helemaal te zien waren, tellen voor de
 *   geboekte seconden. Een onderbroken clip telt niet mee.
 * - **Tijdvenster** (cue met eindtijd): de cue hoort tussen begin en einde op het scherm. Wat daar
 *   buiten valt, wordt niet ingehaald.
 * - **Eén volledige vertoning** (cue zonder eindtijd): een onderbroken cue krijgt opnieuw zijn
 *   beurt in dezelfde fase, zodra het programma terug is.
 *
 * Per sponsor staat ook in welke latere fases een tekort ingehaald mag worden (`catchUpIn`).
 * Standaard nergens: dan blijft een tekort open en staat het in het rapport.
 *
 * Pure logica: geen React, geen database.
 */

import type { PlanPhase } from "./season-plan";

/** Zelfde volgorde als `PLAN_PHASES` in season-plan.ts (hier herhaald: dat bestand importeert dit). */
const PLAN_PHASES: readonly PlanPhase[] = ["prematch", "firstHalf", "halftime", "secondHalf", "postmatch"];
import { playLogVisibleSec } from "./sponsor-play-ledger";

export type SponsorGuaranteeKind = "seconds" | "plays";

export type SponsorGuarantee = {
  kind: SponsorGuaranteeKind;
  /** Fases waarin een tekort uit een eerdere fase ingehaald mag worden. */
  catchUpIn: PlanPhase[];
};

export function defaultSponsorGuarantee(): SponsorGuarantee {
  return { kind: "seconds", catchUpIn: [] };
}

export function parseSponsorGuarantee(raw: string | null | undefined): SponsorGuarantee {
  const base = defaultSponsorGuarantee();
  if (!raw) return base;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== "object") return base;
    const catchUp = Array.isArray(o.catchUpIn) ? o.catchUpIn : [];
    return {
      kind: o.kind === "plays" ? "plays" : "seconds",
      catchUpIn: PLAN_PHASES.filter((p) => catchUp.includes(p)),
    };
  } catch {
    return base;
  }
}

/** Null voor de standaard, zodat een sponsor zonder afspraak geen JSON krijgt. */
export function serializeSponsorGuarantee(g: SponsorGuarantee): string | null {
  const catchUpIn = PLAN_PHASES.filter((p) => g.catchUpIn.includes(p));
  if (g.kind === "seconds" && catchUpIn.length === 0) return null;
  return JSON.stringify({ kind: g.kind, catchUpIn });
}

export function sameSponsorGuarantee(a: SponsorGuarantee, b: SponsorGuarantee): boolean {
  return serializeSponsorGuarantee(a) === serializeSponsorGuarantee(b);
}

export type CueGuarantee = "window" | "fullPlay" | "none";

/**
 * Soort boeking van een cue. Zonder expliciete keuze: een cue met eindtijd is een tijdvenster,
 * een cue zonder eindtijd speelt één keer op zijn moment (zoals vroeger).
 */
export function cueGuarantee(cue: {
  guarantee?: string | null;
  triggerSec: number;
  endSec?: number | null;
}): CueGuarantee {
  const hasWindow = cue.endSec != null && Number.isFinite(cue.endSec) && cue.endSec > cue.triggerSec;
  if (cue.guarantee === "fullPlay") return "fullPlay";
  if (cue.guarantee === "none") return "none";
  if (cue.guarantee === "window" && hasWindow) return "window";
  return hasWindow ? "window" : "none";
}

export function normalizeCueGuarantee(value: unknown): CueGuarantee | null {
  return value === "window" || value === "fullPlay" || value === "none" ? value : null;
}

/** Sta bij een afgesloten vertoning maximaal 50 ms afwijking van de spelerklok toe. */
export function isCompletePlay(row: {
  expectedSec: number;
  actualSec: number;
  actualMs?: number | null;
  state?: string;
}): boolean {
  if (!(row.expectedSec > 0) || (row.state != null && row.state !== "done")) return false;
  return playLogVisibleSec(row) + 0.05 >= row.expectedSec;
}

/**
 * Fases van een wedstrijd in volgorde, zoals de proof-of-play ze bewaart (laatste deel van
 * `segmentKey`). Verlenging hoort voor het inhalen bij de 2e helft.
 */
export const GUARANTEE_SEGMENTS = [
  "prematch",
  "FIRST_HALF",
  "halftime",
  "SECOND_HALF",
  "EXTRA_TIME",
  "postmatch",
] as const;
export type GuaranteeSegment = (typeof GUARANTEE_SEGMENTS)[number];

const PHASE_BY_SEGMENT: Record<GuaranteeSegment, PlanPhase> = {
  prematch: "prematch",
  FIRST_HALF: "firstHalf",
  halftime: "halftime",
  SECOND_HALF: "secondHalf",
  EXTRA_TIME: "secondHalf",
  postmatch: "postmatch",
};

export function planPhaseForSegment(segment: GuaranteeSegment): PlanPhase {
  return PHASE_BY_SEGMENT[segment];
}

/** Het fasedeel van een `segmentKey` (`<matchId>:FIRST_HALF` → `FIRST_HALF`). */
export function guaranteeSegmentOf(segmentKey: string | null | undefined): GuaranteeSegment | null {
  if (!segmentKey) return null;
  const tail = segmentKey.includes(":") ? segmentKey.slice(segmentKey.lastIndexOf(":") + 1) : segmentKey;
  return (GUARANTEE_SEGMENTS as readonly string[]).includes(tail) ? (tail as GuaranteeSegment) : null;
}

export type SegmentLedgerEntry = {
  /** Eigen geboekte seconden voor deze fase. */
  bookedSec: number;
  /** Zichtbare seconden die meetellen (bij "volledige vertoningen" alleen volledige clips). */
  deliveredSec: number;
};

export type SegmentShortfall = SegmentLedgerEntry & {
  /** Tekort uit eerdere fases dat hier ingehaald mag worden. */
  carryInSec: number;
  /** Wat na deze fase nog open staat van wat hier verschuldigd was (eigen + ingehaald). */
  shortSec: number;
};

export type ShortfallResult = {
  bySegment: Partial<Record<GuaranteeSegment, SegmentShortfall>>;
  /** Tekort dat na de laatste meegerekende fase nog open staat. */
  openSec: number;
};

/**
 * Tekort per fase, in de volgorde van een wedstrijd. Een fase in `catchUpIn` krijgt het open
 * tekort van eerdere fases erbij; wat ze niet inhaalt, blijft open. Een andere fase laat het
 * tekort ongemoeid en telt haar eigen tekort erbij. Meer spelen dan geboekt vult geen tekort
 * van een fase die niet mag inhalen.
 *
 * `upTo`: laatste fase die meetelt (de lopende fase); latere fases zijn nog niet begonnen.
 */
export function computeShortfall(
  ledger: Partial<Record<GuaranteeSegment, SegmentLedgerEntry>>,
  guarantee: SponsorGuarantee,
  upTo?: GuaranteeSegment | null,
): ShortfallResult {
  const bySegment: ShortfallResult["bySegment"] = {};
  let carry = 0;
  for (const seg of GUARANTEE_SEGMENTS) {
    const entry = ledger[seg];
    const bookedSec = Math.max(0, entry?.bookedSec ?? 0);
    const deliveredSec = Math.max(0, entry?.deliveredSec ?? 0);
    const catchUp = guarantee.catchUpIn.includes(planPhaseForSegment(seg));
    const carryInSec = catchUp ? carry : 0;
    const shortSec = Math.max(0, bookedSec + carryInSec - deliveredSec);
    if (entry || carryInSec > 0) bySegment[seg] = { bookedSec, deliveredSec, carryInSec, shortSec };
    carry = catchUp ? shortSec : carry + Math.max(0, bookedSec - deliveredSec);
    if (upTo && seg === upTo) break;
  }
  return { bySegment, openSec: carry };
}

/** Tekort dat in `segment` ingehaald mag worden (0 als die fase niet mag inhalen). */
export function carryInForSegment(
  ledger: Partial<Record<GuaranteeSegment, SegmentLedgerEntry>>,
  guarantee: SponsorGuarantee,
  segment: GuaranteeSegment,
): number {
  if (!guarantee.catchUpIn.includes(planPhaseForSegment(segment))) return 0;
  const idx = GUARANTEE_SEGMENTS.indexOf(segment);
  if (idx <= 0) return 0;
  return computeShortfall(ledger, guarantee, GUARANTEE_SEGMENTS[idx - 1]).openSec;
}

export type LiveGuaranteeInput = {
  id: string;
  name: string;
  bookedSec: number;
  carryInSec: number;
  deliveredSec: number;
};

export type LiveGuaranteeRow = LiveGuaranteeInput & {
  /** Nog verschuldigd in deze fase. */
  owedSec: number;
  /** Meer verschuldigd dan de fase nog kan geven na de reserve. */
  atRisk: boolean;
};

export type LiveGuaranteeView = {
  rows: LiveGuaranteeRow[];
  totalOwedSec: number;
  /** Seconden die de fase nog heeft na de reserve; null als de fase geen vast einde heeft. */
  availableSec: number | null;
  /** Samen meer verschuldigd dan er nog beschikbaar is. */
  overbooked: boolean;
};

/**
 * Wat elke sponsor in de lopende fase nog tegoed heeft tegenover wat de fase nog kan geven.
 * Sponsors delen de resterende tijd: ook als elk apart past, kan het samen te veel zijn.
 */
export function liveGuaranteeView(opts: {
  sponsors: readonly LiveGuaranteeInput[];
  phaseRemainingSec: number | null;
  reserveSec: number;
}): LiveGuaranteeView {
  const availableSec =
    opts.phaseRemainingSec == null || !Number.isFinite(opts.phaseRemainingSec)
      ? null
      : Math.max(0, opts.phaseRemainingSec - Math.max(0, opts.reserveSec));
  const rows = opts.sponsors.map((s) => {
    const owedSec = Math.max(0, s.bookedSec + s.carryInSec - s.deliveredSec);
    return { ...s, owedSec, atRisk: availableSec != null && owedSec > availableSec + 1e-6 };
  });
  const totalOwedSec = rows.reduce((sum, r) => sum + r.owedSec, 0);
  return {
    rows,
    totalOwedSec,
    availableSec,
    overbooked: availableSec != null && totalOwedSec > availableSec + 1e-6,
  };
}

/**
 * Seconden die de lopende fase nog duurt, of null als er geen vast einde is (verlenging,
 * na de wedstrijd, voor de wedstrijd zonder aftrapuur).
 */
export function phaseRemainingSec(opts: {
  status: string | null | undefined;
  /** Wedstrijdklok in seconden (loopt door over beide helften). */
  elapsedSec: number;
  halfDurationSec: number;
  halfBreakSec: number;
  /** Seconden sinds het begin van de rust, als bekend. */
  halftimeElapsedSec?: number | null;
  kickoffAtMs?: number | null;
  nowMs: number;
}): number | null {
  const H = Math.max(60, opts.halfDurationSec);
  switch (opts.status) {
    case "FIRST_HALF":
      return Math.max(0, H - Math.max(0, opts.elapsedSec));
    case "SECOND_HALF":
      return Math.max(0, 2 * H - Math.max(H, opts.elapsedSec));
    case "HALF_TIME":
      return opts.halftimeElapsedSec == null
        ? null
        : Math.max(0, Math.max(60, opts.halfBreakSec) - Math.max(0, opts.halftimeElapsedSec));
    case "SETUP":
    case "PREMATCH":
      return opts.kickoffAtMs == null ? null : Math.max(0, (opts.kickoffAtMs - opts.nowMs) / 1000);
    default:
      return null;
  }
}

/** Fase (segment) van een wedstrijdstatus, zoals `sponsorTelemetrySegmentKey` ze noemt. */
export function guaranteeSegmentForStatus(status: string | null | undefined): GuaranteeSegment | null {
  switch (status) {
    case "SETUP":
    case "PREMATCH":
      return "prematch";
    case "FIRST_HALF":
      return "FIRST_HALF";
    case "HALF_TIME":
      return "halftime";
    case "SECOND_HALF":
      return "SECOND_HALF";
    case "EXTRA_TIME":
      return "EXTRA_TIME";
    case "FULL_TIME":
    case "POST_MATCH":
      return "postmatch";
    default:
      return null;
  }
}

/** Een vertoning zoals de rapportage ze per sponsor, wedstrijd en fase optelt. */
export type BookingPlayRow = {
  sponsorId: string | null;
  matchId: string | null;
  segmentKey: string;
  expectedSec: number;
  actualSec: number;
  actualMs?: number | null;
  counted?: boolean | null;
  state?: string;
};

/** Geboekte tijd van een sponsor voor één fase van één wedstrijd, zoals bij de start vastgelegd. */
export type BookingSnapshotRow = {
  sponsorId: string;
  matchId: string;
  segmentKey: string;
  bookedSec: number;
  guaranteeJson: string | null;
};

export type SponsorBookingTotals = {
  bookedSec: number;
  /** Tekort dat na de laatste gespeelde fase nog open staat. */
  shortfallSec: number;
};

/**
 * Geboekte seconden en open tekort per sponsor over de gekozen wedstrijden en fases. Per
 * wedstrijd wordt het tekort in volgorde van de fases berekend, met de inhaalregels van de
 * sponsor zoals ze bij de start van elke fase golden.
 */
export function bookingTotalsBySponsor(
  snapshots: readonly BookingSnapshotRow[],
  plays: readonly BookingPlayRow[],
): Map<string, SponsorBookingTotals> {
  type Key = string;
  const perMatch = new Map<
    Key,
    { sponsorId: string; guarantee: SponsorGuarantee; ledger: Partial<Record<GuaranteeSegment, SegmentLedgerEntry>> }
  >();
  const keyOf = (sponsorId: string, matchId: string) => `${sponsorId}|${matchId}`;
  for (const s of snapshots) {
    const seg = guaranteeSegmentOf(s.segmentKey);
    if (!seg) continue;
    const k = keyOf(s.sponsorId, s.matchId);
    let entry = perMatch.get(k);
    if (!entry) {
      entry = { sponsorId: s.sponsorId, guarantee: parseSponsorGuarantee(s.guaranteeJson), ledger: {} };
      perMatch.set(k, entry);
    } else if (s.guaranteeJson) {
      entry.guarantee = parseSponsorGuarantee(s.guaranteeJson);
    }
    const cur = entry.ledger[seg] ?? { bookedSec: 0, deliveredSec: 0 };
    cur.bookedSec += Math.max(0, s.bookedSec);
    entry.ledger[seg] = cur;
  }
  for (const p of plays) {
    if (!p.sponsorId || !p.matchId || p.counted === false) continue;
    const entry = perMatch.get(keyOf(p.sponsorId, p.matchId));
    if (!entry) continue;
    const seg = guaranteeSegmentOf(p.segmentKey);
    if (!seg) continue;
    if (entry.guarantee.kind === "plays" && !isCompletePlay(p)) continue;
    const cur = entry.ledger[seg] ?? { bookedSec: 0, deliveredSec: 0 };
    cur.deliveredSec += playLogVisibleSec(p);
    entry.ledger[seg] = cur;
  }
  const out = new Map<string, SponsorBookingTotals>();
  for (const { sponsorId, guarantee, ledger } of perMatch.values()) {
    const booked = Object.values(ledger).reduce((sum, e) => sum + (e?.bookedSec ?? 0), 0);
    const { openSec } = computeShortfall(ledger, guarantee);
    const prev = out.get(sponsorId) ?? { bookedSec: 0, shortfallSec: 0 };
    out.set(sponsorId, { bookedSec: prev.bookedSec + booked, shortfallSec: prev.shortfallSec + openSec });
  }
  return out;
}

/**
 * Sponsor met het tekort dat hij in deze fase mag inhalen erbij geteld, op het budgetveld dat
 * de rotatie en het rooster voor die fase lezen. Zo plant het scherm de extra tijd gewoon mee.
 * Alleen voetbal (de kolommen per fase); een carry van 0 laat de sponsor ongewijzigd.
 */
export function sponsorWithCatchUp<
  S extends {
    prematchSeconds: number;
    matchSeconds: number;
    matchFirstHalfSeconds?: number | null;
    matchSecondHalfSeconds?: number | null;
    halftimeSeconds: number;
    postmatchSeconds?: number | null;
  },
>(sponsor: S, carrySec: number, status: string | null | undefined): S {
  const add = Math.ceil(Math.max(0, carrySec));
  if (add <= 0) return sponsor;
  const split = (sponsor.matchFirstHalfSeconds ?? 0) > 0 || (sponsor.matchSecondHalfSeconds ?? 0) > 0;
  switch (guaranteeSegmentForStatus(status)) {
    case "prematch":
      return { ...sponsor, prematchSeconds: sponsor.prematchSeconds + add };
    case "halftime":
      return { ...sponsor, halftimeSeconds: sponsor.halftimeSeconds + add };
    case "postmatch":
      return { ...sponsor, postmatchSeconds: (sponsor.postmatchSeconds ?? 0) + add };
    case "FIRST_HALF":
      return split
        ? {
            ...sponsor,
            matchFirstHalfSeconds: (sponsor.matchFirstHalfSeconds ?? 0) + add,
            matchSeconds: sponsor.matchSeconds + add,
          }
        : { ...sponsor, matchSeconds: sponsor.matchSeconds + add };
    case "SECOND_HALF":
    case "EXTRA_TIME":
      return split
        ? {
            ...sponsor,
            matchSecondHalfSeconds: (sponsor.matchSecondHalfSeconds ?? 0) + add,
            matchSeconds: sponsor.matchSeconds + add,
          }
        : { ...sponsor, matchSeconds: sponsor.matchSeconds + add };
    default:
      return sponsor;
  }
}
