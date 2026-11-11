import type { MediaItem, Sponsor } from "./types";
import {
  serializeSponsorMediaPhaseTags,
  type SponsorMediaPhase,
} from "./sponsor-media-phases";

/** Virtuele rotatie-id voor clubmedia, zodat ze dezelfde engine als sponsors gebruiken. */
export const CLUB_ROTATION_ID_PREFIX = "club:";

/** Display, HUD en rooster: sponsors plus clubmedia met zendtijd. */
export const SPONSOR_ROTATION_API = "/api/sponsors?rotation=1";

export type ClubPhaseBudget = {
  prematch: number;
  firstHalf: number;
  secondHalf: number;
  halftime: number;
  postmatch: number;
};

export const EMPTY_CLUB_PHASE_BUDGET: ClubPhaseBudget = {
  prematch: 0,
  firstHalf: 0,
  secondHalf: 0,
  halftime: 0,
  postmatch: 0,
};

export function isClubRotationSponsorId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(CLUB_ROTATION_ID_PREFIX);
}

export function clubRotationSponsorId(mediaId: string): string {
  return `${CLUB_ROTATION_ID_PREFIX}${mediaId}`;
}

export function clubRotationMediaId(sponsorId: string): string | null {
  if (!isClubRotationSponsorId(sponsorId)) return null;
  return sponsorId.slice(CLUB_ROTATION_ID_PREFIX.length) || null;
}

function asSeconds(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

export function parseClubPhaseBudgetJson(raw: string | null | undefined): ClubPhaseBudget {
  if (!raw) return { ...EMPTY_CLUB_PHASE_BUDGET };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...EMPTY_CLUB_PHASE_BUDGET };
    }
    return {
      prematch: asSeconds(parsed.prematch),
      firstHalf: asSeconds(parsed.firstHalf),
      secondHalf: asSeconds(parsed.secondHalf),
      halftime: asSeconds(parsed.halftime),
      postmatch: asSeconds(parsed.postmatch),
    };
  } catch {
    return { ...EMPTY_CLUB_PHASE_BUDGET };
  }
}

export function clubPhaseBudgetTotalSeconds(budget: ClubPhaseBudget): number {
  return (
    budget.prematch +
    budget.firstHalf +
    budget.secondHalf +
    budget.halftime +
    budget.postmatch
  );
}

export function serializeClubPhaseBudgetJson(budget: ClubPhaseBudget): string | null {
  const next: ClubPhaseBudget = {
    prematch: asSeconds(budget.prematch),
    firstHalf: asSeconds(budget.firstHalf),
    secondHalf: asSeconds(budget.secondHalf),
    halftime: asSeconds(budget.halftime),
    postmatch: asSeconds(budget.postmatch),
  };
  return clubPhaseBudgetTotalSeconds(next) > 0 ? JSON.stringify(next) : null;
}

function createdAtIso(value: string | Date | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return new Date(0).toISOString();
}

function phaseTagsForBudget(budget: ClubPhaseBudget): string | null {
  const tags: SponsorMediaPhase[] = [];
  if (budget.prematch > 0) tags.push("prematch");
  if (budget.firstHalf > 0) tags.push("firstHalf");
  if (budget.secondHalf > 0) {
    tags.push("secondHalf");
    tags.push("extraTime");
  }
  if (budget.halftime > 0) tags.push("halftime");
  if (budget.postmatch > 0) tags.push("postmatch");
  return serializeSponsorMediaPhaseTags(tags);
}

/**
 * Zet losse clubmedia om naar een rotatie-deelnemer. Geen echte sponsorrij:
 * zelfde budget-engine, zelfde slotmap, zelfde HUD.
 */
export function clubMediaToRotationSponsor(media: MediaItem): Sponsor | null {
  if (!media.active || media.sponsorId || media.hideFromLibrary) return null;
  const budget = parseClubPhaseBudgetJson(media.clubPhaseBudgetJson);
  if (clubPhaseBudgetTotalSeconds(budget) <= 0) return null;

  const clip: MediaItem = {
    ...media,
    sponsorName: null,
    sponsorId: null,
    sponsorPhaseTagsJson: phaseTagsForBudget(budget),
  };

  return {
    id: clubRotationSponsorId(media.id),
    name: media.title,
    active: true,
    prematchSeconds: budget.prematch,
    matchSeconds: budget.firstHalf + budget.secondHalf,
    matchFirstHalfSeconds: budget.firstHalf,
    matchSecondHalfSeconds: budget.secondHalf,
    halftimeSeconds: budget.halftime,
    postmatchSeconds: budget.postmatch,
    imageDefaultSec: Math.max(1, media.durationSec || 15),
    createdAt: createdAtIso(media.createdAt),
    media: [clip],
    rotationKind: "club",
  };
}

export function mergeSponsorsWithClubMedia(
  sponsors: Sponsor[],
  media: MediaItem[] | null | undefined,
): Sponsor[] {
  const extra: Sponsor[] = [];
  const seen = new Set(sponsors.map((s) => s.id));
  for (const item of media ?? []) {
    const club = clubMediaToRotationSponsor(item);
    if (!club || seen.has(club.id)) continue;
    seen.add(club.id);
    extra.push(club);
  }
  return extra.length === 0 ? sponsors : [...sponsors, ...extra];
}
