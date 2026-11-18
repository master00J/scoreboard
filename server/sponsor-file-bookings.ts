import { z } from "zod";
import { buildSponsorAppearancePlan, sponsorRotationMedia, sponsorBudgetSectionFromMatchStatus } from "../lib/sponsor-distribution";
import { cueGuarantee, isCompletePlay } from "../lib/sponsor-guarantee";
import { cuePhaseMatches } from "../lib/scheduled-media-cue";
import { playLogVisibleSec } from "../lib/sponsor-play-ledger";
import type { Sponsor } from "../lib/types";

const fileBooking = z.object({
  mediaId: z.string(), title: z.string(), durationSec: z.number().positive(),
  plannedSec: z.number().nonnegative(), plannedPlays: z.number().int().nonnegative(),
});
export type FileBooking = z.infer<typeof fileBooking>;
export type FileDelivery = FileBooking & { deliveredSec: number; completePlays: number };

type Cue = {
  mediaId: string; matchStatus: string; triggerSec: number; endSec: number | null; guarantee: string | null;
  media: { title: string; durationSec: number; sponsorId: string | null };
};

/** Freeze the rotation and cue targets using the same clip order as the display. A sponsor's
 * scheduled spots also consume their rotation budget, as in the season plan. */
export function phaseFileBookings(s: Sponsor, status: string, budget: number, cues: Cue[]) {
  const section = sponsorBudgetSectionFromMatchStatus(status);
  const order = sponsorRotationMedia(s, section, status);
  const plan = buildSponsorAppearancePlan([s], section, status, () => budget)[0];
  const files = new Map<string, FileBooking>();
  const get = (id: string, title: string, duration: number) => {
    const row = files.get(id) ?? { mediaId: id, title, durationSec: Math.max(1, duration || 10), plannedSec: 0, plannedPlays: 0 };
    files.set(id, row);
    return row;
  };
  if (order.length) plan?.appearanceSecs.forEach((duration, i) => {
    const item = order[i % order.length]!;
    const row = get(item.id, item.title, duration);
    row.plannedPlays++;
    row.plannedSec += duration;
  });
  const cueTotals = new Map<string, { seconds: number; plays: number }>();
  let cueSeconds = 0;
  for (const c of cues) {
    if (c.media.sponsorId !== s.id || !cuePhaseMatches(c.matchStatus, status) || cueGuarantee(c) === "none") continue;
    const row = get(c.mediaId, c.media.title, c.media.durationSec);
    const duration = cueGuarantee(c) !== "fullPlay" && c.endSec != null ? c.endSec - c.triggerSec : row.durationSec;
    const totals = cueTotals.get(c.mediaId) ?? { seconds: 0, plays: 0 };
    totals.seconds += duration;
    if (cueGuarantee(c) === "fullPlay") totals.plays++;
    cueSeconds += duration;
    cueTotals.set(c.mediaId, totals);
  }
  for (const [id, total] of cueTotals) {
    const row = files.get(id)!;
    row.plannedSec = Math.max(row.plannedSec, total.seconds);
    row.plannedPlays = Math.max(row.plannedPlays, total.plays);
  }
  return { files: Array.from(files.values()), cueSeconds };
}

export function readFileBookings(raw: string | null): FileBooking[] {
  if (!raw) return [];
  try {
    const parsed = z.array(fileBooking).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch { return []; }
}

type Play = { mediaId: string | null; state: string; actualMs: number; actualSec: number; counted: boolean };
export function fileDeliveries(plan: FileBooking[], plays: Play[]): FileDelivery[] {
  const files = new Map(plan.map(f => [f.mediaId, { ...f, deliveredSec: 0, completePlays: 0 }]));
  for (const p of plays) {
    const file = p.mediaId && files.get(p.mediaId);
    if (!file || !p.counted) continue;
    const seconds = playLogVisibleSec(p);
    file.deliveredSec += seconds;
    if (isCompletePlay({ ...p, expectedSec: file.durationSec })) file.completePlays++;
  }
  return Array.from(files.values());
}
