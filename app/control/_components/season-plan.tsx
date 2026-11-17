"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, ClipboardPaste, FileVideo, FolderOpen, Plus, Repeat, Save, Undo2, X } from "lucide-react";
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
  clubMediaPatchFromPlanRow,
  emptySeconds,
  formatMinutes,
  guessColumnKinds,
  headerSignature,
  looksLikeHeader,
  normalizeName,
  parseClipboardTable,
  parseMinutes,
  planCapacity,
  planEffectiveSeconds,
  planRowChanged,
  planRowKey,
  planRowsFromDatabase,
  sponsorPatchFromPlanRow,
  suggestSponsorForFile,
  type OutsidePhase,
  type PlanColumnKind,
  type PlanFile,
  type PlanPhase,
  type PlanRow,
  type PlanRowKind,
} from "@/lib/season-plan";
import {
  SPONSOR_MEDIA_EXTENSIONS,
  fileNameOf,
  readMediaFileInfo,
  registerSponsorFile,
} from "@/lib/sponsor-media-register";

const MAPPING_KEY = "arenacue:season-plan-columns";
/** Verschil tussen geplande en echte schermtijd dat de cel apart toont (clips worden niet afgekapt). */
const EFFECTIVE_HINT_SEC = 5;

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

let newKeyCounter = 0;
function newRow(kind: PlanRowKind): PlanRow {
  newKeyCounter += 1;
  return {
    key: `new-${Date.now()}-${newKeyCounter}`,
    kind,
    id: null,
    name: "",
    active: true,
    seconds: emptySeconds(),
    notes: "",
    mediaCount: 0,
    file: null,
  };
}

/** Sponsors eerst, clubmedia daarna: zo staan ze in de tabel en zo loopt Enter van rij naar rij. */
function displayOrder(rows: PlanRow[]): PlanRow[] {
  return [...rows.filter((r) => r.kind === "sponsor"), ...rows.filter((r) => r.kind === "club")];
}

/**
 * Seizoensplan: alle sponsors en clubmedia in één tabel met minuten per fase, zoals de club het in Excel bijhoudt.
 * Wijzigingen blijven in de tabel tot de operator opslaat. Elke cel toont ook wat de rotatie er echt van maakt.
 */
