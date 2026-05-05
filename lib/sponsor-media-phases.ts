import type { MediaItem, SponsorSection } from "./types";

export const SPONSOR_MEDIA_PHASES = [
  { id: "prematch", label: "Voor" },
  { id: "firstHalf", label: "1e helft" },
  { id: "secondHalf", label: "2e helft" },
  { id: "halftime", label: "Rust" },
  { id: "extraTime", label: "Verlenging" },
] as const;

export type SponsorMediaPhase = (typeof SPONSOR_MEDIA_PHASES)[number]["id"];

const VALID_PHASES = new Set<string>(SPONSOR_MEDIA_PHASES.map((p) => p.id));

export function parseSponsorMediaPhaseTags(raw: string | null | undefined): SponsorMediaPhase[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is SponsorMediaPhase => typeof v === "string" && VALID_PHASES.has(v));
  } catch {
    return [];
  }
}

export function serializeSponsorMediaPhaseTags(tags: SponsorMediaPhase[]): string | null {
  const clean = [...new Set(tags.filter((t) => VALID_PHASES.has(t)))];
  return clean.length > 0 ? JSON.stringify(clean) : null;
}

export function sponsorMediaPhaseFor(section: SponsorSection, matchStatus?: string): SponsorMediaPhase {
  if (section === "prematch") return "prematch";
  if (section === "halftime") return "halftime";
  if (matchStatus === "SECOND_HALF") return "secondHalf";
  if (matchStatus === "EXTRA_TIME") return "extraTime";
  return "firstHalf";
}

export function mediaAllowedForSponsorPhase(
  media: MediaItem,
  section: SponsorSection,
  matchStatus?: string,
): boolean {
  const tags = parseSponsorMediaPhaseTags(media.sponsorPhaseTagsJson);
  if (tags.length === 0) return true;

  if (section === "match" && !matchStatus) {
    return tags.some((t) => t === "firstHalf" || t === "secondHalf" || t === "extraTime");
  }

  return tags.includes(sponsorMediaPhaseFor(section, matchStatus));
}

export function sponsorMediaPhaseLabel(raw: string | null | undefined): string {
  const tags = parseSponsorMediaPhaseTags(raw);
  if (tags.length === 0) return "Alle fases";
  const labels = new Map(SPONSOR_MEDIA_PHASES.map((p) => [p.id, p.label]));
  return tags.map((t) => labels.get(t) ?? t).join(", ");
}
