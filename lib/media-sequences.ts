/**
 * Reeksen: bestanden die altijd direct na elkaar spelen, in een vaste volgorde (1, 2, 3, …).
 *
 * Een reeks mag bestanden van verschillende sponsors en clubmedia bevatten. In de rotatie is ze één
 * deelnemer (`seq:<id>`) met eigen minuten per fase, net als clubmedia. Elke beurt speelt de hele reeks,
 * van het eerste tot het laatste bestand. Een bestand in een reeks speelt niet meer los in de rotatie van
 * zijn sponsor of clubmedia. In het afspeellog telt elk bestand wel onder zijn eigen sponsor.
 *
 * De minuten van een reeks worden naar boven afgerond op hele reeksen: de rotatie start een reeks alleen
 * als die helemaal past, en het scherm stopt een reeks nooit halverwege omdat de minuten op zijn.
 */

import type { MediaItem, Sponsor } from "./types";
import {
  EMPTY_CLUB_PHASE_BUDGET,
  clubPhaseBudgetTotalSeconds,
  parseClubPhaseBudgetJson,
  type ClubPhaseBudget,
} from "./club-media-rotation";
import { serializeSponsorMediaPhaseTags, type SponsorMediaPhase } from "./sponsor-media-phases";

/** Virtuele rotatie-id van een reeks. */
export const SEQUENCE_ROTATION_ID_PREFIX = "seq:";

export type MediaSequence = {
  id: string;
  name: string;
  active: boolean;
  notes: string;
  /** Media-id's in afspeelvolgorde. Een bestand staat in hoogstens één reeks. */
  mediaIds: string[];
  /** Gewenste schermtijd per fase in seconden; de rotatie rondt af op hele reeksen. */
  budget: ClubPhaseBudget;
};

/** Hoeveel bestanden een reeks hoogstens telt. */
export const MAX_SEQUENCE_ITEMS = 50;
/** Hoeveel reeksen er hoogstens zijn. */
export const MAX_SEQUENCES = 200;

export function isSequenceRotationSponsorId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(SEQUENCE_ROTATION_ID_PREFIX);
}

export function sequenceRotationSponsorId(sequenceId: string): string {
  return `${SEQUENCE_ROTATION_ID_PREFIX}${sequenceId}`;
}

export function sequenceIdFromRotationId(id: string): string | null {
  if (!isSequenceRotationSponsorId(id)) return null;
  return id.slice(SEQUENCE_ROTATION_ID_PREFIX.length) || null;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Leest de reeksen uit `AppSettings.mediaSequencesJson`. Ongeldige reeksen vallen weg; een bestand dat al in
 * een eerdere reeks staat, wordt in een latere overgeslagen.
 */
export function parseMediaSequencesJson(raw: string | null | undefined): MediaSequence[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return normalizeMediaSequences(parsed);
}

export function normalizeMediaSequences(value: unknown): MediaSequence[] {
  if (!Array.isArray(value)) return [];
  const out: MediaSequence[] = [];
  const usedIds = new Set<string>();
  const usedMedia = new Set<string>();
  for (const entry of value) {
    if (out.length >= MAX_SEQUENCES) break;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    const id = cleanText(rec.id, 64);
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || usedIds.has(id)) continue;
    const mediaIds: string[] = [];
    for (const m of Array.isArray(rec.mediaIds) ? rec.mediaIds : []) {
      const mediaId = cleanText(m, 64);
      if (!mediaId || usedMedia.has(mediaId) || mediaIds.length >= MAX_SEQUENCE_ITEMS) continue;
      mediaIds.push(mediaId);
      usedMedia.add(mediaId);
    }
    usedIds.add(id);
    out.push({
      id,
      name: cleanText(rec.name, 120),
      active: rec.active !== false,
      notes: cleanText(rec.notes, 500),
      mediaIds,
      budget:
        rec.budget && typeof rec.budget === "object"
          ? parseClubPhaseBudgetJson(JSON.stringify(rec.budget))
          : { ...EMPTY_CLUB_PHASE_BUDGET },
    });
  }
  return out;
}

export function serializeMediaSequences(sequences: MediaSequence[]): string | null {
  const clean = normalizeMediaSequences(sequences);
  return clean.length > 0 ? JSON.stringify(clean) : null;
}

/** Een nieuw, uniek reeks-id. */
export function newSequenceId(existing: Iterable<string>, now = Date.now()): string {
  const taken = new Set(existing);
  let n = 0;
  for (;;) {
    const id = `s${now.toString(36)}${n > 0 ? `-${n}` : ""}`;
    if (!taken.has(id)) return id;
    n += 1;
  }
}

/** Duur van één bestand in een reeks: video uit het bestand, foto uit het item of de standaard van zijn sponsor. */
export function sequenceItemSeconds(item: MediaItem, imageDefaultSec = 10): number {
  if (item.type === "VIDEO") return Math.max(1, item.durationSec > 0 ? item.durationSec : 10);
  return Math.max(1, item.durationSec > 0 ? item.durationSec : imageDefaultSec || 10);
}

/** Minuten naar boven afgerond op hele reeksen van `passSec`. */
export function wholeSequenceSeconds(budgetSec: number, passSec: number): number {
  if (!(budgetSec > 0) || !(passSec > 0)) return 0;
  return Math.ceil(budgetSec / passSec - 1e-9) * passSec;
}

