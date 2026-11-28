"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import type { AppSettings } from "@/lib/types";
import { CLUB_BRAND } from "@/lib/club-brand";
import { KickoffCountdownSettingsBlock, StadiumScreenPicker } from "./setup-display-extras";

export function SetupDisplayCanvasSection({
  settings,
  reloadSettings,
  sport,
}: {
  settings: AppSettings | null;
  reloadSettings: () => void;
  /** Sport van de actieve wedstrijd, voor het juiste woord (aftrap, start). */
  sport?: string | null;
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

      <StadiumScreenPicker />

      <div className="border-t border-border pt-4">
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

      {CLUB_BRAND?.stadiumStyle ? <ClubStadiumStyleSetting /> : null}

      <DisplayVideoCopySetting />

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

      <div className="border-t border-border pt-4">
        <KickoffCountdownSettingsBlock sport={sport} />
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

type DisplayCopyStatus = {
  height: number | null;
  ready: number;
  total: number;
  busy: boolean;
  waitingForMatch: boolean;
};

/**
 * Video's op het stadionscherm als 720p-kopie (lib/display-copy.ts), voor een HD-ledscherm. De livestream
 * en de rapporten gebruiken altijd het origineel.
 */
function DisplayVideoCopySetting() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<DisplayCopyStatus | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      fetch("/api/display-copies")
        .then((r) => (r.ok ? r.json() : null))
        .then((next: DisplayCopyStatus | null) => {
          if (cancelled || !next) return;
          setStatus(next);
          // Zolang er kopieën gemaakt worden, de teller bijwerken.
          if (next.height != null && (next.busy || next.ready < next.total)) timer = setTimeout(load, 4000);
        })
        .catch(() => undefined);
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [status?.height]);

  async function choose(height: number | null) {
    setSaving(true);
    try {
      const res = await fetch("/api/display-copies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ height }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((await res.json()) as DisplayCopyStatus);
    } catch (err) {
      toast({
        title: t("setup.videoCopySaveFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  const height = status?.height ?? null;
  return (
    <div className="border-t border-border pt-4">
      <Label className="text-xs">{t("setup.videoCopyTitle")}</Label>
      <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{t("setup.videoCopyHelp")}</p>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ScalingOption
          active={height == null}
          title={t("setup.videoCopyOriginal")}
          desc={t("setup.videoCopyOriginalDesc")}
          onClick={() => !saving && height != null && void choose(null)}
        />
        <ScalingOption
          active={height === 720}
          title={t("setup.videoCopy720")}
          desc={t("setup.videoCopy720Desc")}
          onClick={() => !saving && height !== 720 && void choose(720)}
        />
      </div>
      {height != null && status ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("setup.videoCopyProgress", { ready: status.ready, total: status.total })}
          {status.waitingForMatch
            ? ` · ${t("setup.videoCopyWaitingForMatch")}`
            : status.busy
              ? ` · ${t("setup.videoCopyBusy")}`
              : ""}
          {" · "}
          {t("setup.videoCopyApplies")}
        </p>
      ) : null}
    </div>
  );
}

/** Clubstijl op het stadionscherm aan of uit (alleen in een clubbuild, zoals RAFC). */
function ClubStadiumStyleSetting() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/club-style")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { enabled?: boolean } | null) => setEnabled(s ? s.enabled !== false : true))
      .catch(() => setEnabled(true));
  }, []);
  async function choose(next: boolean) {
    setEnabled(next);
    try {
      const res = await fetch("/api/club-style", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setEnabled(!next);
      toast({ title: t("setup.clubStyleSaveFailed"), description: err instanceof Error ? err.message : String(err), variant: "error" });
    }
  }
  return (
    <div className="border-t border-border pt-4">
      <Label className="text-xs">{t("setup.clubStyleTitle")}</Label>
      <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{t("setup.clubStyleHelp")}</p>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ScalingOption
          active={enabled !== false}
          title={t("setup.clubStyleOn")}
          desc={t("setup.clubStyleOnDesc")}
          onClick={() => enabled === false && void choose(true)}
        />
        <ScalingOption
          active={enabled === false}
          title={t("setup.clubStyleOff")}
          desc={t("setup.clubStyleOffDesc")}
          onClick={() => enabled !== false && void choose(false)}
        />
      </div>
    </div>
  );
}
