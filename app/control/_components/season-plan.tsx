"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Clock,
  FolderOpen,
  Plus,
  Repeat,
  Save,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/form";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { useApi } from "@/lib/use-api";
import { useDisplayStore } from "@/lib/store";
import { isElectron, selectFilesViaDialog } from "@/lib/electron";
import type { Match, MediaItem, ScheduledMediaCue, Sponsor } from "@/lib/types";
import { defaultSponsorGuarantee, type CueGuarantee } from "@/lib/sponsor-guarantee";
import {
  CUE_PLAN_PHASES,
  OUTSIDE_PHASES,
  PLAN_COLUMN_KINDS,
  PLAN_PHASES,
  applyPlanImport,
  buildPlanImport,
  changedClipTags,
  clubMediaWrites,
  cueStatusForPlanPhase,
  emptySeconds,
  formatClock,
  formatMinutes,
  guessColumnKinds,
  headerSignature,
  looksLikeHeader,
  mergeFreshClips,
  normalizeName,
  parseClipboardTable,
  parseClockText,
  parseMinutes,
  pendingClip,
  pendingClipConflicts,
  planCapacity,
  planCuesFromApi,
  planEffectiveSeconds,
  planRowChanged,
  planRowsFromDatabase,
  sponsorPatchFromPlanRow,
  suggestSponsorForFile,
  type CuePlanPhase,
  type OutsidePhase,
  type PlanClip,
  type PlanColumnKind,
  type PlanCue,
  type PlanFile,
  type PlanPhase,
  type PlanRow,
  type PlanRowKind,
} from "@/lib/season-plan";
import { SequenceRows, newMediaSequence, sequencePositions, useMediaSequences } from "./season-plan-sequences";
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
    guarantee: defaultSponsorGuarantee(),
    mediaCount: 0,
    clips: [],
  };
}

/** Een fase aan- of uitzetten voor één bestand. Alle vijf aan = overal (null); nooit nul fases. */
function togglePhase(phases: PlanPhase[] | null, phase: PlanPhase): PlanPhase[] | null | "empty" {
  const current = phases ?? [...PLAN_PHASES];
  const next = current.includes(phase) ? current.filter((p) => p !== phase) : [...current, phase];
  if (next.length === 0) return "empty";
  if (next.length === PLAN_PHASES.length) return null;
  return PLAN_PHASES.filter((p) => next.includes(p));
}

function clipDurationLabel(t: TFunction, clip: PlanClip): string {
  if (clip.type === "IMAGE") return t("seasonPlan.clipImage", { sec: clip.durationSec });
  return formatClock(clip.durationSec);
}

/** Sponsors eerst, clubmedia daarna: zo staan ze in de tabel en zo loopt Enter van rij naar rij. */
function displayOrder(rows: PlanRow[]): PlanRow[] {
  return [...rows.filter((r) => r.kind === "sponsor"), ...rows.filter((r) => r.kind === "club")];
}

/** Kies bestanden en lees hun type en duur, voor bestanden die pas bij opslaan media-items worden. */
async function pickPlanFiles(t: TFunction, title: string): Promise<PlanFile[]> {
  const paths = await selectFilesViaDialog({
    title,
    filters: [{ name: t("media.filterMedia"), extensions: SPONSOR_MEDIA_EXTENSIONS }],
    multiSelections: true,
  });
  const out: PlanFile[] = [];
  for (const p of paths) {
    const info = await readMediaFileInfo(p);
    if (info) out.push(info);
    else toast({ title: t("media.videoDurationUnread"), description: fileNameOf(p), variant: "error" });
  }
  return out;
}

/**
 * Seizoensplan: alle sponsors en clubmedia in één tabel met minuten per fase, zoals de club het in Excel bijhoudt.
 * Wijzigingen blijven in de tabel tot de operator opslaat. Elke cel toont ook wat de rotatie er echt van maakt.
 * Tijdstippen (tijdscues) worden meteen ingepland; die hebben al een eigen lijst onder Automatisatie.
 */
