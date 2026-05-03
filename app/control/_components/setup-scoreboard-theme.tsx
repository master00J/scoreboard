"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppSettings } from "@/lib/types";
import {
  mergeScoreboardTheme,
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
  settings: AppSettings | undefined;
  reloadSettings: () => void;
}) {
  const resolved = useMemo(
    () => mergeScoreboardTheme(settings?.scoreboardThemeJson ?? null),
    [settings?.scoreboardThemeJson],
  );
  const [draft, setDraft] = useState<ResolvedScoreboardTheme>(resolved);

  useEffect(() => {
    setDraft(resolved);
  }, [resolved]);

  async function save() {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scoreboardThemeJson: JSON.stringify(draft),
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
          </div>
        </div>
      </div>
    </section>
  );
}