export function SeasonPlanSection({ activeMatch }: { activeMatch: Match | null }) {
  const { t, i18n } = useTranslation();
  const decimal = (1.5).toLocaleString(i18n.language).includes(",") ? "," : ".";
  /** Het tabblad blijft gemount; herladen bij elke statuswijziging, zodat wijzigingen elders hier ook binnenkomen. */
  const stateStamp = encodeURIComponent(useDisplayStore((s) => s.state?.updatedAt) ?? "");
  const { data: sponsorsRaw, reload: reloadSponsors } = useApi<Sponsor[]>(`/api/sponsors?_=${stateStamp}`);
  const { data: mediaRaw, reload: reloadMedia } = useApi<MediaItem[]>(`/api/media?_=${stateStamp}`);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [originals, setOriginals] = useState<Map<string, PlanRow>>(new Map());
  const [cellText, setCellText] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);

  function reload() {
    reloadSponsors();
    reloadMedia();
  }

  const dirtyKeys = useMemo(
    () => rows.filter((r) => planRowChanged(r, originals.get(r.key))).map((r) => r.key),
    [rows, originals],
  );
  const dirty = dirtyKeys.length > 0;

  /**
   * Nieuwe gegevens uit de database. Zonder open wijzigingen volgt de tabel de database;
   * met open wijzigingen blijven die staan en wordt alleen het aantal bestanden bijgewerkt.
   */
  const originalsRef = useRef(originals);
  originalsRef.current = originals;
  /** Na opslaan neemt de tabel de database over; deze rijen (clubmedia zonder bestand) blijven erbij staan. */
  const replaceNextRef = useRef<PlanRow[] | null>(null);
  useEffect(() => {
    if (!sponsorsRaw || !mediaRaw) return;
    const fresh = planRowsFromDatabase(sponsorsRaw, mediaRaw);
    const previous = originalsRef.current;
    setOriginals(new Map(fresh.map((r) => [r.key, r])));
    const keep = replaceNextRef.current;
    replaceNextRef.current = null;
    setRows((current) => {
      if (keep) return [...fresh, ...keep];
      const hasChanges = current.some((r) => planRowChanged(r, previous.get(r.key)));
      if (!hasChanges) return fresh;
      const counts = new Map(fresh.map((r) => [r.key, r.mediaCount]));
      return current.map((r) => (counts.has(r.key) ? { ...r, mediaCount: counts.get(r.key)! } : r));
    });
  }, [sponsorsRaw, mediaRaw]);

  const ordered = useMemo(() => displayOrder(rows), [rows]);
  const engineCtx = useMemo(
    () => ({
      sponsorsById: new Map((sponsorsRaw ?? []).map((s) => [s.id, s])),
      mediaById: new Map((mediaRaw ?? []).map((m) => [m.id, m])),
    }),
    [sponsorsRaw, mediaRaw],
  );
  const effective = useMemo(() => planEffectiveSeconds(rows, engineCtx), [rows, engineCtx]);
  const capacity = planCapacity(activeMatch);

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

  function addRow(kind: PlanRowKind) {
    const row = newRow(kind);
    setRows((current) => [...current, row]);
    window.setTimeout(() => {
      const el = tableRef.current?.querySelector<HTMLInputElement>(`[data-row="${row.key}"]`);
      el?.focus();
    }, 0);
  }

  function discard() {
    if (!sponsorsRaw || !mediaRaw) return;
    setRows(planRowsFromDatabase(sponsorsRaw, mediaRaw));
    setCellText({});
  }

  async function pickClubFile(row: PlanRow) {
    const paths = await selectFilesViaDialog({
      title: t("seasonPlan.chooseFileFor", { name: row.name || t("seasonPlan.groupClub") }),
      filters: [{ name: t("media.filterMedia"), extensions: SPONSOR_MEDIA_EXTENSIONS }],
      multiSelections: false,
    });
    if (paths.length === 0) return;
    setBusyRow(row.key);
    try {
      const info = await readMediaFileInfo(paths[0]);
      if (!info) {
        toast({ title: t("media.videoDurationUnread"), description: fileNameOf(paths[0]), variant: "error" });
        return;
      }
      updateRow(row.key, (r) => ({
        ...r,
        file: info,
        mediaCount: 1,
        name: r.name.trim() ? r.name : fileNameOf(info.path).replace(/\.[a-z0-9]+$/i, ""),
      }));
    } finally {
      setBusyRow(null);
    }
  }

  async function save() {
    const changed = rows.filter((r) => dirtyKeys.includes(r.key));
    for (const kind of ["sponsor", "club"] as const) {
      const names = new Set<string>();
      for (const r of rows.filter((x) => x.kind === kind)) {
        const n = normalizeName(r.name);
        if (!n) {
          toast({ title: t("seasonPlan.nameRequired"), variant: "error" });
          return;
        }
        if (names.has(n)) {
          toast({ title: t("seasonPlan.nameDuplicate", { name: r.name.trim() }), variant: "error" });
          return;
        }
        names.add(n);
      }
    }
    const waiting = changed.filter((r) => r.kind === "club" && !r.id && !r.file);
    const toSave = changed.filter((r) => !waiting.includes(r));
    setSaving(true);
    /** Rijen die net aangemaakt zijn: bij een fout verderop houden ze hun id, zodat opnieuw opslaan geen dubbel maakt. */
    const created = new Map<string, { id: string; key: string }>();
    try {
      for (const row of toSave) {
        const res = await saveRow(row);
        if (!res.ok) {
          toast({ title: t("seasonPlan.saveFailed", { name: row.name.trim() }), variant: "error" });
          setRows((current) =>
            current.map((r) => {
              const c = created.get(r.key);
              return c ? { ...r, id: c.id, key: c.key } : r;
            }),
          );
          reload();
          return;
        }
        if (!row.id) {
          const body = (await res.json()) as { id?: string };
          if (body.id) created.set(row.key, { id: body.id, key: planRowKey(row.kind, body.id) });
        }
      }
      replaceNextRef.current = waiting;
      setCellText({});
      reload();
      toast({ title: t("seasonPlan.saved", { count: toSave.length }), variant: "success" });
      if (waiting.length > 0) {
        toast({ title: t("seasonPlan.clubPending", { count: waiting.length }), variant: "warning" });
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveRow(row: PlanRow): Promise<Response> {
    const json = (method: string, url: string, body: unknown) =>
      fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (row.kind === "sponsor") {
      const body = sponsorPatchFromPlanRow(row);
      return row.id ? json("PATCH", `/api/sponsors/${row.id}`, body) : json("POST", "/api/sponsors", body);
    }
    const body: Record<string, unknown> = clubMediaPatchFromPlanRow(row);
    const original = originals.get(row.key);
    if (row.file && (!row.id || row.file.path !== original?.file?.path)) {
      body.path = row.file.path;
      body.type = row.file.type;
      body.durationSec = row.file.durationSec;
    }
    return row.id ? json("PATCH", `/api/media/${row.id}`, body) : json("POST", "/api/media", body);
  }

  async function addFilesToSponsor(row: PlanRow) {
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
    } finally {
      setBusyRow(null);
    }
  }

  const notesCol = 1 + PLAN_PHASES.length + 1;
  const sponsorRows = ordered.filter((r) => r.kind === "sponsor");
  const clubRows = ordered.filter((r) => r.kind === "club");
  const pendingClubRows = rows.filter((r) => r.kind === "club" && !r.file);

  function renderRow(row: PlanRow, rowIndex: number) {
    const original = originals.get(row.key);
    const isNew = !original;
    const eff = effective.byRow.get(row.key) ?? emptySeconds();
    const changedClass = (changed: boolean) => (changed && !isNew ? "border-primary/60 bg-primary/5" : "border-input");
    return (
      <tr key={row.key} className={`border-b border-border/60 ${row.active ? "" : "opacity-60"}`}>
        <td className="py-1 pr-2 align-top">
          <div className="flex items-center gap-1">
            <Input
              data-cell={`${rowIndex}:0`}
              data-row={row.key}
              value={row.name}
              onChange={(e) => updateRow(row.key, (r) => ({ ...r, name: e.target.value }))}
              onKeyDown={(e) => cellKeys(e, rowIndex, 0)}
              className={`h-8 min-w-44 ${changedClass(!original || row.name.trim() !== original.name.trim())}`}
            />
            {isNew ? (
              <>
                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
                  {t("seasonPlan.newBadge")}
                </span>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-accent"
                  title={row.kind === "sponsor" ? t("seasonPlan.makeClub") : t("seasonPlan.makeSponsor")}
                  onClick={() =>
                    updateRow(row.key, (r) => ({
                      ...r,
                      kind: r.kind === "sponsor" ? "club" : "sponsor",
                      file: null,
                      mediaCount: 0,
                    }))
                  }
                >
                  <Repeat className="size-3.5" />
                </button>
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
        <td className="px-1 py-1 text-center align-top">
          <input
            type="checkbox"
            checked={row.active}
            onChange={(e) => updateRow(row.key, (r) => ({ ...r, active: e.target.checked }))}
            className="mt-2 size-4 accent-primary"
            aria-label={t("seasonPlan.colActive")}
          />
        </td>
        {PLAN_PHASES.map((phase, i) => {
          const cellKey = `${row.key}:${phase}`;
          const planned = row.seconds[phase];
          const text = cellText[cellKey] ?? formatMinutes(planned, decimal);
          const invalid = text.trim() !== "" && parseMinutes(text) == null;
          const shown = eff[phase];
          const hasMedia = row.kind === "club" ? row.file != null : row.mediaCount > 0;
          const notShown = row.active && hasMedia && planned > 0 && shown === 0;
          const differs = row.active && hasMedia && shown > 0 && Math.abs(shown - planned) >= EFFECTIVE_HINT_SEC;
          return (
            <td key={phase} className="px-1 py-1 align-top">
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
                  invalid ? "border-destructive" : changedClass(!original || planned !== original.seconds[phase])
                }`}
              />
              {notShown ? (
                <div className="mt-0.5 text-right text-[10px] text-amber-500" title={t("seasonPlan.noClipForPhase")}>
                  {t("seasonPlan.shownNone")}
                </div>
              ) : differs ? (
                <div
                  className="mt-0.5 text-right text-[10px] text-muted-foreground"
                  title={t("seasonPlan.effectiveHint", { time: formatMinutes(shown, decimal) })}
                >
                  ≈ {formatMinutes(shown, decimal)}
                </div>
              ) : null}
            </td>
          );
        })}
        <td className="px-2 py-1 text-center align-top">
          {row.kind === "sponsor" ? (
            <div className="mt-1 flex items-center justify-center gap-1">
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
                  onClick={() => void addFilesToSponsor(row)}
                >
                  <Plus className="size-3.5" />
                </button>
              ) : null}
            </div>
          ) : (
            <ClubFileCell
              file={row.file}
              changed={!!original && row.file?.path !== original.file?.path}
              busy={busyRow === row.key}
              onPick={() => void pickClubFile(row)}
            />
          )}
        </td>
        <td className="py-1 pl-2 align-top">
          <Input
            data-cell={`${rowIndex}:${notesCol}`}
            value={row.notes}
            onChange={(e) => updateRow(row.key, (r) => ({ ...r, notes: e.target.value }))}
            onKeyDown={(e) => cellKeys(e, rowIndex, notesCol)}
            className={`h-8 min-w-56 ${changedClass(!!original && row.notes.trim() !== original.notes.trim())}`}
          />
        </td>
      </tr>
    );
  }

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
            <Button variant="outline" className="gap-2" onClick={() => setFilesOpen(true)} title={t("seasonPlan.filesHelp")}>
              <FolderOpen className="size-4" />
              {t("seasonPlan.linkFilesButton")}
            </Button>
          ) : null}
          <Button variant="outline" className="gap-2" onClick={() => addRow("sponsor")}>
            <Plus className="size-4" />
            {t("seasonPlan.addRow")}
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => addRow("club")}>
            <Plus className="size-4" />
            {t("seasonPlan.addClubRow")}
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
          <table ref={tableRef} className="w-full min-w-[980px] border-collapse text-sm">
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
              {sponsorRows.length > 0 ? <GroupHeader title={t("seasonPlan.groupSponsors")} /> : null}
              {sponsorRows.map((row, i) => renderRow(row, i))}
              {clubRows.length > 0 ? (
                <GroupHeader title={t("seasonPlan.groupClub")} hint={t("seasonPlan.groupClubHint")} />
              ) : null}
              {clubRows.map((row, i) => (
                <Fragment key={row.key}>{renderRow(row, sponsorRows.length + i)}</Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-2 pr-2">{t("seasonPlan.total")}</td>
                <td />
                {PLAN_PHASES.map((p) => {
                  const limit = capacity[p];
                  const used = effective.totals[p];
                  const over = limit != null && used > limit;
                  return (
                    <td
                      key={p}
                      className={`px-1 py-2 text-right tabular-nums ${over ? "text-amber-500" : ""}`}
                      title={
                        over
                          ? t("seasonPlan.overBudget", { over: formatMinutes(used - limit!, decimal) })
                          : limit == null
                            ? t("seasonPlan.noLimit")
                            : undefined
                      }
                    >
                      {limit != null
                        ? t("seasonPlan.available", {
                            used: formatMinutes(used, decimal) || "0",
                            available: formatMinutes(limit, decimal),
                          })
                        : formatMinutes(used, decimal) || "0"}
                      {over ? <AlertTriangle className="ml-1 inline size-3.5" /> : null}
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
          pendingClubRows={pendingClubRows}
          onClubFiles={(assigned) =>
            setRows((current) =>
              current.map((r) => {
                const file = assigned.get(r.key);
                return file ? { ...r, file, mediaCount: 1 } : r;
              }),
            )
          }
          onDone={reload}
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

function GroupHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <tr>
      <td colSpan={9} className="pb-1 pt-4">
        <span className="text-xs font-bold uppercase tracking-wide text-foreground">{title}</span>
        {hint ? <span className="ml-2 text-xs text-muted-foreground">{hint}</span> : null}
      </td>
    </tr>
  );
}

function ClubFileCell({
  file,
  changed,
  busy,
  onPick,
}: {
  file: PlanFile | null;
  changed: boolean;
  busy: boolean;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  if (!file) {
    return isElectron ? (
      <Button size="sm" variant="outline" className="mt-0.5 gap-1 border-amber-500/50" onClick={onPick} disabled={busy}>
        <FileVideo className="size-3.5" />
        {t("seasonPlan.chooseFile")}
      </Button>
    ) : (
      <span title={t("seasonPlan.clubNeedsFile")}>
        <AlertTriangle className="mx-auto mt-2 size-4 text-amber-500" />
      </span>
    );
  }
  return (
    <div className="mt-1 flex max-w-48 items-center justify-center gap-1">
      <span className={`truncate text-xs ${changed ? "text-primary" : "text-muted-foreground"}`} title={file.path}>
        {fileNameOf(file.path)}
      </span>
      {isElectron ? (
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-40"
          title={t("seasonPlan.changeFile")}
          disabled={busy}
          onClick={onPick}
        >
          <Repeat className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
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

  const body = useMemo(() => (hasHeader ? table.slice(1) : table), [hasHeader, table]);
  const built = useMemo(() => buildPlanImport(body, kinds, { outsideSplit }), [body, kinds, outsideSplit]);
  const preview = useMemo(() => applyPlanImport(rows, built.rows), [rows, built.rows]);
  const hasName = kinds.includes("name");
  const usesOutside = kinds.includes("outside90");
  const createdClub = built.rows.filter((r) => r.kind === "club" && preview.summary.created.includes(r.name)).length;
  const createdSponsor = preview.summary.created.length - createdClub;

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
                    <li>{t("seasonPlan.previewCreated", { count: createdSponsor })}</li>
                    <li>{t("seasonPlan.previewCreatedClub", { count: createdClub })}</li>
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
                  <p className="mt-2 text-xs text-muted-foreground">{t("seasonPlan.previewKindHint")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t("seasonPlan.previewNotSaved")}</p>
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

/** Keuze per bestand: een opgeslagen sponsor (`sponsor:<id>`) of een clubmedia-rij die nog een bestand nodig heeft (`club:<key>`). */
type FileChoice = { path: string; target: string; suggested: boolean };

function LinkFilesDialog({
  open,
  onOpenChange,
  sponsors,
  media,
  pendingClubRows,
  onClubFiles,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sponsors: Sponsor[];
  media: MediaItem[];
  pendingClubRows: PlanRow[];
  onClubFiles: (assigned: Map<string, PlanFile>) => void;
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

  const sortedSponsors = useMemo(() => [...sponsors].sort((a, b) => a.name.localeCompare(b.name)), [sponsors]);
  const clubTargets = useMemo(
    () => pendingClubRows.filter((r) => r.name.trim()).sort((a, b) => a.name.localeCompare(b.name)),
    [pendingClubRows],
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
    const candidates = [
      ...sponsors.map((s) => ({ id: `sponsor:${s.id}`, name: s.name })),
      ...clubTargets.map((r) => ({ id: `club:${r.key}`, name: r.name })),
    ];
    const used = new Set<string>();
    setChoices(
      fresh.map((p) => {
        let id = suggestSponsorForFile(fileNameOf(p), candidates);
        /** Een clubmedia-rij heeft één bestand: een tweede voorstel voor dezelfde rij laten we open. */
        if (id?.startsWith("club:")) {
          if (used.has(id)) id = null;
          else used.add(id);
        }
        return { path: p, target: id ?? "", suggested: id != null };
      }),
    );
  }

  const toLink = choices.filter((c) => c.target);
  const clubTargetCounts = new Map<string, number>();
  for (const c of toLink) {
    if (c.target.startsWith("club:")) clubTargetCounts.set(c.target, (clubTargetCounts.get(c.target) ?? 0) + 1);
  }
  const clubConflict = [...clubTargetCounts.values()].some((n) => n > 1);

  async function link() {
    setProgress(0);
    const sponsorItems = toLink
      .filter((c) => c.target.startsWith("sponsor:"))
      .map((c) => ({ path: c.path, sponsorId: c.target.slice("sponsor:".length) }));
    const result = await registerFiles(sponsorItems, sponsors, setProgress);
    const assigned = new Map<string, PlanFile>();
    let done = sponsorItems.length;
    for (const c of toLink.filter((x) => x.target.startsWith("club:"))) {
      const info = await readMediaFileInfo(c.path);
      if (info) assigned.set(c.target.slice("club:".length), info);
      else result.failed.push(fileNameOf(c.path));
      done += 1;
      setProgress(done);
    }
    if (assigned.size > 0) {
      onClubFiles(assigned);
      toast({ title: t("seasonPlan.clubFilesAssigned", { count: assigned.size }) });
    }
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
          {sponsors.length === 0 && clubTargets.length === 0 ? (
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
                          value={c.target}
                          onChange={(e) =>
                            setChoices((cur) =>
                              cur.map((x, j) => (j === i ? { ...x, target: e.target.value, suggested: false } : x)),
                            )
                          }
                          className={`h-8 text-xs ${(clubTargetCounts.get(c.target) ?? 0) > 1 ? "border-destructive" : ""}`}
                          disabled={progress != null}
                        >
                          <option value="">{t("seasonPlan.filesNone")}</option>
                          {sortedSponsors.length > 0 ? (
                            <optgroup label={t("seasonPlan.groupSponsors")}>
                              {sortedSponsors.map((s) => (
                                <option key={s.id} value={`sponsor:${s.id}`}>
                                  {s.name}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                          {clubTargets.length > 0 ? (
                            <optgroup label={t("seasonPlan.filesGroupClub")}>
                              {clubTargets.map((r) => (
                                <option key={r.key} value={`club:${r.key}`}>
                                  {r.name}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
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
          {clubConflict ? <p className="text-sm text-destructive">{t("seasonPlan.filesClubConflict")}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={progress != null}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void link()} disabled={toLink.length === 0 || progress != null || clubConflict}>
            {progress != null
              ? t("seasonPlan.filesLinking", { done: progress, count: toLink.length })
              : t("seasonPlan.filesLink", { count: toLink.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
