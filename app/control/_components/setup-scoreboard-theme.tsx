"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Redo2, Undo2 } from "lucide-react";
import type { AppSettings, Team } from "@/lib/types";
import { isElectron, selectFilesViaDialog } from "@/lib/electron";
import { mediaUrl } from "@/lib/media-url";
import {
  SCOREBOARD_LAYOUT_MODES,
  TEAM_STACK_ORDERS,
  mergeScoreboardTheme,
  sponsorRepeatBudgetCyclesFromThemeJson,
  themeForFreeformEdit,
  type LeftStripSegment,
  type ResolvedScoreboardTheme,
  type TeamStackOrder,
} from "@/lib/scoreboard-theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Select } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { tSportLabel } from "@/lib/i18n/t-sport";
import { layoutDraftIsDirty, useLayoutEditorStore, type LayoutEditorDraft } from "@/lib/layout-editor-store";
import {
  LAYOUT_PHASES,
  LAYOUT_RULE_LIMIT,
  layoutRulesFromThemeJson,
  type LayoutPhase,
  type LayoutRule,
} from "@/lib/scoreboard-elements";
import { templateDisplayName, type ScoreboardTemplate } from "@/lib/scoreboard-templates";
import { SPORT_TYPES, type SportType } from "@/lib/sports";
import { canRedo, canUndo } from "@/lib/undo-history";
import { SetupScoreboardPlacer, type EditorSurface } from "./setup-scoreboard-placer";

const FONT_PRESETS = [
  {
    id: "system",
    value:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  { id: "inter", value: 'Inter, ui-sans-serif, system-ui, sans-serif' },
  { id: "impact", value: 'Impact, "Arial Black", sans-serif' },
  { id: "condensed", value: '"Roboto Condensed", "Arial Narrow", Arial, sans-serif' },
  { id: "mono", value: 'ui-monospace, "Cascadia Mono", Consolas, monospace' },
] as const;

function ThemeBackgroundField({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const src = mediaUrl(value);

  async function pickElectron() {
    const paths = await selectFilesViaDialog({
      title: label,
      filters: [{ name: t("setup.filterImage"), extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (paths[0]) onChange(paths[0]);
  }

  async function onFile(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    setUploading(false);
    if (!res.ok) {
      toast({ title: t("setup.uploadFailed"), variant: "error" });
      return;
    }
    const data = (await res.json()) as { path?: string };
    if (data.path?.trim()) onChange(data.path.trim());
  }

  return (
    <div>
      <Label>{label}</Label>
      <p className="mt-1 text-xs text-muted-foreground">{help}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {src ? (
          <img src={src} alt="" className="h-16 w-28 rounded border border-border object-cover" />
        ) : (
          <div className="grid h-16 w-28 place-items-center rounded border border-dashed border-border text-[11px] text-muted-foreground">
            {t("setup.themeBackgroundNone")}
          </div>
        )}
        {isElectron ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void pickElectron()}>
            {t("common.chooseFile")}
          </Button>
        ) : (
          <Input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void onFile(file);
            }}
          />
        )}
        {uploading ? <span className="text-xs text-muted-foreground">{t("common.uploading")}</span> : null}
        {value ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
            {t("common.remove")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function swapOrder(order: LeftStripSegment[], i: number, seg: LeftStripSegment): LeftStripSegment[] {
  const o = [...order];
  const j = o.indexOf(seg);
  if (j < 0) return o;
  const tmp = o[i]!;
  o[i] = seg;
  o[j] = tmp;
  return o;
}

/** Indeling per situatie: welke opgeslagen indeling hoort bij welke sport of wedstrijdfase. */
function LayoutRulesSection({
  rules,
  layouts,
  onChange,
  onFocus,
}: {
  rules: LayoutRule[];
  layouts: ScoreboardTemplate[];
  onChange: (next: LayoutRule[]) => void;
  onFocus: () => void;
}) {
  const { t } = useTranslation();
  const update = (id: string, patch: Partial<LayoutRule>) =>
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));

  return (
    <div
      className="mb-6 space-y-3 rounded-lg border border-border p-4"
      data-layout-rules
      // De bibliotheek staat in een ander blok; haal de lijst op zodra iemand hier komt.
      onFocus={onFocus}
      onPointerEnter={onFocus}
    >
      <div>
        <div className="font-semibold text-sm">{t("layoutEditor.rulesTitle")}</div>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          {t("layoutEditor.rulesBody")} {t("layoutEditor.rulesPriority")}
        </p>
      </div>
      {rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("layoutEditor.rulesEmpty")}</p>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr_auto]" data-layout-rule>
              <Select
                value={rule.sport}
                aria-label={t("layoutEditor.rulesSport")}
                onChange={(e) => update(rule.id, { sport: e.target.value as SportType | "*" })}
              >
                <option value="*">{t("layoutEditor.rulesAnySport")}</option>
                {SPORT_TYPES.map((sport) => (
                  <option key={sport} value={sport}>
                    {tSportLabel(t, sport)}
                  </option>
                ))}
              </Select>
              <Select
                value={rule.phase}
                aria-label={t("layoutEditor.rulesPhase")}
                onChange={(e) => update(rule.id, { phase: e.target.value as LayoutPhase | "*" })}
              >
                <option value="*">{t("layoutEditor.rulesAnyPhase")}</option>
                {LAYOUT_PHASES.map((phase) => (
                  <option key={phase} value={phase}>
                    {t(`layoutEditor.phase_${phase}`)}
                  </option>
                ))}
              </Select>
              <Select
                value={rule.templateId}
                aria-label={t("layoutEditor.rulesLayout")}
                onChange={(e) => update(rule.id, { templateId: e.target.value })}
              >
                {layouts.some((layout) => layout.id === rule.templateId) ? null : (
                  <option value={rule.templateId}>{t("layoutEditor.rulesMissing")}</option>
                )}
                {layouts.map((layout) => (
                  <option key={layout.id} value={layout.id}>
                    {templateDisplayName(layout)}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10"
                onClick={() => onChange(rules.filter((item) => item.id !== rule.id))}
              >
                {t("common.remove")}
              </Button>
            </div>
          ))}
        </div>
      )}
      {layouts.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("layoutEditor.rulesNoLayouts")}</p>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rules.length >= LAYOUT_RULE_LIMIT}
          onClick={() =>
            onChange([
              ...rules,
              {
                id: "rule-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                sport: "*",
                phase: "*",
                templateId: layouts[0].id,
              },
            ])
          }
        >
          {t("layoutEditor.rulesAdd")}
        </Button>
      )}
    </div>
  );
}

