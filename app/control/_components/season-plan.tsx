"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, ClipboardPaste, FolderOpen, Plus, Save, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/form";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { useApi } from "@/lib/use-api";
import { useDisplayStore } from "@/lib/store";
import { isElectron, selectFilesViaDialog } from "@/lib/electron";
import type { Match, MediaItem, Sponsor } from "@/lib/types";
import {
  OUTSIDE_PHASES,
  PLAN_COLUMN_KINDS,
  PLAN_PHASES,
  applyPlanImport,
  buildPlanImport,
  emptySeconds,
  formatMinutes,
  guessColumnKinds,
  headerSignature,
  looksLikeHeader,
  normalizeName,
  parseClipboardTable,
  parseMinutes,
  planRowChanged,
  planRowFromSponsor,
  planTotals,
  sponsorPatchFromPlanRow,
  suggestSponsorForFile,
  type OutsidePhase,
  type PlanColumnKind,
  type PlanPhase,
  type PlanRow,
} from "@/lib/season-plan";
import { SPONSOR_MEDIA_EXTENSIONS, fileNameOf, registerSponsorFile } from "@/lib/sponsor-media-register";

const MAPPING_KEY = "arenacue:season-plan-columns";

function phaseLabel(t: TFunction, phase: PlanPhase): string {
  const keys: Record<PlanPhase, string> = {
    prematch: "media.budgetPrematch",
    firstHalf: "media.budgetFirstHalf",
    halftime: "media.budgetHalftime",
    secondHalf: "media.budgetSecondHalf",
    postmatch: "media.budgetPostmatch",
  };
  return t(keys[phase]);
}

function kindLabel(t: TFunction, kind: PlanColumnKind): string {
  if ((PLAN_PHASES as readonly string[]).includes(kind)) return phaseLabel(t, kind as PlanPhase);
  return t(`seasonPlan.kind_${kind}`);
}

/** Per pc onthouden welke kolom wat is, voor een sheet met dezelfde kopregel. */
function readSavedMapping(signature: string): PlanColumnKind[] | null {
  try {
    const all = JSON.parse(window.localStorage.getItem(MAPPING_KEY) ?? "{}") as Record<string, PlanColumnKind[]>;
    const kinds = all[signature];
    return Array.isArray(kinds) && kinds.every((k) => PLAN_COLUMN_KINDS.includes(k)) ? kinds : null;
  } catch {
    return null;
  }
}

function saveMapping(signature: string, kinds: PlanColumnKind[]) {
  try {
    const all = JSON.parse(window.localStorage.getItem(MAPPING_KEY) ?? "{}") as Record<string, PlanColumnKind[]>;
    all[signature] = kinds;
    window.localStorage.setItem(MAPPING_KEY, JSON.stringify(all));
  } catch {
    /* alleen gemak: zonder opslag kiest de operator de kolommen opnieuw */
  }
}

/**
 * Seizoensplan: alle sponsors in één tabel met minuten per fase, zoals de club het in Excel bijhoudt.
 * Wijzigingen blijven in de tabel tot de operator opslaat.
 */
