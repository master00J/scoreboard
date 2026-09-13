"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppSettings, Team } from "@/lib/types";
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

function swapOrder(order: LeftStripSegment[], i: number, seg: LeftStripSegment): LeftStripSegment[] {
  const o = [...order];
  const j = o.indexOf(seg);
  if (j < 0) return o;
  const tmp = o[i]!;
  o[i] = seg;
  o[j] = tmp;
  return o;
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
  const [draft, setDraft] = useState<ResolvedScoreboardTheme>(() => themeForFreeformEdit(resolved));
  const [surface, setSurface] = useState<EditorSurface>("sponsor");

  const [repeatSponsorBudgetCycles, setRepeatSponsorBudgetCycles] = useState(false);

  const segLabels: Record<LeftStripSegment, string> = {
    home: t("setup.themeSegHome"),
    timer: t("setup.themeSegTimer"),
    away: t("setup.themeSegAway"),
  };

  useEffect(() => {
    setDraft(themeForFreeformEdit(resolved));
  }, [resolved]);

  useEffect(() => {
    if (!seedThemeJson) return;
    setDraft(themeForFreeformEdit(mergeScoreboardTheme(seedThemeJson)));
    onSeedConsumed?.();
  }, [seedThemeJson, onSeedConsumed]);

  useEffect(() => {
    setRepeatSponsorBudgetCycles(
      sponsorRepeatBudgetCyclesFromThemeJson(settings?.scoreboardThemeJson ?? null),
    );
  }, [settings?.scoreboardThemeJson]);

  async function save() {
    const themePayload: Record<string, unknown> = {
      ...draft,
      layoutMode: draft.layoutMode === "auto" ? "custom" : draft.layoutMode,
    };
    if (repeatSponsorBudgetCycles) {
      themePayload.sponsorRepeatBudgetCycles = true;
    }
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scoreboardThemeJson: JSON.stringify(themePayload),
      }),
    });
    if (!res.ok) {
      toast({ title: t("setup.themeSaveFailed"), variant: "error" });
      return;
    }
    toast({ title: t("setup.themeSaved"), variant: "success" });
    reloadSettings();
  }

  async function resetDefault() {
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
        setDraft((d) => ({ ...d, [key]: v }));
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
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        />
        <Input
          value={draft[key]}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
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
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
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
        <div className="flex gap-2">
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
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          surface={surface}
        />
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
              onChange={(e) => setDraft((d) => ({ ...d, fontFamily: e.target.value }))}
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
                  setDraft((d) => ({ ...d, fullTeamRadialAlphaHex: v }));
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
