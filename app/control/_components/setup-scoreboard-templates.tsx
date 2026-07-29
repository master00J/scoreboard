"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import type { AppSettings } from "@/lib/types";
import { mergeScoreboardTheme, type ResolvedScoreboardTheme } from "@/lib/scoreboard-theme";
import {
  extractVisualTheme,
  type ScoreboardTemplate,
} from "@/lib/scoreboard-templates";

/**
 * Layout-bibliotheek: kies een opgeslagen scorebord-layout of bewaar de huidige als
 * nieuwe template. Templates bevatten alleen visuele instellingen — sponsorgedrag
 * blijft staan zoals het is, ook na het toepassen van een andere layout.
 */
export function SetupScoreboardTemplatesSection({
  settings,
  reloadSettings,
}: {
  settings: AppSettings | null | undefined;
  reloadSettings: () => void;
}) {
  const [templates, setTemplates] = useState<ScoreboardTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/scoreboard-templates");
      setTemplates(res.ok ? ((await res.json()) as ScoreboardTemplate[]) : []);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currentVisual = useMemo(
    () => JSON.stringify(extractVisualTheme(settings?.scoreboardThemeJson ?? null)),
    [settings?.scoreboardThemeJson],
  );

  async function applyTemplate(t: ScoreboardTemplate) {
    setBusyId(t.id);
    try {
      const res = await fetch(`/api/scoreboard-templates/${t.id}/apply`, { method: "POST" });
      if (!res.ok) {
        toast({ title: "Toepassen mislukt", variant: "error" });
        return;
      }
      toast({ title: `Layout "${t.name}" toegepast`, variant: "success" });
      reloadSettings();
    } finally {
      setBusyId(null);
    }
  }

  async function saveCurrentAsTemplate() {
    const name = newName.trim();
    if (!name) {
      toast({ title: "Geef de layout een naam", variant: "error" });
      return;
    }
    const res = await fetch("/api/scoreboard-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        label: newLabel.trim() || null,
        themeJson: settings?.scoreboardThemeJson ?? "{}",
      }),
    });
    if (!res.ok) {
      toast({ title: "Opslaan mislukt", variant: "error" });
      return;
    }
    setNewName("");
    setNewLabel("");
    toast({ title: `Layout "${name}" opgeslagen`, variant: "success" });
    void load();
  }

  async function duplicateTemplate(t: ScoreboardTemplate) {
    const res = await fetch("/api/scoreboard-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${t.name} (kopie)`,
        label: t.label,
        themeJson: t.themeJson,
      }),
    });
    if (!res.ok) {
      toast({ title: "Dupliceren mislukt", variant: "error" });
      return;
    }
    toast({ title: "Kopie gemaakt", variant: "success" });
    void load();
  }

  async function deleteTemplate(t: ScoreboardTemplate) {
    if (!confirm(`"${t.name}" verwijderen?`)) return;
    const res = await fetch(`/api/scoreboard-templates/${t.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast({ title: "Verwijderen mislukt", variant: "error" });
      return;
    }
    toast({ title: "Layout verwijderd", variant: "success" });
    void load();
  }

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Layout-bibliotheek</h3>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
          Kies een opgeslagen scorebord-layout of bewaar je huidige instellingen als nieuwe layout.
          Een layout bevat alleen de vormgeving — sponsorrotatie en afspeelgedrag blijven ongewijzigd.
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Laden…</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => {
            const isCurrent = JSON.stringify(extractVisualTheme(t.themeJson)) === currentVisual;
            return (
              <div
                key={t.id}
                className={`rounded-xl border p-3 space-y-3 ${
                  isCurrent ? "border-emerald-600/70 bg-emerald-950/20" : "border-zinc-800"
                }`}
              >
                <TemplatePreview themeJson={t.themeJson} />

                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{t.name}</div>
                    {t.label ? (
                      <div className="text-[11px] text-muted-foreground truncate">{t.label}</div>
                    ) : null}
                  </div>
                  {t.isBuiltIn ? (
                    <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      Standaard
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busyId === t.id || isCurrent}
                    onClick={() => void applyTemplate(t)}
                  >
                    {isCurrent ? "Actief" : "Toepassen"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void duplicateTemplate(t)}>
                    Dupliceren
                  </Button>
                  {!t.isBuiltIn ? (
                    <Button size="sm" variant="ghost" onClick={() => void deleteTemplate(t)}>
                      Verwijderen
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 p-3 space-y-3">
        <div className="text-xs font-medium">Huidige instellingen opslaan als layout</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] flex-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Naam</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="bv. Thuiswedstrijd"
              className="mt-1"
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Label (optioneel)
            </Label>
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="bv. Jupiler Pro League"
              className="mt-1"
            />
          </div>
          <Button onClick={() => void saveCurrentAsTemplate()}>Opslaan als layout</Button>
        </div>
      </div>
    </section>
  );
}

/**
 * Miniatuur van de layout: dezelfde verhoudingen als het echte scorebord (L-balk links,
 * onderbalk, contentvlak), geschaald naar een 16:9 kaartje. Geen live wedstrijddata —
 * bedoeld om vorm en verhouding te herkennen vóór je toepast.
 */
function TemplatePreview({ themeJson }: { themeJson: string }) {
  const t: ResolvedScoreboardTheme = useMemo(() => mergeScoreboardTheme(themeJson), [themeJson]);

  const CANVAS_W = 1920;
  const CANVAS_H = 1080;
  const leftPct = (t.leftBarWidthPx / CANVAS_W) * 100;
  const bottomPct = (t.bottomBarHeightPx / CANVAS_H) * 100;
  const frame = `linear-gradient(180deg, ${t.frameColorTop}, ${t.frameColorMid}, ${t.frameColorBot})`;

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border border-zinc-800"
      style={{ aspectRatio: "16 / 9", background: t.contentAreaBg }}
    >
      {/* Linkse L-balk */}
      <div
        className="absolute left-0 top-0 bottom-0 flex flex-col items-center justify-around py-[6%]"
        style={{ width: `${leftPct}%`, background: frame }}
      >
        {t.leftColumnOrder.map((seg) => (
          <div
            key={seg}
            className="rounded-sm bg-white/85"
            style={{
              width: "58%",
              height:
                seg === "timer"
                  ? `${Math.max(6, (t.leftTimerPx / CANVAS_H) * 100 * 1.6)}%`
                  : `${Math.max(6, (t.leftScorePx / CANVAS_H) * 100 * 1.2)}%`,
            }}
          />
        ))}
      </div>

      {/* Onderbalk */}
      <div
        className="absolute bottom-0 right-0"
        style={{ left: `${leftPct}%`, height: `${bottomPct}%`, background: frame }}
      />

      {/* Contentvlak-indicatie */}
      <div
        className="absolute flex items-center justify-center"
        style={{ left: `${leftPct}%`, right: 0, top: 0, bottom: `${bottomPct}%` }}
      >
        <div
          className="rounded bg-white/10"
          style={{ width: "46%", height: `${Math.max(14, (t.fullScorePx / CANVAS_H) * 100)}%` }}
        />
      </div>
    </div>
  );
}