export function SeasonPlanSection({ activeMatch }: { activeMatch: Match | null }) {
  const { t, i18n } = useTranslation();
  const decimal = (1.5).toLocaleString(i18n.language).includes(",") ? "," : ".";
  /** Het tabblad blijft gemount; herladen bij elke statuswijziging, zodat wijzigingen onder Sponsors hier ook binnenkomen. */
  const stateStamp = encodeURIComponent(useDisplayStore((s) => s.state?.updatedAt) ?? "");
  const { data: sponsorsRaw, reload } = useApi<Sponsor[]>(`/api/sponsors?_=${stateStamp}`);
  const { data: mediaRaw, reload: reloadMedia } = useApi<MediaItem[]>(`/api/media?_=${stateStamp}`);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [originals, setOriginals] = useState<Map<string, PlanRow>>(new Map());
  const [cellText, setCellText] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);

  const dirtyKeys = useMemo(
    () => rows.filter((r) => planRowChanged(r, r.id ? originals.get(r.id) : undefined)).map((r) => r.key),
    [rows, originals],
  );
  const dirty = dirtyKeys.length > 0;

  /**
   * Nieuwe gegevens uit de database. Zonder open wijzigingen volgt de tabel de database;
   * met open wijzigingen blijven die staan en wordt alleen het aantal bestanden bijgewerkt.
   */
  const originalsRef = useRef(originals);
  originalsRef.current = originals;
  /** Na opslaan neemt de tabel de database over, ook voor rijen die net aangemaakt zijn. */
  const replaceNextRef = useRef(false);
  useEffect(() => {
    if (!sponsorsRaw) return;
    const fresh = sponsorsRaw.map(planRowFromSponsor);
    const previous = originalsRef.current;
    setOriginals(new Map(fresh.map((r) => [r.key, r])));
    const replace = replaceNextRef.current;
    replaceNextRef.current = false;
    setRows((current) => {
      if (replace) return fresh;
      const hasChanges = current.some((r) => planRowChanged(r, r.id ? previous.get(r.id) : undefined));
      if (!hasChanges) return fresh;
      const counts = new Map(fresh.map((r) => [r.key, r.mediaCount]));
      return current.map((r) => (r.id && counts.has(r.id) ? { ...r, mediaCount: counts.get(r.id)! } : r));
    });
  }, [sponsorsRaw]);

  const totals = planTotals(rows);
  const halfSec = activeMatch?.halfDurationSec || 45 * 60;
  const breakSec = activeMatch?.halfBreakSec || 15 * 60;
  const available: Partial<Record<PlanPhase, number>> = {
    firstHalf: halfSec,
    secondHalf: halfSec,
    halftime: breakSec,
  };

  function updateRow(key: string, patch: (row: PlanRow) => PlanRow) {
    setRows((current) => current.map((r) => (r.key === key ? patch(r) : r)));
  }

  function setCell(row: PlanRow, phase: PlanPhase, text: string) {
    const cellKey = `${row.key}:${phase}`;
    setCellText((c) => ({ ...c, [cellKey]: text }));
    const sec = text.trim() === "" ? 0 : parseMinutes(text);
    if (sec != null) updateRow(row.key, (r) => ({ ...r, seconds: { ...r.seconds, [phase]: sec } }));
  }

  function moveFocus(rowIndex: number, col: number) {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`[data-cell="${rowIndex}:${col}"]`);
    if (el) {
      el.focus();
      el.select();
    }
  }

  function addRow() {
    const key = `new-${Date.now()}`;
    setRows((current) => [
      ...current,
      { key, id: null, name: "", active: true, seconds: emptySeconds(), notes: "", mediaCount: 0 },
    ]);
    window.setTimeout(() => moveFocus(rows.length, 0), 0);
  }

  function discard() {
    if (!sponsorsRaw) return;
    setRows(sponsorsRaw.map(planRowFromSponsor));
    setCellText({});
  }

  async function save() {
    const changed = rows.filter((r) => dirtyKeys.includes(r.key));
    const names = new Map<string, string>();
    for (const r of rows) {
      const n = normalizeName(r.name);
      if (!n) {
        toast({ title: t("seasonPlan.nameRequired"), variant: "error" });
        return;
      }
      if (names.has(n)) {
        toast({ title: t("seasonPlan.nameDuplicate", { name: r.name.trim() }), variant: "error" });
        return;
      }
      names.set(n, r.key);
    }
    setSaving(true);
    /** Sponsors die net aangemaakt zijn: bij een fout verderop houden ze hun id, zodat opnieuw opslaan geen dubbel maakt. */
    const createdIds = new Map<string, string>();
    try {
      for (const row of changed) {
        const body = sponsorPatchFromPlanRow(row);
        const res = row.id
          ? await fetch(`/api/sponsors/${row.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })
          : await fetch("/api/sponsors", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
        if (!res.ok) {
          toast({ title: t("seasonPlan.saveFailed", { name: row.name.trim() }), variant: "error" });
          setRows((current) =>
            current.map((r) => (createdIds.has(r.key) ? { ...r, id: createdIds.get(r.key)! } : r)),
          );
          reload();
          return;
        }
        if (!row.id) {
          const created = (await res.json()) as { id?: string };
          if (created.id) createdIds.set(row.key, created.id);
        }
      }
      replaceNextRef.current = true;
      setCellText({});
      reload();
      toast({ title: t("seasonPlan.saved", { count: changed.length }), variant: "success" });
    } finally {
      setSaving(false);
    }
  }

  async function addFilesToRow(row: PlanRow) {
    if (!row.id) return;
    const paths = await selectFilesViaDialog({
      title: t("media.filesForSponsor", { name: row.name }),
      filters: [{ name: t("media.filterMedia"), extensions: SPONSOR_MEDIA_EXTENSIONS }],
      multiSelections: true,
    });
    if (paths.length === 0) return;
    setBusyRow(row.key);
    try {
      const result = await registerFiles(
        paths.map((p) => ({ path: p, sponsorId: row.id! })),
        sponsorsRaw ?? [],
      );
      reportLinkResult(t, result);
      reload();
      reloadMedia();
    } finally {
      setBusyRow(null);
    }
  }

  const columns = 2 + PLAN_PHASES.length;

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{t("seasonPlan.title")}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("seasonPlan.intro")}</p>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{t("seasonPlan.footballOnly")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setPasteOpen(true)}>
            <ClipboardPaste className="size-4" />
            {t("seasonPlan.pasteButton")}
          </Button>
          {isElectron ? (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setFilesOpen(true)}
              disabled={dirty}
              title={dirty ? t("seasonPlan.filesUnsavedFirst") : t("seasonPlan.filesHelp")}
            >
              <FolderOpen className="size-4" />
              {t("seasonPlan.linkFilesButton")}
            </Button>
          ) : null}
          <Button variant="outline" className="gap-2" onClick={addRow}>
            <Plus className="size-4" />
            {t("seasonPlan.addRow")}
          </Button>
        </div>
      </div>

      {dirty ? (
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm">
          <span>{t("seasonPlan.unsaved", { count: dirtyKeys.length })}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1" onClick={discard} disabled={saving}>
              <Undo2 className="size-3.5" />
              {t("seasonPlan.discard")}
            </Button>
            <Button size="sm" className="gap-1" onClick={() => void save()} disabled={saving}>
              <Save className="size-3.5" />
              {saving ? t("common.loading") : t("seasonPlan.save", { count: dirtyKeys.length })}
            </Button>
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("seasonPlan.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table ref={tableRef} className="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-2 font-semibold">{t("seasonPlan.colSponsor")}</th>
                <th className="px-1 py-2 text-center font-semibold">{t("seasonPlan.colActive")}</th>
                {PLAN_PHASES.map((p) => (
                  <th key={p} className="w-24 px-1 py-2 text-right font-semibold">
                    {phaseLabel(t, p)}
                  </th>
                ))}
                <th className="px-2 py-2 text-center font-semibold">{t("seasonPlan.colFiles")}</th>
                <th className="py-2 pl-2 font-semibold">{t("seasonPlan.colNotes")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const original = row.id ? originals.get(row.id) : undefined;
                const nameChanged = !original || row.name.trim() !== original.name.trim();
                return (
                  <tr key={row.key} className={`border-b border-border/60 ${row.active ? "" : "opacity-60"}`}>
                    <td className="py-1 pr-2">
                      <div className="flex items-center gap-1">
                        <Input
                          data-cell={`${rowIndex}:0`}
                          value={row.name}
                          onChange={(e) => updateRow(row.key, (r) => ({ ...r, name: e.target.value }))}
                          onKeyDown={(e) => cellKeys(e, rowIndex, 0)}
                          className={`h-8 min-w-44 ${nameChanged ? "border-primary/60 bg-primary/5" : ""}`}
                        />
                        {!row.id ? (
                          <>
                            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
                              {t("seasonPlan.newBadge")}
                            </span>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-accent"
                              title={t("seasonPlan.removeNewRow")}
                              onClick={() => setRows((c) => c.filter((r) => r.key !== row.key))}
                            >
                              <X className="size-3.5" />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="checkbox"
                        checked={row.active}
                        onChange={(e) => updateRow(row.key, (r) => ({ ...r, active: e.target.checked }))}
                        className="size-4 accent-primary"
                        aria-label={t("seasonPlan.colActive")}
                      />
                    </td>
                    {PLAN_PHASES.map((phase, i) => {
                      const cellKey = `${row.key}:${phase}`;
                      const changed = !original || row.seconds[phase] !== original.seconds[phase];
                      const text = cellText[cellKey] ?? formatMinutes(row.seconds[phase], decimal);
                      const invalid = text.trim() !== "" && parseMinutes(text) == null;
                      return (
                        <td key={phase} className="px-1 py-1">
                          <input
                            data-cell={`${rowIndex}:${i + 1}`}
                            inputMode="decimal"
                            value={text}
                            placeholder="0"
                            onChange={(e) => setCell(row, phase, e.target.value)}
                            onBlur={() =>
                              setCellText((c) => {
                                const next = { ...c };
                                delete next[cellKey];
                                return next;
                              })
                            }
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => cellKeys(e, rowIndex, i + 1)}
                            className={`h-8 w-full rounded-md border bg-background px-2 text-right tabular-nums outline-none focus:ring-2 focus:ring-ring ${
                              invalid
                                ? "border-destructive"
                                : changed && row.id
                                  ? "border-primary/60 bg-primary/5"
                                  : "border-input"
                            }`}
                          />
                        </td>
                      );
                    })}
                    <td className="px-2 py-1 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {row.mediaCount === 0 && row.active ? (
                          <span title={t("seasonPlan.noFiles")}>
                            <AlertTriangle className="size-4 text-amber-500" />
                          </span>
                        ) : null}
                        <span className="tabular-nums">{row.mediaCount}</span>
                        {isElectron ? (
                          <button
                            type="button"
                            className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-40"
                            disabled={!row.id || busyRow != null}
                            title={row.id ? t("seasonPlan.addFilesForRow") : t("seasonPlan.saveFirst")}
                            onClick={() => void addFilesToRow(row)}
                          >
                            <Plus className="size-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-1 pl-2">
                      <Input
                        data-cell={`${rowIndex}:${columns}`}
                        value={row.notes}
                        onChange={(e) => updateRow(row.key, (r) => ({ ...r, notes: e.target.value }))}
                        onKeyDown={(e) => cellKeys(e, rowIndex, columns)}
                        className={`h-8 min-w-56 ${original && row.notes.trim() !== original.notes.trim() ? "border-primary/60 bg-primary/5" : ""}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-2 pr-2">{t("seasonPlan.total")}</td>
                <td />
                {PLAN_PHASES.map((p) => {
                  const limit = available[p];
                  const over = limit != null && totals[p] > limit;
                  return (
                    <td
                      key={p}
                      className={`px-1 py-2 text-right tabular-nums ${over ? "text-amber-500" : ""}`}
                      title={over ? t("seasonPlan.overBudget") : undefined}
                    >
                      {limit != null
                        ? t("seasonPlan.available", {
                            used: formatMinutes(totals[p], decimal) || "0",
                            available: formatMinutes(limit, decimal),
                          })
                        : formatMinutes(totals[p], decimal) || "0"}
                    </td>
                  );
                })}
                <td colSpan={2} className="py-2 pl-2 text-xs font-normal text-muted-foreground">
                  {t("seasonPlan.totalHint")}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <PasteDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        rows={rows}
        onApply={(next, count) => {
          setRows(next);
          setCellText({});
          toast({ title: t("seasonPlan.pasted", { count }) });
        }}
      />
      {isElectron ? (
        <LinkFilesDialog
          open={filesOpen}
          onOpenChange={setFilesOpen}
          sponsors={sponsorsRaw ?? []}
          media={mediaRaw ?? []}
          onDone={() => {
            reload();
            reloadMedia();
          }}
        />
      ) : null}
    </section>
  );

  function cellKeys(e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, col: number) {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(rowIndex + 1, col);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(rowIndex - 1, col);
    }
  }
}

type LinkResult = { linked: number; failed: string[]; risky: number };

async function registerFiles(
  items: { path: string; sponsorId: string }[],
  sponsors: Sponsor[],
  onProgress?: (done: number) => void,
): Promise<LinkResult> {
  const result: LinkResult = { linked: 0, failed: [], risky: 0 };
  let done = 0;
  for (const item of items) {
    const sponsor = sponsors.find((s) => s.id === item.sponsorId);
    if (!sponsor) {
      result.failed.push(fileNameOf(item.path));
      continue;
    }
    const r = await registerSponsorFile(item.path, sponsor);
    if (r.ok) {
      result.linked += 1;
      if (r.playbackRisk) result.risky += 1;
    } else {
      result.failed.push(fileNameOf(item.path));
    }
    done += 1;
    onProgress?.(done);
  }
  return result;
}

function reportLinkResult(t: TFunction, result: LinkResult) {
  if (result.linked > 0) {
    toast({ title: t("seasonPlan.filesLinked", { count: result.linked }), variant: "success" });
  }
  if (result.failed.length > 0) {
    toast({
      title: t("seasonPlan.filesFailed", { names: result.failed.join(", ") }),
      variant: "error",
    });
  }
  if (result.risky > 0) {
    toast({ title: t("seasonPlan.filesPlaybackRisk", { count: result.risky }), variant: "warning" });
  }
}

function PasteDialog({
  open,
  onOpenChange,
  rows,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: PlanRow[];
  onApply: (rows: PlanRow[], count: number) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [hasHeader, setHasHeader] = useState(false);
  const [kinds, setKinds] = useState<PlanColumnKind[]>([]);
  const [outsideSplit, setOutsideSplit] = useState<OutsidePhase[]>(["prematch", "halftime"]);

  const table = useMemo(() => parseClipboardTable(text), [text]);
  const width = table[0]?.length ?? 0;

  /** Nieuwe plak: kopregel herkennen en de kolommen raden (of de keuze van vorige keer gebruiken). */
  useEffect(() => {
    if (table.length === 0) {
      setKinds([]);
      return;
    }
    const header = looksLikeHeader(table);
    setHasHeader(header);
    const saved = header ? readSavedMapping(headerSignature(table[0])) : null;
    setKinds(saved && saved.length === width ? saved : guessColumnKinds(header ? table[0] : null, width));
  }, [table, width]);

  useEffect(() => {
    if (!open) setText("");
  }, [open]);

  const body = hasHeader ? table.slice(1) : table;
  const built = useMemo(() => buildPlanImport(body, kinds, { outsideSplit }), [body, kinds, outsideSplit]);
  const preview = useMemo(() => applyPlanImport(rows, built.rows), [rows, built.rows]);
  const hasName = kinds.includes("name");
  const usesOutside = kinds.includes("outside90");

  function apply() {
    if (hasHeader && table[0]) saveMapping(headerSignature(table[0]), kinds);
    onApply(preview.rows, preview.summary.created.length + preview.summary.updated.length);
    onOpenChange(false);
  }

  const sampleRows = body.slice(0, 3);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{t("seasonPlan.pasteTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("seasonPlan.pasteHelp")}</p>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("seasonPlan.pastePlaceholder")}
            className="h-28 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
          />
          {width > 0 ? (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hasHeader}
                  onChange={(e) => setHasHeader(e.target.checked)}
                  className="size-4 accent-primary"
                />
                {t("seasonPlan.headerRow")}
              </label>
              <div>
                <div className="mb-2 text-sm font-semibold">{t("seasonPlan.columnsTitle")}</div>
                <div className="overflow-x-auto">
                  <table className="border-collapse text-xs">
                    <tbody>
                      <tr>
                        {kinds.map((kind, col) => (
                          <td key={col} className="min-w-40 p-1 align-top">
                            <Select
                              value={kind}
                              onChange={(e) =>
                                setKinds((k) => k.map((v, i) => (i === col ? (e.target.value as PlanColumnKind) : v)))
                              }
                              className="h-8 text-xs"
                            >
                              {PLAN_COLUMN_KINDS.map((k) => (
                                <option key={k} value={k}>
                                  {kindLabel(t, k)}
                                </option>
                              ))}
                            </Select>
                            {hasHeader ? (
                              <div className="mt-1 truncate font-semibold text-muted-foreground" title={table[0][col]}>
                                {table[0][col]}
                              </div>
                            ) : null}
                          </td>
                        ))}
                      </tr>
                      {sampleRows.map((r, ri) => (
                        <tr key={ri} className="text-muted-foreground">
                          {r.map((c, ci) => (
                            <td key={ci} className="max-w-40 truncate px-1 py-0.5" title={c}>
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {usesOutside ? (
                <div className="rounded-lg border border-border p-3 text-sm">
                  <div className="font-semibold">{t("seasonPlan.outsideSplitTitle")}</div>
                  <div className="mt-2 flex flex-wrap gap-4">
                    {OUTSIDE_PHASES.map((p) => (
                      <label key={p} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={outsideSplit.includes(p)}
                          onChange={(e) =>
                            setOutsideSplit((cur) =>
                              e.target.checked
                                ? OUTSIDE_PHASES.filter((x) => x === p || cur.includes(x))
                                : cur.filter((x) => x !== p),
                            )
                          }
                          className="size-4 accent-primary"
                        />
                        {phaseLabel(t, p)}
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{t("seasonPlan.outsideSplitHint")}</p>
                </div>
              ) : null}
              {!hasName ? (
                <p className="text-sm text-destructive">{t("seasonPlan.needName")}</p>
              ) : (
                <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm">
                  <ul className="space-y-1">
                    <li>{t("seasonPlan.previewCreated", { count: preview.summary.created.length })}</li>
                    <li>{t("seasonPlan.previewUpdated", { count: preview.summary.updated.length })}</li>
                    <li>{t("seasonPlan.previewUnchanged", { count: preview.summary.unchanged })}</li>
                    {built.skipped.length > 0 ? (
                      <li title={built.skipped.map((s) => s.name).join(", ")}>
                        {t("seasonPlan.previewSkipped", { count: built.skipped.length })}
                      </li>
                    ) : null}
                    {preview.summary.duplicates.length > 0 ? (
                      <li className="text-amber-600">
                        {t("seasonPlan.previewDuplicates", { names: preview.summary.duplicates.join(", ") })}
                      </li>
                    ) : null}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">{t("seasonPlan.previewNotSaved")}</p>
                </div>
              )}
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={apply}
            disabled={!hasName || preview.summary.created.length + preview.summary.updated.length === 0}
          >
            {t("seasonPlan.applyPaste")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type FileChoice = { path: string; sponsorId: string; suggested: boolean };

function LinkFilesDialog({
  open,
  onOpenChange,
  sponsors,
  media,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sponsors: Sponsor[];
  media: MediaItem[];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [choices, setChoices] = useState<FileChoice[]>([]);
  const [alreadyLinked, setAlreadyLinked] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!open) {
      setChoices([]);
      setAlreadyLinked(0);
      setProgress(null);
    }
  }, [open]);

  const sortedSponsors = useMemo(
    () => [...sponsors].sort((a, b) => a.name.localeCompare(b.name)),
    [sponsors],
  );

  async function pick() {
    const paths = await selectFilesViaDialog({
      title: t("seasonPlan.filesTitle"),
      filters: [{ name: t("media.filterMedia"), extensions: SPONSOR_MEDIA_EXTENSIONS }],
      multiSelections: true,
    });
    if (paths.length === 0) return;
    const known = new Set(media.map((m) => m.path.toLowerCase()));
    const fresh = paths.filter((p) => !known.has(p.toLowerCase()));
    setAlreadyLinked(paths.length - fresh.length);
    setChoices(
      fresh.map((p) => {
        const id = suggestSponsorForFile(fileNameOf(p), sponsors);
        return { path: p, sponsorId: id ?? "", suggested: id != null };
      }),
    );
  }

  const toLink = choices.filter((c) => c.sponsorId);

  async function link() {
    setProgress(0);
    const result = await registerFiles(
      toLink.map((c) => ({ path: c.path, sponsorId: c.sponsorId })),
      sponsors,
      setProgress,
    );
    reportLinkResult(t, result);
    onDone();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (progress == null ? onOpenChange(next) : undefined)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t("seasonPlan.filesTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("seasonPlan.filesHelp")}</p>
          {sponsors.length === 0 ? (
            <p className="text-sm text-destructive">{t("seasonPlan.filesNoSponsors")}</p>
          ) : (
            <Button variant="outline" className="gap-2" onClick={() => void pick()} disabled={progress != null}>
              <FolderOpen className="size-4" />
              {t("seasonPlan.filesPick")}
            </Button>
          )}
          {alreadyLinked > 0 ? (
            <p className="text-xs text-muted-foreground">{t("seasonPlan.filesAlreadyLinked", { count: alreadyLinked })}</p>
          ) : null}
          {choices.length > 0 ? (
            <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <tbody>
                  {choices.map((c, i) => (
                    <tr key={c.path} className="border-b border-border/60 last:border-0">
                      <td className="max-w-72 truncate px-3 py-1.5" title={c.path}>
                        {fileNameOf(c.path)}
                      </td>
                      <td className="w-64 px-2 py-1">
                        <Select
                          value={c.sponsorId}
                          onChange={(e) =>
                            setChoices((cur) =>
                              cur.map((x, j) => (j === i ? { ...x, sponsorId: e.target.value, suggested: false } : x)),
                            )
                          }
                          className="h-8 text-xs"
                          disabled={progress != null}
                        >
                          <option value="">{t("seasonPlan.filesNone")}</option>
                          {sortedSponsors.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="w-24 px-2 text-xs text-muted-foreground">
                        {c.suggested ? t("seasonPlan.filesSuggested") : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={progress != null}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void link()} disabled={toLink.length === 0 || progress != null}>
            {progress != null
              ? t("seasonPlan.filesLinking", { done: progress, count: toLink.length })
              : t("seasonPlan.filesLink", { count: toLink.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
