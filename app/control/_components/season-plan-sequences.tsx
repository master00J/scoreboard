"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, ListOrdered, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useApi } from "@/lib/use-api";
import type { MediaItem, Sponsor } from "@/lib/types";
import {
  newSequenceId,
  sequenceItemSeconds,
  type MediaSequence,
} from "@/lib/media-sequences";
import { EMPTY_CLUB_PHASE_BUDGET, type ClubPhaseBudget } from "@/lib/club-media-rotation";
import { PLAN_PHASES, formatClock, formatMinutes, parseMinutes, type PlanPhase } from "@/lib/season-plan";

const SEQUENCES_API = "/api/media-sequences";

/**
 * De reeksen van deze pc. Elke wijziging leest eerst de laatste stand en schrijft dan alles terug, zodat twee
 * bedieningspanelen elkaars wijziging niet overschrijven.
 */
export function useMediaSequences(stateStamp: string) {
  const { t } = useTranslation();
  const { data } = useApi<MediaSequence[]>(`${SEQUENCES_API}?_=${stateStamp}`);
  const [sequences, setSequences] = useState<MediaSequence[]>([]);
  useEffect(() => {
    if (Array.isArray(data)) setSequences(data);
  }, [data]);

  async function mutate(change: (list: MediaSequence[]) => MediaSequence[]): Promise<MediaSequence[] | null> {
    try {
      const latestRes = await fetch(SEQUENCES_API);
      const latest = latestRes.ok ? ((await latestRes.json()) as unknown) : null;
      const base = Array.isArray(latest) ? (latest as MediaSequence[]) : sequences;
      const res = await fetch(SEQUENCES_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sequences: change(base) }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const saved = (await res.json()) as MediaSequence[];
      setSequences(saved);
      return saved;
    } catch {
      toast({ title: t("seasonPlan.sequenceSaveFailed"), variant: "error" });
      return null;
    }
  }

  return { sequences, mutate };
}

export type SequenceMutate = ReturnType<typeof useMediaSequences>["mutate"];

/** Een nieuwe, lege reeks; de club voegt er daarna bestanden aan toe in de volgorde waarin ze spelen. */
export function newMediaSequence(existing: MediaSequence[], name: string): MediaSequence {
  return {
    id: newSequenceId(existing.map((s) => s.id)),
    name,
    active: true,
    notes: "",
    mediaIds: [],
    budget: { ...EMPTY_CLUB_PHASE_BUDGET },
  };
}

const BUDGET_KEY: Record<PlanPhase, keyof ClubPhaseBudget> = {
  prematch: "prematch",
  firstHalf: "firstHalf",
  halftime: "halftime",
  secondHalf: "secondHalf",
  postmatch: "postmatch",
};

/** Voor elk bestand in een reeks: in welke reeks en op welke plaats. */
export function sequencePositions(sequences: MediaSequence[]): Map<string, { name: string; position: number }> {
  const out = new Map<string, { name: string; position: number }>();
  for (const s of sequences) s.mediaIds.forEach((id, i) => out.set(id, { name: s.name || s.id, position: i + 1 }));
  return out;
}

function ownerName(t: TFunction, media: MediaItem, sponsorsById: Map<string, Sponsor>): string {
  if (media.sponsorId) return sponsorsById.get(media.sponsorId)?.name ?? media.sponsorName ?? t("seasonPlan.groupSponsors");
  return t("seasonPlan.sequenceOwnerClub");
}

function itemSeconds(media: MediaItem, sponsorsById: Map<string, Sponsor>): number {
  const owner = media.sponsorId ? sponsorsById.get(media.sponsorId) : undefined;
  return sequenceItemSeconds(media, owner?.imageDefaultSec);
}

/**
 * De groep "Reeksen" in de tabel van het seizoensplan: per reeks naam, aan/uit, minuten per fase en een
 * notitie, en opengeklapt de bestanden in volgorde. Wijzigingen gaan meteen naar de pc (geen aparte
 * opslaanknop): de volgorde aanpassen of een bestand toevoegen werkt dus ook tijdens een wedstrijd.
 */
