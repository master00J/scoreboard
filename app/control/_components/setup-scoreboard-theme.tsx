"use client";

import { useEffect, useMemo, useState } from "react";
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

const SEG_LABELS: Record<LeftStripSegment, string> = {
  home: "Thuis (logo + score)",
  timer: "Klok + periode",
  away: "Uit (logo + score)",
};

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
  const resolved = useMemo(
    () => mergeScoreboardTheme(settings?.scoreboardThemeJson ?? null),
    [settings?.scoreboardThemeJson],
  );
  const [draft, setDraft] = useState<ResolvedScoreboardTheme>(resolved);

  const [repeatSponsorBudgetCycles, setRepeatSponsorBudgetCycles] = useState(false);

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
      toast({ title: "Thema opslaan mislukt", variant: "error" });
      return;
    }
    toast({ title: "Scorebord-thema opgeslagen", variant: "success" });
    reloadSettings();
  }

  async function resetDefault() {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scoreboardThemeJson: null }),
    });
    if (!res.ok) {
      toast({ title: "Reset mislukt", variant: "error" });
      return;
    }
    toast({ title: "Standaardthema hersteld", variant: "success" });
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
          <h2 className="text-lg font-semibold">Scorebord lay-out &amp; thema</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Pas het L-scorebord (naast sponsors), het fullscreen scorebord en kleuren aan. Waarden worden
            bij opslaan gevalideerd en begrensd. Het stadionscherm laadt dit automatisch na opslaan.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void resetDefault()}>
            Standaard
          </Button>
          <Button size="sm" onClick={() => void save()}>
            Opslaan
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="font-semibold text-sm">Frame &amp; raster</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Linker kolom breedte (px)</Label>
              {num("leftBarWidthPx")}
            </div>
            <div>
              <Label>Onderbalk hoogte (px)</Label>
              {num("bottomBarHeightPx")}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {color("Frame kleur (boven)", "frameColorTop")}
            {color("Frame kleur (midden)", "frameColorMid")}
            {color("Frame kleur (onder)", "frameColorBot")}
          </div>
          {color("Achtergrond contentvlak", "contentAreaBg")}
          <div>
            <Label>Lettertype (CSS font-family)</Label>
            <Input
              className="mt-1 font-mono text-sm"
              value={draft.fontFamily}
              onChange={(e) => setDraft((d) => ({ ...d, fontFamily: e.target.value }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {timerColor("Klok: actief (kleur)", "timerRunningColor")}
            {timerColor("Klok: pauze (kleur)", "timerPausedColor")}
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 rounded border-border"
              checked={repeatSponsorBudgetCycles}
              onChange={(e) => setRepeatSponsorBudgetCycles(e.target.checked)}
            />
            <span className="text-sm leading-snug">
              <span className="font-medium text-foreground">Sponsor-budget opnieuw starten na volledige ronde</span>
              <span className="block text-muted-foreground mt-1">
                Als alle sponsors hun geplande tijd gehaald hebben, begint de rotatie opnieuw tot de fase wisselt.
                Uitzetten (standaard): daarna scorebord tenzij je alleen een playlist met twee clips gebruikt voor een eindeloze loop.
              </span>
            </span>
          </label>
        </div>

        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="font-semibold text-sm">Volgorde linkerkolom</div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <Label>Positie {i + 1}</Label>
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
                  {(Object.keys(SEG_LABELS) as LeftStripSegment[]).map((k) => (
                    <option key={k} value={k}>
                      {SEG_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>

          <div className="font-semibold text-sm pt-2">Maten L-scorebord</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Logo (px)</Label>
              {num("leftLogoPx")}
            </div>
            <div>
              <Label>Score (px)</Label>
              {num("leftScorePx")}
            </div>
            <div>
              <Label>Klok (px)</Label>
              {num("leftTimerPx")}
            </div>
            <div>
              <Label>Periode tekst (px)</Label>
              {num("leftPeriodPx")}
            </div>
            <div className="sm:col-span-2">
              <Label>Klok-blok hoogte (px)</Label>
              {num("leftTimerBlockHeightPx")}
            </div>
          </div>

          <div className="font-semibold text-sm pt-2">Fullscreen scorebord</div>
          <p className="text-xs text-muted-foreground">
            Typografie hierboven (lettertype en klokkleuren) geldt ook voor het volledige scherm.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Logo (px)</Label>
              {num("fullLogoPx")}
            </div>
            <div>
              <Label>Score (px)</Label>
              {num("fullScorePx")}
            </div>
            <div>
              <Label>Klok (px)</Label>
              {num("fullTimerPx")}
            </div>
            <div>
              <Label>Periode (px)</Label>
              {num("fullPeriodPx")}
            </div>
            <div>
              <Label>Middenkolom breedte (px)</Label>
              {num("fullCenterWidthPx")}
            </div>
            <div>
              <Label>Zij-padding teams (px)</Label>
              {num("fullSidePaddingPx")}
            </div>
            <div>
              <Label>Ruimte logo ↔ score (px)</Label>
              {num("fullTeamStackGapPx")}
            </div>
            <div>
              <Label>Ruimte middenblok (px)</Label>
              {num("fullCenterStackGapPx")}
            </div>
            <div className="sm:col-span-2">
              <Label>Teamkleur op achtergrond (hex alpha, 00–ff)</Label>
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
                Hoger = sterkere gloed in clubkleuren langs de randen. Ongeldige waarden worden bij opslaan naar standaard gezet.
              </p>
            </div>
            <div>
              <Label>Clubnaam (px)</Label>
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
                <span className="font-medium text-foreground">Periode tonen</span>
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
                <span className="font-medium text-foreground">Extratijd (+min) tonen</span>
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
                <span className="font-medium text-foreground">Clubnaam tonen (korte naam)</span>
                <span className="block text-muted-foreground mt-1">
                  Tussen logo en score; gebruikt het veld “korte naam” van de club waar mogelijk.
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
                <span className="font-medium text-foreground">Clubnaam in hoofdletters</span>
              </span>
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
