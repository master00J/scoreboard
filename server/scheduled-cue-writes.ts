import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { cuePhaseMatches } from "../lib/scheduled-media-cue";
import { normalizeCueGuarantee } from "../lib/sponsor-guarantee";

const editSchema = z.object({
  id: z.string().min(1).optional(),
  mediaId: z.string().min(1).optional(),
  matchStatus: z.string().min(1).optional(),
  triggerSec: z.number().finite().transform(v => Math.max(0, Math.round(v))).optional(),
  endSec: z.number().finite().transform(Math.round).nullable().optional(),
  enabled: z.boolean().optional(),
  loop: z.boolean().optional(),
  guarantee: z.string().nullable().optional(),
});

class CueError extends Error {
  constructor(readonly status: number, readonly code: string, readonly title?: string) { super(code); }
}

/** Validate the final schedule inside the same transaction so moving consecutive spots is atomic. */
export async function writeScheduledCues(db: PrismaClient, input: unknown) {
  const edits = z.array(editSchema).nonempty().safeParse(input);
  if (!edits.success) return { status: 400, body: { error: "invalid_cue" } };
  try {
    const ids = await db.$transaction(async tx => {
      const ids: string[] = [];
      const check = new Set<string>();
      for (const { id, ...fields } of edits.data) {
        const old = id ? await tx.scheduledMediaCue.findUnique({ where: { id } }) : null;
        if (id && !old) throw new CueError(404, "missing_cue");
        const data = { ...fields, ...("guarantee" in fields ? { guarantee: normalizeCueGuarantee(fields.guarantee) } : {}) };
        if (fields.mediaId && !await tx.mediaItem.findUnique({ where: { id: fields.mediaId }, select: { id: true } })) {
          throw new CueError(400, "missing_media");
        }
        const mediaId = fields.mediaId ?? old?.mediaId;
        const matchStatus = fields.matchStatus ?? old?.matchStatus;
        const triggerSec = fields.triggerSec ?? old?.triggerSec;
        if (!mediaId || !matchStatus || triggerSec == null) throw new CueError(400, "invalid_cue");
        const end = fields.endSec === undefined ? old?.endSec : fields.endSec;
        if (end != null && end <= triggerSec) throw new CueError(400, "invalid_window");
        const saved = old
          ? await tx.scheduledMediaCue.update({ where: { id: old.id }, data })
          : await tx.scheduledMediaCue.create({ data: { ...data, mediaId, matchStatus, triggerSec } });
        ids.push(saved.id);
        if (saved.enabled && (!old || !old.enabled || old.matchStatus !== saved.matchStatus ||
            old.mediaId !== saved.mediaId || old.guarantee !== saved.guarantee || old.triggerSec !== saved.triggerSec || old.endSec !== saved.endSec)) check.add(saved.id);
      }
      if (check.size) {
        const active = await tx.scheduledMediaCue.findMany({ where: { enabled: true }, include: { media: { select: { durationSec: true, title: true } } } });
        const end = (c: typeof active[number]) => {
          const clipEnd = c.triggerSec + Math.max(1, c.media.durationSec || 10);
          return c.guarantee === "fullPlay" ? Math.max(c.endSec ?? 0, clipEnd) : c.endSec ?? clipEnd;
        };
        for (const cue of active.filter(c => check.has(c.id))) {
          const clash = active.find(c => c.id !== cue.id && cuePhaseMatches(c.matchStatus, cue.matchStatus) &&
            c.triggerSec < end(cue) && cue.triggerSec < end(c));
          if (clash) throw new CueError(409, "cue_overlap", clash.media.title);
        }
      }
      return ids;
    }, { timeout: 20000 });
    return { status: 200, body: { ok: true, id: ids[0], ids } };
  } catch (err) {
    if (err instanceof CueError) return { status: err.status, body: { error: err.code, title: err.title } };
    throw err;
  }
}
