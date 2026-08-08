"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import type { AppSettings } from "@/lib/types";

export function SetupDisplayCanvasSection({
  settings,
  reloadSettings,
}: {
  settings: AppSettings | null;
  reloadSettings: () => void;
}) {
  const { t } = useTranslation();
  const [width, setWidth] = useState<string>("1920");
  const [height, setHeight] = useState<string>("1080");
  const [mode, setMode] = useState<"cover" | "contain" | "exact">("cover");
  const [safeZoneVisible, setSafeZoneVisible] = useState(false);
  const [safeZoneMarginPx, setSafeZoneMarginPx] = useState<string>("40");
  const [saving, setSaving] = useState(false);

  const presets = useMemo(
    () => [
      { label: t("setup.canvasPresetFhd"), width: 1920, height: 1080 },
      { label: t("setup.canvasPreset4k"), width: 3840, height: 2160 },
      { label: t("setup.canvasPresetHd"), width: 1280, height: 720 },
      {
        label: t("setup.canvasPresetWide"),
        width: 1920,
        height: 360,
        hint: t("setup.canvasPresetWideHint"),
      },
      {
        label: t("setup.canvasPresetCube"),
        width: 1024,
        height: 1024,
        hint: t("setup.canvasPresetCubeHint"),
      },
      {
        label: t("setup.canvasPresetStadium"),
        width: 2304,
        height: 1296,
        hint: t("setup.canvasPresetStadiumHint"),
      },
    ],
    [t],
  );

  useEffect(() => {
    if (!settings) return;
    setWidth(String(settings.displayCanvasWidth ?? 1920));
    setHeight(String(settings.displayCanvasHeight ?? 1080));
    setMode((settings.displayScalingMode ?? "cover") as "cover" | "contain" | "exact");
    setSafeZoneVisible(!!settings.displaySafeZoneVisible);
    setSafeZoneMarginPx(String(settings.displaySafeZoneMarginPx ?? 40));
  }, [settings]);

  async function patch(payload: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      reloadSettings();
    } catch (err) {
      toast({
        title: t("setup.canvasSaveFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function applyDimensions() {
    const w = Number(width);
    const h = Number(height);
    if (!Number.isFinite(w) || w < 320 || !Number.isFinite(h) || h < 240) {
      toast({
        title: t("setup.canvasInvalidDims"),
        description: t("setup.canvasInvalidDimsDesc"),
        variant: "error",
      });
      return;
    }
    await patch({
      displayCanvasWidth: Math.round(w),
      displayCanvasHeight: Math.round(h),
    });
  }

  async function applyMode(next: "cover" | "contain" | "exact") {
    setMode(next);
    await patch({ displayScalingMode: next });
  }

  async function applySafeZone(next: { visible?: boolean; marginPx?: number }) {
    const payload: Record<string, unknown> = {};
    if (typeof next.visible === "boolean") {
      setSafeZoneVisible(next.visible);
      payload.displaySafeZoneVisible = next.visible;
    }
    if (typeof next.marginPx === "number") {
      setSafeZoneMarginPx(String(next.marginPx));
      payload.displaySafeZoneMarginPx = next.marginPx;
    }
    if (Object.keys(payload).length > 0) await patch(payload);
  }

  const aspect = (() => {
    const w = Number(width);
    const h = Number(height);
    if (!w || !h) return "—";
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const g = gcd(w, h);
    return `${w / g}:${h / g}`;
  })();

  return (
    <section className="bg-card border border-border rounded-xl p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("setup.canvasTitle")}</h2>
        <p className="text-xs text-muted-foreground leading-snug mt-1">
          {t("setup.canvasBody")}
        </p>
      </div>

      <div>
        <Label className="text-xs">{t("setup.canvasPresets")}</Label>
        <div className="mt-1 flex flex-wrap gap-2">
          {presets.map((p) => (
            <Button
              key={p.label}
              size="sm"
              variant="outline"
              type="button"
              onClick={() => {
                setWidth(String(p.width));
                setHeight(String(p.height));
              }}
              title={p.hint}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label>{t("setup.canvasWidth")}</Label>
          <Input
            type="number"
            min={320}
            value={width}
            onChange={(e) => setWidth(e.target.value)}
          />
        </div>
        <div>
          <Label>{t("setup.canvasHeight")}</Label>
          <Input
            type="number"
            min={240}
            value={height}
            onChange={(e) => setHeight(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <div className="text-xs text-muted-foreground">
            {t("setup.canvasAspect")}{" "}
            <span className="font-mono text-foreground">{aspect}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void applyDimensions()} disabled={saving}>
          {t("setup.canvasApplyDims")}
        </Button>
      </div>

      <div className="border-t border-border pt-4">
        <Label className="text-xs">{t("setup.canvasScaling")}</Label>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <ScalingOption
            active={mode === "cover"}
            title={t("setup.canvasCover")}
            desc={t("setup.canvasCoverDesc")}
            onClick={() => void applyMode("cover")}
          />
          <ScalingOption
            active={mode === "contain"}
            title={t("setup.canvasContain")}
            desc={t("setup.canvasContainDesc")}
            onClick={() => void applyMode("contain")}
          />
          <ScalingOption
            active={mode === "exact"}
            title={t("setup.canvasExact")}
            desc={t("setup.canvasExactDesc")}
            onClick={() => void applyMode("exact")}
          />
        </div>
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">{t("setup.canvasSafeZone")}</div>
            <p className="text-[11px] text-muted-foreground">
              {t("setup.canvasSafeZoneHelp")}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={safeZoneVisible}
              onChange={(e) => void applySafeZone({ visible: e.target.checked })}
            />
            <span>{t("common.on")}</span>
          </label>
        </div>
        {safeZoneVisible && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>{t("setup.canvasMargin")}</Label>
              <Input
                type="number"
                min={0}
                value={safeZoneMarginPx}
                onChange={(e) => setSafeZoneMarginPx(e.target.value)}
                onBlur={() => {
                  const n = Number(safeZoneMarginPx);
                  if (Number.isFinite(n) && n >= 0) {
                    void applySafeZone({ marginPx: Math.round(n) });
                  }
                }}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ScalingOption({
  active,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-md border p-3 transition-colors ${
        active
          ? "border-primary bg-primary/10"
          : "border-input hover:bg-secondary/60"
      }`}
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="text-[11px] text-muted-foreground mt-1 leading-snug">
        {desc}
      </div>
    </button>
  );
}
