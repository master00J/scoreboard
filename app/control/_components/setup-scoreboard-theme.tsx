"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppSettings } from "@/lib/types";
import {
  mergeScoreboardTheme,
  sponsorRepeatBudgetCyclesFromThemeJson,
  type LeftStripSegment,
  type ResolvedScoreboardTheme,
} from "@/lib/scoreboard-theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Select } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";

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
}: {
  settings: AppSettings | null | undefined;
  reloadSettings: () => void;
}) {
  const { t } = useTranslation();
  const resolved = useMemo(
    () => mergeScoreboardTheme(settings?.scoreboardThemeJson ?? null),
    [settings?.scoreboardThemeJson],
  );
  const [draft, setDraft] = useState<ResolvedScoreboardTheme>(resolved);

  const [repeatSponsorBudgetCycles, setRepeatSponsorBudgetCycles] = useState(false);

  const segLabels: Record<LeftStripSegment, string> = {
    home: t("setup.themeSegHome"),
    timer: t("setup.themeSegTimer"),
    away: t("setup.themeSegAway"),
  };

  useEffect(() => {
    setDraft(resolved);
  }, [resolved]);

  useEffect(() => {
    setRepeatSponsorBudgetCycles(
      sponsorRepeatBudgetCyclesFromThemeJson(settings?.scoreboardThemeJson ?? null),
    );
  }, [settings?.scoreboardThemeJson]);

  async function save() {
    const themePayload: Record<string, unknown> = { ...draft };
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

  const color = (label: string, key: "frameColorTop" | "frameColorMid" | "frameColorBot" | "contentAreaBg") => (
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
    <section className="bg-card border border-border rounded-xl p-6">
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
            <Label>{t("setup.themeFontFamily")}</Label>
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
          <div className="grid gap-2 pt-1">
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 rounded border-border"
                checked={draft.fullShowPeriod}
                onChange={(e) => setDraft((d) => ({ ...d, fullShowPeriod: e.target.checked }))}
              />
              <span className="text-sm leading-snug">
                <span className="font-medium text-foreground">{t("setup.themeShowPeriod")}</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 rounded border-border"
                checked={draft.fullShowAddedTime}
                onChange={(e) => setDraft((d) => ({ ...d, fullShowAddedTime: e.target.checked }))}
              />
              <span className="text-sm leading-snug">
                <span className="font-medium text-foreground">{t("setup.themeShowAdded")}</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 rounded border-border"
                checked={draft.fullShowTeamNames}
                onChange={(e) => setDraft((d) => ({ ...d, fullShowTeamNames: e.target.checked }))}
              />
              <span className="text-sm leading-snug">
                <span className="font-medium text-foreground">{t("setup.themeShowTeamNames")}</span>
                <span className="block text-muted-foreground mt-1">
                  {t("setup.themeShowTeamNamesHelp")}
                </span>
              </span>
            </label>
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
      </div>
    </section>
  );
}
