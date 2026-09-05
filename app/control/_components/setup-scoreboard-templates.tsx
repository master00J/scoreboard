"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import type { AppSettings } from "@/lib/types";
import { mergeScoreboardTheme } from "@/lib/scoreboard-theme";
import {
  extractVisualTheme,
  templateMediaKind,
  type ScoreboardTemplate,
} from "@/lib/scoreboard-templates";
import { ScoreboardThemePreview } from "./setup-scoreboard-preview";

/**
 * Layout-bibliotheek: kies een opgeslagen scorebord-layout of bewaar de huidige als
 * nieuwe template. Templates bevatten alleen visuele instellingen — sponsorgedrag
 * blijft staan zoals het is, ook na het toepassen van een andere layout.
 */
export function SetupScoreboardTemplatesSection({
  settings,
  reloadSettings,
  onEditLayout,
}: {
  settings: AppSettings | null | undefined;
  reloadSettings: () => void;
  onEditLayout?: (themeJson: string) => void;
}) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<ScoreboardTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);

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
  const customTemplates = useMemo(() => templates.filter((tpl) => !tpl.isBuiltIn), [templates]);

  async function applyTemplate(tpl: ScoreboardTemplate) {
    setBusyId(tpl.id);
    setMenuId(null);
    try {
      const res = await fetch(`/api/scoreboard-templates/${tpl.id}/apply`, { method: "POST" });
      if (!res.ok) {
        toast({ title: t("setup.templatesApplyFailed"), variant: "error" });
        return;
      }
      toast({ title: t("setup.templatesApplied", { name: tpl.name }), variant: "success" });
      reloadSettings();
    } finally {
      setBusyId(null);
    }
  }

  async function saveCurrentAsTemplate() {
    const name = newName.trim();
    if (!name) {
      toast({ title: t("setup.templatesNeedName"), variant: "error" });
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
      toast({ title: t("setup.saveFailed"), variant: "error" });
      return;
    }
    setNewName("");
    setNewLabel("");
    toast({ title: t("setup.templatesSaved", { name }), variant: "success" });
    void load();
  }

  async function duplicateTemplate(tpl: ScoreboardTemplate) {
    setMenuId(null);
    const res = await fetch("/api/scoreboard-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: t("setup.templatesCopySuffix", { name: tpl.name }),
        label: tpl.label,
        themeJson: tpl.themeJson,
      }),
    });
    if (!res.ok) {
      toast({ title: t("setup.templatesDuplicateFailed"), variant: "error" });
      return;
    }
    toast({ title: t("setup.templatesDuplicated"), variant: "success" });
    void load();
  }

  async function deleteTemplate(tpl: ScoreboardTemplate) {
    setMenuId(null);
    if (!confirm(t("setup.templatesDeleteConfirm", { name: tpl.name }))) return;
    const res = await fetch(`/api/scoreboard-templates/${tpl.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast({ title: t("setup.templatesDeleteFailed"), variant: "error" });
      return;
    }
    toast({ title: t("setup.templatesDeleted"), variant: "success" });
    void load();
  }

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t("setup.templatesTitle")}</h3>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{t("setup.templatesBody")}</p>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {customTemplates.length === 0 ? (
            <p className="text-xs text-muted-foreground sm:col-span-2">{t("setup.templatesEmpty")}</p>
          ) : null}
          {customTemplates.map((tpl) => {
            const isCurrent = JSON.stringify(extractVisualTheme(tpl.themeJson)) === currentVisual;
            const kind = templateMediaKind(tpl.themeJson);
            const theme = mergeScoreboardTheme(tpl.themeJson);
            return (
              <div
                key={tpl.id}
                className={`rounded-xl border p-3 space-y-3 ${
                  isCurrent ? "border-emerald-500/80 bg-emerald-950/25" : "border-zinc-800"
                }`}
              >
                <div className="relative">
                  {isCurrent ? (
                    <span className="absolute left-2 top-2 z-10 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black">
                      {t("common.active")}
                    </span>
                  ) : null}
                  <ScoreboardThemePreview theme={theme} />
                </div>

                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{tpl.name}</div>
                    {tpl.label ? (
                      <div className="text-[11px] text-muted-foreground leading-snug">{tpl.label}</div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                      {kind === "overlay" ? t("setup.templatesKindOverlay") : t("setup.templatesKindReserved")}
                    </span>
                    {tpl.isBuiltIn ? (
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                        {t("setup.templatesBuiltIn")}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={busyId === tpl.id || isCurrent}
                    onClick={() => void applyTemplate(tpl)}
                  >
                    {isCurrent ? t("common.active") : t("setup.templatesApply")}
                  </Button>
                  {onEditLayout ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onEditLayout(tpl.themeJson);
                        document.getElementById("scoreboard-layout-editor")?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        });
                      }}
                    >
                      {t("setup.templatesEdit")}
                    </Button>
                  ) : null}
                  <div className="relative">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-expanded={menuId === tpl.id}
                      aria-label={t("setup.templatesMore")}
                      onClick={() => setMenuId((id) => (id === tpl.id ? null : tpl.id))}
                    >
                      ⋯
                    </Button>
                    {menuId === tpl.id ? (
                      <div className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-lg border border-border bg-card p-1 shadow-lg">
                        <button
                          type="button"
                          className="block w-full rounded-md px-3 py-1.5 text-left text-xs hover:bg-secondary"
                          onClick={() => void duplicateTemplate(tpl)}
                        >
                          {t("setup.templatesDuplicate")}
                        </button>
                        {!tpl.isBuiltIn ? (
                          <button
                            type="button"
                            className="block w-full rounded-md px-3 py-1.5 text-left text-xs text-red-400 hover:bg-secondary"
                            onClick={() => void deleteTemplate(tpl)}
                          >
                            {t("common.delete")}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 p-3 space-y-3">
        <div className="text-xs font-medium">{t("setup.templatesSaveCurrent")}</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] flex-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("setup.name")}
            </Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("setup.templatesNamePlaceholder")}
              className="mt-1"
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("setup.templatesLabelOptional")}
            </Label>
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={t("setup.templatesLabelPlaceholder")}
              className="mt-1"
            />
          </div>
          <Button onClick={() => void saveCurrentAsTemplate()}>{t("setup.templatesSaveAs")}</Button>
        </div>
      </div>
    </section>
  );
}
