import type { Prisma } from "@prisma/client";
import type { Db } from "./db";
import { sponsorPlaySegmentKeyCondition } from "../lib/sponsor-play-filters";

/** Proof-of-play queries for the local API (`/api/sponsor-plays*` in electron/runtime.ts). */

export type SponsorPlayFilters = {
  matchId?: string;
  sponsorId?: string;
  /** A phase (`FIRST_HALF`, `postmatch`, …) or a full segment key (`<matchId>:<phase>`). */
  segmentKey?: string;
  fromIso?: string;
  toIso?: string;
};

export const SPONSOR_PLAYS_DEFAULT_LIMIT = 500;
export const SPONSOR_PLAYS_MAX_LIMIT = 2000;

export function parseSponsorPlayFilters(params: URLSearchParams): SponsorPlayFilters {
  return {
    matchId: params.get("matchId") || undefined,
    sponsorId: params.get("sponsorId") || undefined,
    segmentKey: params.get("segmentKey") || undefined,
    fromIso: params.get("from") || undefined,
    toIso: params.get("to") || undefined,
  };
}

export function buildSponsorPlayWhere(f: SponsorPlayFilters): Prisma.SponsorPlayLogWhereInput {
  const where: Prisma.SponsorPlayLogWhereInput = {};
  if (f.matchId) where.matchId = f.matchId;
  if (f.sponsorId) where.sponsorId = f.sponsorId;
  const segment = sponsorPlaySegmentKeyCondition(f.segmentKey);
  if (segment) where.segmentKey = segment;
  if (f.fromIso || f.toIso) {
    const range: { gte?: Date; lte?: Date } = {};
    if (f.fromIso) {
      const d = new Date(f.fromIso);
      if (!Number.isNaN(d.valueOf())) range.gte = d;
    }
    if (f.toIso) {
      const d = new Date(f.toIso);
      if (!Number.isNaN(d.valueOf())) range.lte = d;
    }
    if (Object.keys(range).length > 0) where.endedAt = range;
  }
  return where;
}

/**
 * Detail rows, newest first. The screen list is capped (`limit`, default 500); an export asks
 * for `all` so the file lists every play that its totals count.
 */
export function sponsorPlayListLimit(params: URLSearchParams): number | undefined {
  if (params.get("all") === "1") return undefined;
  const raw = Number(params.get("limit") ?? SPONSOR_PLAYS_DEFAULT_LIMIT);
  const n = Number.isFinite(raw) ? Math.floor(raw) : SPONSOR_PLAYS_DEFAULT_LIMIT;
  return Math.min(SPONSOR_PLAYS_MAX_LIMIT, Math.max(1, n));
}

export async function listSponsorPlays(db: Db, filters: SponsorPlayFilters, limit: number | undefined) {
  return db.sponsorPlayLog.findMany({
    where: buildSponsorPlayWhere(filters),
    orderBy: { endedAt: "desc" },
    ...(limit != null ? { take: limit } : {}),
    include: {
      match: {
        select: {
          id: true,
          kickoffAt: true,
          homeTeam: { select: { name: true, shortName: true } },
          awayTeam: { select: { name: true, shortName: true } },
        },
      },
    },
  });
}

/** Per-sponsor aggregate over every matching play (not capped). */
export async function summarizeSponsorPlays(db: Db, filters: SponsorPlayFilters) {
  const grouped = await db.sponsorPlayLog.groupBy({
    by: ["sponsorId", "sponsorName"],
    where: buildSponsorPlayWhere(filters),
    _count: { _all: true },
    _sum: { actualSec: true, expectedSec: true },
  });
  return grouped
    .map((g) => ({
      sponsorId: g.sponsorId,
      sponsorName: g.sponsorName,
      plays: g._count._all,
      actualSec: g._sum.actualSec ?? 0,
      expectedSec: g._sum.expectedSec ?? 0,
    }))
    .sort((a, b) => b.actualSec - a.actualSec);
}