export function SequenceRows({
  sequences,
  mutate,
  media,
  sponsorsById,
  effective,
  decimal,
}: {
  sequences: MediaSequence[];
  mutate: SequenceMutate;
  media: MediaItem[];
  sponsorsById: Map<string, Sponsor>;
  effective: Map<string, Record<PlanPhase, number>>;
  decimal: string;
}) {
  const { t } = useTranslation();
  /** Opengeklapt: door de club geopend, of een lege reeks die ze niet dichtklapte (daar komen de bestanden). */
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const isOpen = (seq: MediaSequence) => opened.has(seq.id) || (seq.mediaIds.length === 0 && !closed.has(seq.id));
  const mediaById = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const taken = useMemo(() => sequencePositions(sequences), [sequences]);
  /** Bestanden die nog in geen reeks staan, per sponsor (clubmedia laatst), om toe te voegen. */
  const options = useMemo(() => {
    const groups = new Map<string, MediaItem[]>();
    for (const m of media) {
      if (m.hideFromLibrary || taken.has(m.id)) continue;
      const owner = ownerName(t, m, sponsorsById);
      groups.set(owner, [...(groups.get(owner) ?? []), m]);
    }
    const club = t("seasonPlan.sequenceOwnerClub");
    return [...groups.entries()].sort(([a], [b]) => (a === club ? 1 : b === club ? -1 : a.localeCompare(b)));
  }, [media, taken, sponsorsById, t]);

  function setOpen(id: string, open: boolean) {
    const edit = (add: boolean) => (cur: Set<string>) => {
      const next = new Set(cur);
      if (add) next.add(id);
      else next.delete(id);
      return next;
    };
    setOpened(edit(open));
    setClosed(edit(!open));
  }

  function update(id: string, change: (s: MediaSequence) => MediaSequence) {
    void mutate((list) => list.map((s) => (s.id === id ? change(s) : s)));
  }

  function move(seq: MediaSequence, index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= seq.mediaIds.length) return;
    update(seq.id, (s) => {
      const ids = [...s.mediaIds];
      [ids[index], ids[target]] = [ids[target]!, ids[index]!];
      return { ...s, mediaIds: ids };
    });
  }

  if (sequences.length === 0) return null;

  return (
    <>
      {sequences.map((seq) => {
        const items = seq.mediaIds.map((id) => mediaById.get(id)).filter((m): m is MediaItem => m != null);
        const passSec = items.reduce((sum, m) => sum + (m.active ? itemSeconds(m, sponsorsById) : 0), 0);
        const eff = effective.get(seq.id);
        const open = isOpen(seq);
        return (
          <Fragment key={seq.id}>
            <tr className={`border-b border-border/60 ${seq.active ? "" : "opacity-60"}`}>
              <td className="py-1 pr-2 align-top">
                <div className="flex items-center gap-1">
                  <ListOrdered className="size-4 shrink-0 text-muted-foreground" />
                  <Input
                    key={`name:${seq.name}`}
                    defaultValue={seq.name}
                    aria-label={t("seasonPlan.sequenceName")}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name !== seq.name) update(seq.id, (s) => ({ ...s, name }));
                    }}
                    className="h-8 min-w-40"
                  />
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                    title={t("seasonPlan.sequenceDelete")}
                    onClick={() => {
                      if (window.confirm(t("seasonPlan.sequenceDeleteConfirm", { name: seq.name || seq.id }))) {
                        void mutate((list) => list.filter((s) => s.id !== seq.id));
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </td>
              <td className="px-1 py-1 text-center align-top">
                <input
                  type="checkbox"
                  checked={seq.active}
                  onChange={(e) => update(seq.id, (s) => ({ ...s, active: e.target.checked }))}
                  className="mt-2 size-4 accent-primary"
                  aria-label={t("seasonPlan.colActive")}
                />
              </td>
              {PLAN_PHASES.map((phase) => {
                const planned = seq.budget[BUDGET_KEY[phase]];
                const shown = eff?.[phase] ?? 0;
                const rounded = seq.active && planned > 0 && shown > 0 && Math.abs(shown - planned) >= 1;
                const notShown = seq.active && planned > 0 && shown === 0;
                return (
                  <td key={phase} className="px-1 py-1 align-top">
                    <input
                      key={`${phase}:${planned}`}
                      inputMode="decimal"
                      defaultValue={formatMinutes(planned, decimal)}
                      placeholder="0"
                      aria-label={t("seasonPlan.sequenceMinutes")}
                      onFocus={(e) => e.target.select()}
                      onBlur={(e) => {
                        const text = e.target.value;
                        const sec = text.trim() === "" ? 0 : parseMinutes(text);
                        if (sec == null) {
                          e.target.value = formatMinutes(planned, decimal);
                          return;
                        }
                        if (sec !== planned) {
                          update(seq.id, (s) => ({ ...s, budget: { ...s.budget, [BUDGET_KEY[phase]]: sec } }));
                        }
                      }}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-right tabular-nums outline-none focus:ring-2 focus:ring-ring"
                    />
                    {notShown ? (
                      <div className="mt-0.5 text-right text-[10px] text-amber-500" title={t("seasonPlan.sequenceNoFiles")}>
                        {t("seasonPlan.shownNone")}
                      </div>
                    ) : rounded ? (
                      <div
                        className="mt-0.5 text-right text-[10px] text-muted-foreground"
                        title={t("seasonPlan.sequenceRounded", { pass: formatClock(passSec) })}
                      >
                        ≈ {formatMinutes(shown, decimal)}
                      </div>
                    ) : null}
                  </td>
                );
              })}
              <td className="px-2 py-1 text-center align-top">
                <div className="mt-1 flex items-center justify-center gap-1">
                  {seq.active && items.length === 0 ? (
                    <span title={t("seasonPlan.sequenceNoFiles")}>
                      <AlertTriangle className="size-4 text-amber-500" />
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 rounded px-1 tabular-nums hover:bg-accent"
                    title={t("seasonPlan.showFiles")}
                    onClick={() => setOpen(seq.id, !open)}
                  >
                    {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    {items.length}
                  </button>
                </div>
              </td>
              <td className="py-1 pl-2 align-top">
                <Input
                  key={`notes:${seq.notes}`}
                  defaultValue={seq.notes}
                  aria-label={t("seasonPlan.colNotes")}
                  onBlur={(e) => {
                    const notes = e.target.value.trim();
                    if (notes !== seq.notes) update(seq.id, (s) => ({ ...s, notes }));
                  }}
                  className="h-8 min-w-56"
                />
              </td>
            </tr>
            {open ? (
              <tr className="border-b border-border/60 bg-muted/30">
                <td colSpan={9} className="px-4 py-3">
                  {items.length === 0 ? (
                    <p className="mb-2 text-sm text-muted-foreground">{t("seasonPlan.sequenceEmpty")}</p>
                  ) : (
                    <ol className="mb-2 space-y-1">
                      {seq.mediaIds.map((id, index) => {
                        const m = mediaById.get(id);
                        if (!m) return null;
                        return (
                          <li key={id} className={`flex flex-wrap items-center gap-2 ${m.active ? "" : "opacity-50"}`}>
                            <span className="w-6 text-right text-sm font-bold tabular-nums">{index + 1}.</span>
                            <span className="w-40 truncate text-xs text-muted-foreground">{ownerName(t, m, sponsorsById)}</span>
                            <span className="w-64 truncate text-sm" title={m.path}>
                              {m.title}
                            </span>
                            <span className="w-16 text-xs tabular-nums text-muted-foreground">
                              {m.type === "IMAGE"
                                ? t("seasonPlan.clipImage", { sec: itemSeconds(m, sponsorsById) })
                                : formatClock(itemSeconds(m, sponsorsById))}
                            </span>
                            {!m.active ? <span className="text-xs text-muted-foreground">{t("seasonPlan.clipInactive")}</span> : null}
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                              disabled={index === 0}
                              title={t("seasonPlan.sequenceMoveUp")}
                              onClick={() => move(seq, index, -1)}
                            >
                              <ArrowUp className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                              disabled={index === seq.mediaIds.length - 1}
                              title={t("seasonPlan.sequenceMoveDown")}
                              onClick={() => move(seq, index, 1)}
                            >
                              <ArrowDown className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-accent"
                              title={t("seasonPlan.sequenceRemoveFile")}
                              onClick={() => update(seq.id, (s) => ({ ...s, mediaIds: s.mediaIds.filter((x) => x !== id) }))}
                            >
                              <X className="size-3.5" />
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      className="h-8 max-w-md rounded-md border border-input bg-background px-2 text-sm"
                      value=""
                      aria-label={t("seasonPlan.sequenceAddFile")}
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) return;
                        setOpen(seq.id, true);
                        update(seq.id, (s) => ({ ...s, mediaIds: [...s.mediaIds, id] }));
                      }}
                    >
                      <option value="">{t("seasonPlan.sequenceAddFile")}</option>
                      {options.map(([owner, list]) => (
                        <optgroup key={owner} label={owner}>
                          {list.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.title}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {passSec > 0 ? (
                      <span className="text-xs text-muted-foreground">{t("seasonPlan.sequencePass", { time: formatClock(passSec) })}</span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">{t("seasonPlan.sequenceHowItPlays")}</span>
                  </div>
                </td>
              </tr>
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
}