export function SeasonPlanSection({ activeMatch }: { activeMatch: Match | null }) {
  const { t, i18n } = useTranslation();
  const decimal = (1.5).toLocaleString(i18n.language).includes(",") ? "," : ".";
  /** Het tabblad blijft gemount; herladen bij elke statuswijziging, zodat wijzigingen elders hier ook binnenkomen. */
  const stateStamp = encodeURIComponent(useDisplayStore((s) => s.state?.updatedAt) ?? "");
  const { data: sponsorsRaw, reload: reloadSponsors } = useApi<Sponsor[]>(`/api/sponsors?_=${stateStamp}`);
  const { data: mediaRaw, reload: reloadMedia } = useApi<MediaItem[]>(`/api/media?_=${stateStamp}`);
  const { data: cuesRaw, reload: reloadCues } = useApi<ScheduledMediaCue[]>(`/api/scheduled-media-cues?_=${stateStamp}`);
  const { sequences, mutate: mutateSequences } = useMediaSequences(stateStamp);
  const inSequence = useMemo(() => sequencePositions(sequences), [sequences]);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [originals, setOriginals] = useState<Map<string, PlanRow>>(new Map());
  const [cellText, setCellText] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  /** Rijen waarvan de bestanden met hun fases en tijdstippen opengeklapt zijn. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Bestand waarvoor het formulier "op tijdstip" open staat. */
  const [cueFormFor, setCueFormFor] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  /** Altijd de laatste rijen, voor handlers die na een dialoog verder lopen. */
  const rowsRef = useRef<PlanRow[]>([]);
  rowsRef.current = rows;

  function reload() {
    reloadSponsors();
    reloadMedia();
    reloadCues();
  }

  const dirtyKeys = useMemo(
    () => rows.filter((r) => planRowChanged(r, originals.get(r.key))).map((r) => r.key),
    [rows, originals],
  );
  const dirty = dirtyKeys.length > 0;

  /**
   * Nieuwe gegevens uit de database. Zonder open wijzigingen volgt de tabel de database;
   * met open wijzigingen blijven die staan en worden alleen de bestanden bijgewerkt.
   */
  const originalsRef = useRef(originals);
  originalsRef.current = originals;
  /** Na opslaan neemt de tabel de database over; deze rijen (nog niet opgeslagen) blijven erbij staan. */
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
      const freshByKey = new Map(fresh.map((r) => [r.key, r]));
      return current.map((r) => {
        const f = freshByKey.get(r.key);
        return f ? { ...r, mediaCount: f.mediaCount, clips: mergeFreshClips(r.clips, f.clips) } : r;
      });
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
  const planCues = useMemo(() => planCuesFromApi(cuesRaw ?? []), [cuesRaw]);
  const cuesByMedia = useMemo(() => {
    const map = new Map<string, PlanCue[]>();
    for (const c of planCues) map.set(c.mediaId, [...(map.get(c.mediaId) ?? []), c]);
    return map;
  }, [planCues]);
  const overlapping = useMemo(() => {
    const titles = new Map(cuesRaw?.map(c => [c.id, c.media?.title ?? c.mediaId]));
    return planCues.filter(c => c.enabled && planCues.some(other => other.enabled && c.id !== other.id &&
      c.phase === other.phase && c.startSec < other.startSec + other.seconds && other.startSec < c.startSec + c.seconds))
      .map(c => titles.get(c.id) + " (" + formatClock(c.startSec) + ")");
  }, [cuesRaw, planCues]);
  const effective = useMemo(
    () => planEffectiveSeconds(rows, engineCtx, planCues, sequences),
    [rows, engineCtx, planCues, sequences],
  );
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

  function toggleExpanded(key: string, open?: boolean) {
    setExpanded((cur) => {
      const next = new Set(cur);
      const shouldOpen = open ?? !next.has(key);
      if (shouldOpen) next.add(key);
      else next.delete(key);
      return next;
    });
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

  /**
   * Sponsor: bestanden meteen registreren (de sponsor bestaat al). Clubmedia: bestanden komen bij opslaan.
   * De rij wordt op het moment van de klik opgezocht via haar sleutel, niet uit een oudere render, en de
   * melding noemt de rij: zo is altijd zichtbaar waar de bestanden terechtkwamen.
   */
  async function addFilesToRow(rowKey: string) {
    const row = rowsRef.current.find((r) => r.key === rowKey);
    if (!row) return;
    if (busyRow != null) return;
    if (row.kind === "club") {
      const picked = await pickPlanFiles(t, t("seasonPlan.chooseFileFor", { name: row.name || t("seasonPlan.groupClub") }));
      const known = new Set(row.clips.map((c) => c.path.toLowerCase()));
      const files = picked.filter((file) => !known.has(file.path.toLowerCase()));
      if (files.length < picked.length) {
        toast({ title: t("seasonPlan.clipAlreadyInRow", { count: picked.length - files.length }), variant: "warning" });
      }
      if (files.length === 0) return;
      updateRow(row.key, (r) => {
        const clips = [...r.clips, ...files.map(pendingClip)];
        return {
          ...r,
          clips,
          mediaCount: clips.length,
          name: r.name.trim() ? r.name : fileNameOf(files[0].path).replace(/\.[a-z0-9]+$/i, ""),
        };
      });
      toggleExpanded(row.key, true);
      toast({ title: t("seasonPlan.filesAddedTo", { count: files.length, name: row.name || t("seasonPlan.groupClub") }) });
      return;
    }
    if (!row.id) return;
    const sponsorId = row.id;
    const paths = await selectFilesViaDialog({
      title: t("media.filesForSponsor", { name: row.name }),
      filters: [{ name: t("media.filterMedia"), extensions: SPONSOR_MEDIA_EXTENSIONS }],
      multiSelections: true,
    });
    if (paths.length === 0) return;
    const known = new Set(row.clips.map((c) => c.path.toLowerCase()));
    const fresh = paths.filter((p) => !known.has(p.toLowerCase()));
    if (fresh.length < paths.length) {
      toast({ title: t("seasonPlan.clipAlreadyInRow", { count: paths.length - fresh.length }), variant: "warning" });
    }
    if (fresh.length === 0) return;
    setBusyRow(row.key);
    try {
      const result = await registerFiles(
        fresh.map((p) => ({ path: p, sponsorId })),
        sponsorsRaw ?? [],
      );
      if (result.linked > 0) {
        toast({ title: t("seasonPlan.filesAddedTo", { count: result.linked, name: row.name }), variant: "success" });
      }
      reportLinkResult(t, { ...result, linked: 0 });
      reload();
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
    const conflicts = pendingClipConflicts(rows);
    if (conflicts.length > 0) {
      toast({
        title: t("seasonPlan.clipConflict", { names: conflicts.map((c) => `${c.file} (${c.rows.join(", ")})`).join("; ") }),
        variant: "error",
      });
      return;
    }
    /** Nieuwe clubmedia zonder bestand kunnen nog niet bestaan: die blijven in de tabel staan. */
    const waiting = changed.filter((r) => r.kind === "club" && !r.id && r.clips.length === 0);
    const toSave = changed.filter((r) => !waiting.includes(r));
    setSaving(true);
    try {
      for (let i = 0; i < toSave.length; i++) {
        const row = toSave[i];
        const ok = await saveRow(row);
        if (!ok) {
          toast({ title: t("seasonPlan.saveFailed", { name: row.name.trim() }), variant: "error" });
          /** Wat nog niet geprobeerd is, blijft staan; de rest volgt de database (zo ontstaat er geen dubbel). */
          replaceNextRef.current = [...waiting, ...toSave.slice(i + 1).filter((r) => !r.id)];
          reload();
          return;
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

  async function saveRow(row: PlanRow): Promise<boolean> {
    const json = (method: string, url: string, body: unknown) =>
      fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const original = originals.get(row.key);
    if (row.kind === "sponsor") {
      const body = sponsorPatchFromPlanRow(row);
      const res = row.id ? await json("PATCH", `/api/sponsors/${row.id}`, body) : await json("POST", "/api/sponsors", body);
      if (!res.ok) return false;
      if (row.id) {
        for (const clip of changedClipTags(row, original)) {
          const r = await json("PATCH", `/api/media/${clip.id}`, { sponsorPhaseTagsJson: clip.sponsorPhaseTagsJson });
          if (!r.ok) return false;
        }
      }
      return true;
    }
    const writes = clubMediaWrites(row, original);
    for (const u of writes.update) {
      if (!(await json("PATCH", `/api/media/${u.id}`, u.body)).ok) return false;
    }
    for (const body of writes.create) {
      if (!(await json("POST", "/api/media", body)).ok) return false;
    }
    for (const r of writes.release) {
      if (!(await json("PATCH", `/api/media/${r.id}`, r.body)).ok) return false;
    }
    return true;
  }

  function setClipPhase(row: PlanRow, clipId: string, phase: PlanPhase) {
    const clip = row.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const next = togglePhase(clip.phases, phase);
    if (next === "empty") {
      toast({ title: t("seasonPlan.clipNeedsPhase"), variant: "warning" });
      return;
    }
    updateRow(row.key, (r) => ({ ...r, clips: r.clips.map((c) => (c.id === clipId ? { ...c, phases: next } : c)) }));
  }

  function removeClubClip(row: PlanRow, clipId: string) {
    updateRow(row.key, (r) => {
      const clips = r.clips.filter((c) => c.id !== clipId);
      return { ...r, clips, mediaCount: clips.length };
    });
  }

  async function deleteClip(clip: PlanClip) {
    if (!window.confirm(t("seasonPlan.clipDeleteConfirm", { name: clip.title }))) return;
    const res = await fetch(`/api/media/${clip.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast({ title: t("seasonPlan.clipDeleteFailed", { name: clip.title }), variant: "error" });
      return;
    }
    toast({ title: t("seasonPlan.clipDeleted", { name: clip.title }), variant: "success" });
    reload();
  }

  async function patchCueGuarantee(cue: PlanCue, guarantee: CueGuarantee) {
    const res = await fetch(`/api/scheduled-media-cues/${cue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guarantee }),
    });
    if (!res.ok) toast({ title: t("media.cuePatchFailed"), variant: "error" });
    reloadCues();
  }

  async function deleteCue(cue: PlanCue) {
    if (!window.confirm(t("media.cueDeleteConfirm"))) return;
    const res = await fetch(`/api/scheduled-media-cues/${cue.id}`, { method: "DELETE" });
    if (!res.ok) toast({ title: t("media.cuePatchFailed"), variant: "error" });
    reloadCues();
  }

  const notesCol = 1 + PLAN_PHASES.length + 1;
  const sponsorRows = ordered.filter((r) => r.kind === "sponsor");
  const clubRows = ordered.filter((r) => r.kind === "club");

  function renderClips(row: PlanRow) {
    const original = originals.get(row.key);
    const before = new Map((original?.clips ?? []).map((c) => [c.id, c]));
    return (
      <tr className="border-b border-border/60 bg-muted/20">
        <td colSpan={9} className="px-3 py-2">
          {row.kind === "sponsor" ? (
            <div
              className={`mb-3 flex flex-wrap items-center gap-2 rounded-lg border p-2 text-xs ${
                original && JSON.stringify(original.guarantee) !== JSON.stringify(row.guarantee)
                  ? "border-amber-500/50"
                  : "border-border"
              }`}
            >
              <span className="font-medium">{t("seasonPlan.guaranteeLabel")}</span>
              <Select
                value={row.guarantee.kind}
                onChange={(e) =>
                  updateRow(row.key, (r) => ({
                    ...r,
                    guarantee: { ...r.guarantee, kind: e.target.value === "plays" ? "plays" : "seconds" },
                  }))
                }
                className="h-7 w-52 text-xs"
              >
                <option value="seconds">{t("seasonPlan.guaranteeSeconds")}</option>
                <option value="plays">{t("seasonPlan.guaranteePlays")}</option>
              </Select>
              <span className="text-muted-foreground">{t("seasonPlan.guaranteeCatchUp")}</span>
              {PLAN_PHASES.filter((p) => p !== "prematch").map((phase) => {
                const on = row.guarantee.catchUpIn.includes(phase);
                return (
                  <button
                    key={phase}
                    type="button"
                    aria-pressed={on}
                    className={`rounded-full border px-2 py-0.5 ${
                      on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"
                    }`}
                    onClick={() =>
                      updateRow(row.key, (r) => ({
                        ...r,
                        guarantee: {
                          ...r.guarantee,
                          catchUpIn: on
                            ? r.guarantee.catchUpIn.filter((p) => p !== phase)
                            : PLAN_PHASES.filter((p) => p === phase || r.guarantee.catchUpIn.includes(p)),
                        },
                      }))
                    }
                  >
                    {t(`seasonPlan.phaseShort_${phase}`)}
                  </button>
                );
              })}
              <span className="basis-full text-[11px] text-muted-foreground">{t("seasonPlan.guaranteeHint")}</span>
            </div>
          ) : null}
          <p className="mb-2 text-xs text-muted-foreground">
            {t("seasonPlan.clipPhasesHint")} {t("seasonPlan.cueHint")}
          </p>
          {row.clips.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("seasonPlan.noFiles")}</p>
          ) : (
            <div className="space-y-2">
              {row.clips.map((clip) => {
                const o = before.get(clip.id);
                const changed = clip.pending || (o != null && JSON.stringify(o.phases) !== JSON.stringify(clip.phases));
                const clipCues = clip.pending ? [] : (cuesByMedia.get(clip.id) ?? []);
                return (
                  <div key={clip.id} className={clip.active ? "" : "opacity-50"}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`w-64 truncate text-sm ${clip.pending ? "text-primary" : ""}`} title={clip.path}>
                        {clip.title}
                      </span>
                      <span className="w-16 text-xs tabular-nums text-muted-foreground">{clipDurationLabel(t, clip)}</span>
                      <div className={`flex gap-1 rounded-md p-0.5 ${changed ? "ring-1 ring-primary/60" : ""}`}>
                        {PLAN_PHASES.map((phase) => {
                          const on = clip.phases == null || clip.phases.includes(phase);
                          const noMinutes = row.seconds[phase] === 0;
                          return (
                            <button
                              key={phase}
                              type="button"
                              onClick={() => setClipPhase(row, clip.id, phase)}
                              title={noMinutes ? t("seasonPlan.clipPhaseNoMinutes") : phaseLabel(t, phase)}
                              className={`h-7 min-w-11 rounded px-2 text-xs font-semibold transition-colors ${
                                on
                                  ? noMinutes
                                    ? "bg-secondary text-muted-foreground"
                                    : "bg-primary text-primary-foreground"
                                  : "border border-border bg-background text-muted-foreground line-through"
                              }`}
                            >
                              {t(`seasonPlan.phaseShort_${phase}`)}
                            </button>
                          );
                        })}
                      </div>
                      {clip.phases == null ? (
                        <span className="text-xs text-muted-foreground">{t("seasonPlan.clipAllPhases")}</span>
                      ) : null}
                      {!clip.active ? <span className="text-xs text-muted-foreground">{t("seasonPlan.clipInactive")}</span> : null}
                      {inSequence.has(clip.id) ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-violet-500/50 bg-violet-500/10 px-2 py-0.5 text-xs"
                          title={t("seasonPlan.sequenceBadgeTitle")}
                        >
                          {t("seasonPlan.sequenceBadge", {
                            name: inSequence.get(clip.id)!.name,
                            position: inSequence.get(clip.id)!.position,
                          })}
                        </span>
                      ) : null}
                      {clip.pending ? (
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
                          {t("seasonPlan.newBadge")}
                        </span>
                      ) : null}
                      {clipCues.map((cue) => (
                        <span
                          key={cue.id}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                            cue.enabled ? "border-sky-500/50 bg-sky-500/10" : "border-border opacity-60"
                          }`}
                        >
                          <Clock className="size-3" />
                          {t(`seasonPlan.phaseShort_${cue.phase}`)} {formatClock(cue.startSec)}
                          {cue.endSec != null ? `–${formatClock(cue.endSec)}` : ""}
                          <select
                            className="rounded bg-transparent text-[11px] text-muted-foreground"
                            title={t("seasonPlan.cueGuaranteeLabel")}
                            value={cue.guarantee}
                            onChange={(e) => void patchCueGuarantee(cue, e.target.value as CueGuarantee)}
                          >
                            {cue.endSec != null ? <option value="window">{t("seasonPlan.cueGuarantee_window")}</option> : null}
                            <option value="fullPlay">{t("seasonPlan.cueGuarantee_fullPlay")}</option>
                            <option value="none">{t("seasonPlan.cueGuarantee_none")}</option>
                          </select>
                          <button
                            type="button"
                            className="rounded-full p-0.5 hover:bg-accent"
                            title={t("seasonPlan.cueDelete")}
                            onClick={() => void deleteCue(cue)}
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                      {!clip.pending ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-xs"
                          onClick={() => setCueFormFor((cur) => (cur === clip.id ? null : clip.id))}
                        >
                          <Clock className="size-3.5" />
                          {t("seasonPlan.cueAdd")}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("seasonPlan.cueAfterSave")}</span>
                      )}
                      {clip.pending ? (
                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground hover:bg-accent"
                          title={t("seasonPlan.clipRemovePending")}
                          onClick={() => removeClubClip(row, clip.id)}
                        >
                          <X className="size-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="ml-auto rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                          title={t("seasonPlan.clipDelete")}
                          onClick={() => void deleteClip(clip)}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                    {cueFormFor === clip.id ? (
                      <CueForm
                        mediaId={clip.id}
                        halfDurationSec={activeMatch?.halfDurationSec || 45 * 60}
                        onDone={() => {
                          setCueFormFor(null);
                          reloadCues();
                        }}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </td>
      </tr>
    );
  }

  function renderRow(row: PlanRow, rowIndex: number) {
    return (
      <Fragment key={row.key}>
        {renderMainRow(row, rowIndex)}
        {expanded.has(row.key) ? renderClips(row) : null}
      </Fragment>
    );
  }

  function renderMainRow(row: PlanRow, rowIndex: number) {
    const original = originals.get(row.key);
    const isNew = !original;
    const eff = effective.byRow.get(row.key) ?? emptySeconds();
    const cueSec = effective.cueByRow.get(row.key) ?? emptySeconds();
    const changedClass = (changed: boolean) => (changed && !isNew ? "border-primary/60 bg-primary/5" : "border-input");
    const filesChanged =
      !isNew &&
      (row.clips.length !== original!.clips.length ||
        row.clips.some((c) => c.pending) ||
        changedClipTags(row, original).length > 0);
    const canAdd = row.kind === "club" || row.id != null;
    return (
      <tr className={`border-b border-border/60 ${row.active ? "" : "opacity-60"}`}>
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
                      clips: [],
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
          const hasMedia = row.clips.length > 0 || row.mediaCount > 0;
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
                  className="mt-0.5 flex items-center justify-end gap-0.5 text-right text-[10px] text-muted-foreground"
                  title={
                    cueSec[phase] > 0
                      ? t("seasonPlan.effectiveHintCue", {
                          time: formatMinutes(shown, decimal),
                          cue: formatMinutes(cueSec[phase], decimal),
                        })
                      : t("seasonPlan.effectiveHint", { time: formatMinutes(shown, decimal) })
                  }
                >
                  {cueSec[phase] > 0 ? <Clock className="size-2.5" /> : null}≈ {formatMinutes(shown, decimal)}
                </div>
              ) : null}
            </td>
          );
        })}
        <td className="px-2 py-1 text-center align-top">
          <div className="mt-1 flex items-center justify-center gap-1">
            {row.active && row.clips.length === 0 && row.mediaCount === 0 ? (
              <span title={row.kind === "club" ? t("seasonPlan.clubNeedsFile") : t("seasonPlan.noFiles")}>
                <AlertTriangle className="size-4 text-amber-500" />
              </span>
            ) : null}
            <button
              type="button"
              className={`inline-flex items-center gap-0.5 rounded px-1 tabular-nums hover:bg-accent ${filesChanged ? "text-primary" : ""}`}
              title={t("seasonPlan.showFiles")}
              onClick={() => toggleExpanded(row.key)}
            >
              {expanded.has(row.key) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              {row.clips.length || row.mediaCount}
            </button>
            {isElectron ? (
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-40"
                disabled={!canAdd || busyRow != null}
                title={canAdd ? t("seasonPlan.addFilesForRow") : t("seasonPlan.saveFirst")}
                onClick={() => void addFilesToRow(row.key)}
              >
                <Plus className="size-3.5" />
              </button>
            ) : null}
          </div>
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
          <Button
            variant="outline"
            className="gap-2"
            title={t("seasonPlan.groupSequencesHint")}
            onClick={() => void mutateSequences((list) => [...list, newMediaSequence(list, t("seasonPlan.sequenceNewName"))])}
          >
            <Plus className="size-4" />
            {t("seasonPlan.addSequence")}
          </Button>
        </div>
      </div>

      {overlapping.length > 0 && (
        <p role="alert" className="mb-3 text-sm text-amber-700 dark:text-amber-400">
          {t("media.cueOverlap")} {overlapping.join(", ")}
        </p>
      )}
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
              {clubRows.map((row, i) => renderRow(row, sponsorRows.length + i))}
              {sequences.length > 0 ? (
                <GroupHeader title={t("seasonPlan.groupSequences")} hint={t("seasonPlan.groupSequencesHint")} />
              ) : null}
              <SequenceRows
                sequences={sequences}
                mutate={mutateSequences}
                media={mediaRaw ?? []}
                sponsorsById={engineCtx.sponsorsById}
                effective={effective.bySequence}
                decimal={decimal}
              />
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
          clubRows={clubRows}
          onClubFiles={(assigned) => {
            setRows((current) =>
              current.map((r) => {
                const files = assigned.get(r.key);
                if (!files) return r;
                const clips = [...r.clips, ...files.map(pendingClip)];
                return { ...r, clips, mediaCount: clips.length };
              }),
            );
            for (const key of assigned.keys()) toggleExpanded(key, true);
          }}
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

/**
 * Eén bestand op een vast tijdstip: een tijdscue zoals onder Automatisatie, meteen ingepland.
 * Helften volgen de wedstrijdklok (2e helft vanaf 45:00); voor en na de match de tijd sinds de start van die fase.
 */
function CueForm({ mediaId, halfDurationSec, onDone }: { mediaId: string; halfDurationSec: number; onDone: () => void }) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<CuePlanPhase>("firstHalf");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [guarantee, setGuarantee] = useState<CueGuarantee | "auto">("auto");
  const [busy, setBusy] = useState(false);
  const placeholder = phase === "secondHalf" ? formatClock(halfDurationSec + 15 * 60) : phase === "firstHalf" ? "11:00" : "5:00";

  async function add() {
    const startSec = parseClockText(start);
    const endSec = end.trim() ? parseClockText(end) : null;
    if (startSec == null || (end.trim() && (endSec == null || endSec <= startSec))) {
      toast({ title: t("media.cueInvalidInput"), variant: "error" });
      return;
    }
    if (phase === "secondHalf" && startSec < halfDurationSec) {
      toast({ title: t("seasonPlan.cueSecondHalfClock", { start: formatClock(halfDurationSec) }), variant: "warning" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/scheduled-media-cues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaId,
          matchStatus: cueStatusForPlanPhase(phase),
          triggerSec: startSec,
          endSec,
          guarantee: guarantee === "auto" || (guarantee === "window" && endSec == null) ? null : guarantee,
        }),
      });
      if (!res.ok) {
        toast({ title: t(res.status === 409 ? "media.cueOverlap" : "media.cueSaveFailed"), variant: "error" });
        return;
      }
      toast({ title: t("media.cueAdded", { time: formatClock(startSec) }), variant: "success" });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ml-4 mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-2">
      <label className="text-xs">
        <span className="mb-1 block text-muted-foreground">{t("media.cuePhase")}</span>
        <Select value={phase} onChange={(e) => setPhase(e.target.value as CuePlanPhase)} className="h-8 w-40 text-xs">
          {CUE_PLAN_PHASES.map((p) => (
            <option key={p} value={p}>
              {phaseLabel(t, p)}
            </option>
          ))}
        </Select>
      </label>
      <label className="text-xs">
        <span className="mb-1 block text-muted-foreground">{t("media.cueStart")}</span>
        <Input value={start} onChange={(e) => setStart(e.target.value)} placeholder={placeholder} className="h-8 w-24" />
      </label>
      <label className="text-xs">
        <span className="mb-1 block text-muted-foreground">{t("seasonPlan.cueEndOptional")}</span>
        <Input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="–" className="h-8 w-24" />
      </label>
      <label className="text-xs">
        <span className="mb-1 block text-muted-foreground">{t("seasonPlan.cueGuaranteeLabel")}</span>
        <Select
          value={guarantee}
          onChange={(e) => setGuarantee(e.target.value as CueGuarantee | "auto")}
          className="h-8 w-48 text-xs"
        >
          <option value="auto">
            {end.trim() ? t("seasonPlan.cueGuarantee_window") : t("seasonPlan.cueGuarantee_none")}
          </option>
          <option value="fullPlay">{t("seasonPlan.cueGuarantee_fullPlay")}</option>
          <option value="none">{t("seasonPlan.cueGuarantee_none")}</option>
        </Select>
      </label>
      <Button size="sm" onClick={() => void add()} disabled={busy}>
        {t("media.cueAddOnce")}
      </Button>
      <p className="w-full text-[11px] text-muted-foreground">
        {phase === "firstHalf" || phase === "secondHalf"
          ? t("seasonPlan.cueClockHint", { half: formatClock(halfDurationSec) })
          : t("seasonPlan.cueWallHint")}
      </p>
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

/** Keuze per bestand: een opgeslagen sponsor (`sponsor:<id>`) of een clubmedia-rij (`club:<sleutel>`). */
type FileChoice = { path: string; target: string; suggested: boolean };

function LinkFilesDialog({
  open,
  onOpenChange,
  sponsors,
  media,
  clubRows,
  onClubFiles,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sponsors: Sponsor[];
  media: MediaItem[];
  clubRows: PlanRow[];
  onClubFiles: (assigned: Map<string, PlanFile[]>) => void;
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
    () => clubRows.filter((r) => r.name.trim()).sort((a, b) => a.name.localeCompare(b.name)),
    [clubRows],
  );

  async function pick() {
    const paths = await selectFilesViaDialog({
      title: t("seasonPlan.filesTitle"),
      filters: [{ name: t("media.filterMedia"), extensions: SPONSOR_MEDIA_EXTENSIONS }],
      multiSelections: true,
    });
    if (paths.length === 0) return;
    const known = new Set([
      ...media.map((m) => m.path.toLowerCase()),
      ...clubRows.flatMap((r) => r.clips.map((c) => c.path.toLowerCase())),
    ]);
    const fresh = paths.filter((p) => !known.has(p.toLowerCase()));
    setAlreadyLinked(paths.length - fresh.length);
    const candidates = [
      ...sponsors.map((s) => ({ id: `sponsor:${s.id}`, name: s.name })),
      ...clubTargets.map((r) => ({ id: `club:${r.key}`, name: r.name })),
    ];
    setChoices(
      fresh.map((p) => {
        const id = suggestSponsorForFile(fileNameOf(p), candidates);
        return { path: p, target: id ?? "", suggested: id != null };
      }),
    );
  }

  const toLink = choices.filter((c) => c.target);

  async function link() {
    setProgress(0);
    const sponsorItems = toLink
      .filter((c) => c.target.startsWith("sponsor:"))
      .map((c) => ({ path: c.path, sponsorId: c.target.slice("sponsor:".length) }));
    const result = await registerFiles(sponsorItems, sponsors, setProgress);
    const assigned = new Map<string, PlanFile[]>();
    let done = sponsorItems.length;
    let clubCount = 0;
    for (const c of toLink.filter((x) => x.target.startsWith("club:"))) {
      const info = await readMediaFileInfo(c.path);
      const key = c.target.slice("club:".length);
      if (info) {
        assigned.set(key, [...(assigned.get(key) ?? []), info]);
        clubCount += 1;
      } else {
        result.failed.push(fileNameOf(c.path));
      }
      done += 1;
      setProgress(done);
    }
    if (assigned.size > 0) {
      onClubFiles(assigned);
      toast({ title: t("seasonPlan.clubFilesAssigned", { count: clubCount }) });
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
                          className="h-8 text-xs"
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
                            <optgroup label={t("seasonPlan.groupClub")}>
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