function phaseTagsForBudget(budget: ClubPhaseBudget): string | null {
  const tags: SponsorMediaPhase[] = [];
  if (budget.prematch > 0) tags.push("prematch");
  if (budget.firstHalf > 0) tags.push("firstHalf");
  if (budget.secondHalf > 0) tags.push("secondHalf", "extraTime");
  if (budget.halftime > 0) tags.push("halftime");
  if (budget.postmatch > 0) tags.push("postmatch");
  return serializeSponsorMediaPhaseTags(tags);
}

/** Een speelbaar bestand voor een reeks, met de standaardduur voor foto's van zijn sponsor. */
export type SequenceMember = { media: MediaItem; imageDefaultSec?: number };

/**
 * Een reeks als deelnemer aan de rotatie. Null als de reeks uit staat, geen minuten heeft of geen
 * speelbaar bestand. De bestanden spelen in elke fase waar de reeks minuten heeft (hun eigen fase-tags
 * gelden binnen een reeks niet: de reeks speelt altijd helemaal).
 */
export function sequenceToRotationSponsor(
  sequence: MediaSequence,
  members: Map<string, SequenceMember>,
): Sponsor | null {
  if (!sequence.active) return null;
  if (clubPhaseBudgetTotalSeconds(sequence.budget) <= 0) return null;
  const tags = phaseTagsForBudget(sequence.budget);
  const media: MediaItem[] = [];
  for (const id of sequence.mediaIds) {
    const member = members.get(id);
    if (!member || !member.media.active) continue;
    media.push({
      ...member.media,
      durationSec: sequenceItemSeconds(member.media, member.imageDefaultSec),
      sponsorPhaseTagsJson: tags,
    });
  }
  if (media.length === 0) return null;
  const passSec = media.reduce((sum, m) => sum + m.durationSec, 0);
  const b = sequence.budget;
  const firstHalf = wholeSequenceSeconds(b.firstHalf, passSec);
  const secondHalf = wholeSequenceSeconds(b.secondHalf, passSec);
  return {
    id: sequenceRotationSponsorId(sequence.id),
    name: sequence.name || sequence.id,
    active: true,
    prematchSeconds: wholeSequenceSeconds(b.prematch, passSec),
    matchSeconds: firstHalf + secondHalf,
    matchFirstHalfSeconds: firstHalf,
    matchSecondHalfSeconds: secondHalf,
    halftimeSeconds: wholeSequenceSeconds(b.halftime, passSec),
    postmatchSeconds: wholeSequenceSeconds(b.postmatch, passSec),
    imageDefaultSec: 10,
    createdAt: new Date(0).toISOString(),
    media,
    sponsorPlaybackOrderJson: JSON.stringify(media.map((m) => m.id)),
    sponsorPlaybackRepeatsJson: null,
    notes: sequence.notes || null,
    rotationKind: "sequence",
  };
}

/** Media-id's die in een reeks staan die nu meedraait. */
export function sequencedMediaIds(sequences: MediaSequence[]): Set<string> {
  const out = new Set<string>();
  for (const s of sequences) {
    if (!s.active || clubPhaseBudgetTotalSeconds(s.budget) <= 0) continue;
    for (const id of s.mediaIds) out.add(id);
  }
  return out;
}

/**
 * Voegt de reeksen toe aan de rotatie. Bestanden in een reeks die meedraait, gaan uit de rotatie van hun
 * sponsor of clubmedia: ze spelen alleen nog in hun reeks. Reeksen die uit staan of geen minuten hebben,
 * veranderen niets.
 */
export function applyMediaSequences(
  participants: Sponsor[],
  sequences: MediaSequence[],
  members: Map<string, SequenceMember>,
): Sponsor[] {
  const extra = sequences
    .map((s) => sequenceToRotationSponsor(s, members))
    .filter((p): p is Sponsor => p != null);
  if (extra.length === 0) return participants;
  const taken = new Set<string>();
  for (const p of extra) for (const m of p.media ?? []) taken.add(m.id);
  const rest = participants.map((p) => {
    const media = p.media ?? [];
    if (!media.some((m) => taken.has(m.id))) return p;
    return { ...p, media: media.filter((m) => !taken.has(m.id)) };
  });
  return [...rest, ...extra];
}

/** Totale duur van één doorloop van een reeks-deelnemer (alle bestanden na elkaar). */
export function sequencePassSeconds(participant: Sponsor): number {
  return (participant.media ?? []).reduce((sum, m) => sum + sequenceItemSeconds(m, participant.imageDefaultSec), 0);
}

export function isSequenceParticipant(participant: Pick<Sponsor, "rotationKind"> | null | undefined): boolean {
  return participant?.rotationKind === "sequence";
}

/**
 * Bij welke clip-index een nieuwe beurt van een reeks begint. Een vorige beurt die halverwege stopte
 * (fasewissel, onderbreking) laat de cursor midden in de reeks staan; de volgende beurt begint dan weer
 * bij het eerste bestand.
 */
export function sequenceStartIndex(cursor: number, length: number): number {
  if (length <= 0 || cursor <= 0) return 0;
  const rest = cursor % length;
  return rest === 0 ? cursor : cursor + (length - rest);
}