export function SetupScoreboardThemeSection({
  settings,
  reloadSettings,
  homeTeam,
  awayTeam,
  seedThemeJson,
  onSeedConsumed,
}: {
  settings: AppSettings | null | undefined;
  reloadSettings: () => void;
  homeTeam?: Team | null;
  awayTeam?: Team | null;
  seedThemeJson?: string | null;
  onSeedConsumed?: () => void;
}) {
  const { t } = useTranslation();
  const resolved = useMemo(
    () => mergeScoreboardTheme(settings?.scoreboardThemeJson ?? null),
    [settings?.scoreboardThemeJson],
  );
  const savedJson = settings?.scoreboardThemeJson ?? null;
  /** Wat opgeslagen is, in de vorm waarin de editor ermee werkt. */
  const savedDraft = useMemo<LayoutEditorDraft>(
    () => ({
      theme: themeForFreeformEdit(resolved),
      rules: layoutRulesFromThemeJson(savedJson),
      repeatSponsorBudgetCycles: sponsorRepeatBudgetCyclesFromThemeJson(savedJson),
    }),
    [resolved, savedJson],
  );
  const history = useLayoutEditorStore((state) => state.history);
  const base = useLayoutEditorStore((state) => state.base);
  const store = useLayoutEditorStore.getState;
  const present = history?.present ?? savedDraft;
  const draft = present.theme;
  const rules = present.rules;
  const repeatSponsorBudgetCycles = present.repeatSponsorBudgetCycles;
  const dirty = layoutDraftIsDirty(base, history?.present ?? null);
  const gestureStartRef = useRef<LayoutEditorDraft | null>(null);
  const [surface, setSurface] = useState<EditorSurface>("sponsor");
  const [layouts, setLayouts] = useState<ScoreboardTemplate[]>([]);
  const [tryUntil, setTryUntil] = useState<number | null>(null);

  const canvasWidth = Math.max(320, Number(settings?.displayCanvasWidth ?? 1920));
  const canvasHeight = Math.max(240, Number(settings?.displayCanvasHeight ?? 1080));

  /** Eén stap in de geschiedenis, of met `live` een tussenstand tijdens slepen. */
  const setDraft = useCallback(
    (
      next: ResolvedScoreboardTheme | ((current: ResolvedScoreboardTheme) => ResolvedScoreboardTheme),
      opts?: { live?: boolean; coalesce?: string },
    ) => {
      const current = store().history?.present;
      if (!current) return;
      const theme = typeof next === "function" ? next(current.theme) : next;
      if (opts?.live) store().replace({ ...current, theme });
      else store().push({ ...current, theme }, opts?.coalesce);
    },
    [store],
  );
  const patchDraft = useCallback(
    (patch: Partial<LayoutEditorDraft>) => {
      const current = store().history?.present;
      if (current) store().push({ ...current, ...patch });
    },
    [store],
  );
  const setRepeatSponsorBudgetCycles = (value: boolean) => patchDraft({ repeatSponsorBudgetCycles: value });
  const setRules = (next: LayoutRule[]) => patchDraft({ rules: next });

  const loadLayouts = useCallback(async () => {
    try {
      const res = await fetch("/api/scoreboard-templates");
      setLayouts(res.ok ? ((await res.json()) as ScoreboardTemplate[]) : []);
    } catch {
      setLayouts([]);
    }
  }, []);

  const segLabels: Record<LeftStripSegment, string> = {
    home: t("setup.themeSegHome"),
    timer: t("setup.themeSegTimer"),
    away: t("setup.themeSegAway"),
  };

  // Begin opnieuw zodra de opgeslagen indeling verandert (eerste keer laden, of na opslaan). Bij
  // terugkeren naar dit tabblad met dezelfde opgeslagen indeling blijft het concept gewoon staan.
  useEffect(() => {
    if (!settings) return;
    const key = savedJson ?? "";
    if (store().baseKey === key && store().history) return;
    store().reset(key, savedDraft);
  }, [settings, savedJson, savedDraft, store]);

  useEffect(() => {
    if (!seedThemeJson) return;
    setDraft(themeForFreeformEdit(mergeScoreboardTheme(seedThemeJson)));
    onSeedConsumed?.();
  }, [seedThemeJson, onSeedConsumed, setDraft]);

  useEffect(() => {
    void loadLayouts();
  }, [loadLayouts, savedJson]);

  // "Probeer op scherm" loopt vanzelf af; zet de knop dan terug.
  useEffect(() => {
    if (!tryUntil) return;
    const id = window.setTimeout(() => setTryUntil(null), Math.max(0, tryUntil - Date.now()));
    return () => window.clearTimeout(id);
  }, [tryUntil]);

  function themePayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      ...draft,
      layoutMode: draft.layoutMode,
    };
    if (repeatSponsorBudgetCycles) payload.sponsorRepeatBudgetCycles = true;
    if (rules.length > 0) payload.layoutRules = rules;
    return payload;
  }

  async function tryOnScreen() {
    const seconds = 60;
    try {
      const res = await fetch("/api/display/theme-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeJson: JSON.stringify(themePayload()), seconds }),
      });
      const data = (await res.json().catch(() => ({}))) as { until?: number };
      if (!res.ok) throw new Error("preview");
      setTryUntil(data.until ?? Date.now() + seconds * 1000);
      toast({ title: t("layoutEditor.tryStarted", { seconds }), variant: "success" });
    } catch {
      toast({ title: t("layoutEditor.tryFailed"), variant: "error" });
    }
  }

  async function stopTryOnScreen() {
    await fetch("/api/display/theme-preview", { method: "DELETE" }).catch(() => {});
    setTryUntil(null);
    toast({ title: t("layoutEditor.tryStopped") });
  }

  function discardChanges() {
    if (!confirm(t("layoutEditor.discardConfirm"))) return;
    store().discard();
  }

  async function save() {
    const json = JSON.stringify(themePayload());
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scoreboardThemeJson: json }),
    });
    if (!res.ok) {
      toast({ title: t("setup.themeSaveFailed"), variant: "error" });
      return;
    }
    // De geschiedenis blijft staan, zodat ongedaan maken ook na opslaan nog kan.
    store().markSaved(json);
    setTryUntil(null);
    toast({ title: t("setup.themeSaved"), variant: "success" });
    reloadSettings();
  }

  async function resetDefault() {
    // Dit wist de opgeslagen indeling van de club; ongedaan maken kan daarna niet meer.
    if (!confirm(t("layoutEditor.resetConfirm"))) return;
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scoreboardThemeJson: null }),
    });
    if (!res.ok) {
      toast({ title: t("setup.themeResetFailed"), variant: "error" });
      return;
    }
    toast({ title: t("setup.themeResetOk"), variant: "success" });
    reloadSettings();
  }

  const num = (key: keyof ResolvedScoreboardTheme) => (
    <Input
      type="number"
      className="mt-1"
      value={draft[key] as number}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (!Number.isFinite(v)) return;
        setDraft((d) => ({ ...d, [key]: v }), { coalesce: `field:${key}` });
      }}
    />
  );

  const color = (
    label: string,
    key: "frameColorTop" | "frameColorMid" | "frameColorBot" | "contentAreaBg" | "scoreColor" | "teamNameColor",
  ) => (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 flex gap-2 items-center">
        <input
          type="color"
          aria-label={label}
          className="h-9 w-14 cursor-pointer rounded border border-border bg-background"
          value={/^#[0-9a-fA-F]{6}$/.test(draft[key]) ? draft[key] : "#000000"}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }), { coalesce: `field:${key}` })}
        />
        <Input
          value={draft[key]}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }), { coalesce: `field:${key}` })}
          className="font-mono text-sm"
        />
      </div>
    </div>
  );

  const timerColor = (label: string, key: "timerRunningColor" | "timerPausedColor") => (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 flex gap-2 items-center">
        <Input
          value={draft[key]}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }), { coalesce: `field:${key}` })}
          className="font-mono text-sm"
          placeholder="#ffffff"
        />
      </div>
    </div>
  );

  return (
    <section id="scoreboard-layout-editor" className="bg-card border border-border rounded-xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold">{t("setup.themeTitle")}</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            {t("setup.themeBody")}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {dirty ? (
            <span
              className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-200"
              data-layout-dirty
            >
              {t("layoutEditor.unsaved")}
            </span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={!history || !canUndo(history)}
            title={t("layoutEditor.undo")}
            aria-label={t("layoutEditor.undo")}
            onClick={() => store().undo()}
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!history || !canRedo(history)}
            title={t("layoutEditor.redo")}
            aria-label={t("layoutEditor.redo")}
            onClick={() => store().redo()}
          >
            <Redo2 className="size-4" />
          </Button>
          {tryUntil ? (
            <Button variant="warning" size="sm" onClick={() => void stopTryOnScreen()}>
              {t("layoutEditor.trying")}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void tryOnScreen()}>
              {t("layoutEditor.tryOnScreen")}
            </Button>
          )}
          {dirty ? (
            <Button variant="ghost" size="sm" onClick={discardChanges}>
              {t("layoutEditor.discard")}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => void resetDefault()}>
            {t("setup.themeDefault")}
          </Button>
          <Button size="sm" onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </div>
      </div>

      <div className="mb-6 space-y-3 rounded-lg border border-border p-4">
        <div className="font-semibold text-sm">{t("setup.themePlacerTitle")}</div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["sponsor", "themeSurfaceSponsor"],
              ["full", "themeSurfaceFull"],
            ] as const
          ).map(([id, labelKey]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSurface(id)}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                surface === id
                  ? "border-primary bg-primary/10 font-medium"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              {t(`setup.${labelKey}`)}
            </button>
          ))}
        </div>
        <SetupScoreboardPlacer
          theme={draft}
          onChange={setDraft}
          onGestureStart={() => {
            gestureStartRef.current = store().history?.present ?? null;
          }}
          onGestureEnd={() => {
            if (gestureStartRef.current) store().commitGesture(gestureStartRef.current);
            gestureStartRef.current = null;
          }}
          onUndo={() => store().undo()}
          onRedo={() => store().redo()}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          surface={surface}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          safeZonePx={Math.max(0, Number(settings?.displaySafeZoneMarginPx ?? 40))}
        />
      </div>

      <LayoutRulesSection
        rules={rules}
        layouts={layouts}
        onChange={setRules}
        onFocus={() => void loadLayouts()}
      />

      <div className="mb-6 space-y-4 rounded-lg border border-border p-4">
        <div>
          <div className="font-semibold text-sm">{t("setup.themeBackgroundsTitle")}</div>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{t("setup.themeBackgroundsHelp")}</p>
        </div>
        <ThemeBackgroundField
          label={t("setup.themeScoreboardBackground")}
          help={t("setup.themeScoreboardBackgroundHelp")}
          value={draft.scoreboardBackgroundPath}
          onChange={(path) => setDraft((d) => ({ ...d, scoreboardBackgroundPath: path }))}
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <ThemeBackgroundField
            label={t("setup.themeFullBackground")}
            help={t("setup.themeFullBackgroundHelp")}
            value={draft.fullBackgroundPath}
            onChange={(path) => setDraft((d) => ({ ...d, fullBackgroundPath: path }))}
          />
          <ThemeBackgroundField
            label={t("setup.themeLBackground")}
            help={t("setup.themeLBackgroundHelp")}
            value={draft.leftFrameBackgroundPath}
            onChange={(path) => setDraft((d) => ({ ...d, leftFrameBackgroundPath: path }))}
          />
        </div>
      </div>

      <div className="mb-6 space-y-3 rounded-lg border border-border p-4">
        <div className="font-semibold text-sm">{t("setup.themeVisible")}</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["showLogos", "themeShowLogos"],
              ["showScores", "themeShowScores"],
              ["showClock", "themeShowClock"],
              ["fullShowPeriod", "themeShowPeriod"],
              ["fullShowAddedTime", "themeShowAdded"],
              ["fullShowTeamNames", "themeShowTeamNames"],
            ] as const
          ).map(([key, labelKey]) => (
            <label key={key} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 rounded border-border"
                checked={draft[key]}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.checked }))}
              />
              <span className="text-sm font-medium">{t(`setup.${labelKey}`)}</span>
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 pt-2">
          {color(t("setup.themeScoreColor"), "scoreColor")}
          {color(t("setup.themeTeamNameColor"), "teamNameColor")}
        </div>
        <div>
          <Label>{t("setup.themeStackOrder")}</Label>
          <Select
            className="mt-1"
            value={draft.fullTeamStackOrder}
            onChange={(e) =>
              setDraft((d) => ({ ...d, fullTeamStackOrder: e.target.value as TeamStackOrder }))
            }
          >
            {TEAM_STACK_ORDERS.map((order) => (
              <option key={order} value={order}>
                {t(`setup.themeStack_${order}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer font-semibold text-sm">{t("setup.themeAdvanced")}</summary>
        <div className="mt-4 mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {SCOREBOARD_LAYOUT_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setDraft((d) => ({ ...d, layoutMode: mode }))}
              className={`rounded-lg border px-3 py-3 text-left text-sm transition-colors ${
                draft.layoutMode === mode
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border hover:bg-muted/40"
              }`}
            >
              <div className="font-semibold">{t(`setup.themeLayout_${mode}`)}</div>
              <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {t(`setup.themeLayoutHelp_${mode}`)}
              </div>
            </button>
          ))}
        </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="font-semibold text-sm">{t("setup.themeFrameGrid")}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>{t("setup.themeLeftBarWidth")}</Label>
              {num("leftBarWidthPx")}
            </div>
            <div>
              <Label>{t("setup.themeBottomBarHeight")}</Label>
              {num("bottomBarHeightPx")}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {color(t("setup.themeFrameTop"), "frameColorTop")}
            {color(t("setup.themeFrameMid"), "frameColorMid")}
            {color(t("setup.themeFrameBot"), "frameColorBot")}
          </div>
          {color(t("setup.themeContentBg"), "contentAreaBg")}
          <div>
            <Label>{t("setup.themeFontPreset")}</Label>
            <Select
              className="mt-1"
              value={FONT_PRESETS.find((p) => p.value === draft.fontFamily)?.id ?? "custom"}
              onChange={(e) => {
                const preset = FONT_PRESETS.find((p) => p.id === e.target.value);
                if (preset) setDraft((d) => ({ ...d, fontFamily: preset.value }));
              }}
            >
              {FONT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(`setup.themeFont_${p.id}`)}
                </option>
              ))}
              <option value="custom">{t("setup.themeFont_custom")}</option>
            </Select>
            <Label className="mt-3">{t("setup.themeFontFamily")}</Label>
            <Input
              className="mt-1 font-mono text-sm"
              value={draft.fontFamily}
              onChange={(e) => setDraft((d) => ({ ...d, fontFamily: e.target.value }), { coalesce: "field:fontFamily" })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {timerColor(t("setup.themeTimerRunning"), "timerRunningColor")}
            {timerColor(t("setup.themeTimerPaused"), "timerPausedColor")}
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 rounded border-border"
              checked={repeatSponsorBudgetCycles}
              onChange={(e) => setRepeatSponsorBudgetCycles(e.target.checked)}
            />
            <span className="text-sm leading-snug">
              <span className="font-medium text-foreground">{t("setup.themeSponsorRepeat")}</span>
              <span className="block text-muted-foreground mt-1">
                {t("setup.themeSponsorRepeatHelp")}
              </span>
            </span>
          </label>
        </div>

        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="font-semibold text-sm">{t("setup.themeLeftOrder")}</div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <Label>{t("setup.themePosition", { n: i + 1 })}</Label>
                <Select
                  className="mt-1"
                  value={draft.leftColumnOrder[i] ?? "home"}
                  onChange={(e) => {
                    const seg = e.target.value as LeftStripSegment;
                    setDraft((d) => ({
                      ...d,
                      leftColumnOrder: swapOrder(d.leftColumnOrder, i, seg),
                    }));
                  }}
                >
                  {(Object.keys(segLabels) as LeftStripSegment[]).map((k) => (
                    <option key={k} value={k}>
                      {segLabels[k]}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>

          <div className="font-semibold text-sm pt-2">{t("setup.themeLSizes")}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>{t("setup.themeLogoPx")}</Label>
              {num("leftLogoPx")}
            </div>
            <div>
              <Label>{t("setup.themeScorePx")}</Label>
              {num("leftScorePx")}
            </div>
            <div>
              <Label>{t("setup.themeTimerPx")}</Label>
              {num("leftTimerPx")}
            </div>
            <div>
              <Label>{t("setup.themePeriodPx")}</Label>
              {num("leftPeriodPx")}
            </div>
            <div className="sm:col-span-2">
              <Label>{t("setup.themeTimerBlockH")}</Label>
              {num("leftTimerBlockHeightPx")}
            </div>
          </div>

          <div className="font-semibold text-sm pt-2">{t("setup.themeFullTitle")}</div>
          <p className="text-xs text-muted-foreground">
            {t("setup.themeFullHint")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>{t("setup.themeLogoPx")}</Label>
              {num("fullLogoPx")}
            </div>
            <div>
              <Label>{t("setup.themeScorePx")}</Label>
              {num("fullScorePx")}
            </div>
            <div>
              <Label>{t("setup.themeTimerPx")}</Label>
              {num("fullTimerPx")}
            </div>
            <div>
              <Label>{t("setup.themeFullPeriodPx")}</Label>
              {num("fullPeriodPx")}
            </div>
            <div>
              <Label>{t("setup.themeFullCenterW")}</Label>
              {num("fullCenterWidthPx")}
            </div>
            <div>
              <Label>{t("setup.themeFullSidePad")}</Label>
              {num("fullSidePaddingPx")}
            </div>
            <div>
              <Label>{t("setup.themeFullTeamGap")}</Label>
              {num("fullTeamStackGapPx")}
            </div>
            <div>
              <Label>{t("setup.themeFullCenterGap")}</Label>
              {num("fullCenterStackGapPx")}
            </div>
            <div className="sm:col-span-2">
              <Label>{t("setup.themeFullAlpha")}</Label>
              <Input
                className="mt-1 font-mono text-sm uppercase max-w-[8rem]"
                maxLength={2}
                value={draft.fullTeamRadialAlphaHex}
                placeholder="2a"
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 2);
                  setDraft((d) => ({ ...d, fullTeamRadialAlphaHex: v }), { coalesce: "field:fullTeamRadialAlphaHex" });
                }}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("setup.themeFullAlphaHelp")}
              </p>
            </div>
            <div>
              <Label>{t("setup.themeTeamNamePx")}</Label>
              {num("fullTeamNamePx")}
            </div>
          </div>
          <div className="font-semibold text-sm pt-2">{t("setup.themeStripTitle")}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>{t("setup.themeStripHeight")}</Label>
              {num("stripHeightPx")}
            </div>
            <div>
              <Label>{t("setup.themeLogoPx")}</Label>
              {num("stripLogoPx")}
            </div>
            <div>
              <Label>{t("setup.themeScorePx")}</Label>
              {num("stripScorePx")}
            </div>
            <div>
              <Label>{t("setup.themeTimerPx")}</Label>
              {num("stripTimerPx")}
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 rounded border-border"
              checked={draft.fullTeamNameUppercase}
              onChange={(e) => setDraft((d) => ({ ...d, fullTeamNameUppercase: e.target.checked }))}
            />
            <span className="text-sm leading-snug">
              <span className="font-medium text-foreground">{t("setup.themeTeamNameUpper")}</span>
            </span>
          </label>
        </div>
      </div>
      </details>
    </section>
  );
}
