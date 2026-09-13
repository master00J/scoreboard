"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Select } from "@/components/ui/form";
import {
  BUILTIN_WIDGET_DESIGNS,
  pctFromAnchor,
  type StreamScoreWidgetAnchor,
  type StreamScoreWidgetDesign,
  type StreamScoreWidgetNameMode,
  type StreamScoreWidgetSettings,
  type StreamScoreWidgetShape,
  type StreamScoreWidgetStyle,
} from "@/lib/stream-score-widget";

const COLOR_THEMES: { id: string; labelKey: string; patch: Partial<StreamScoreWidgetSettings> }[] = [
  {
    id: "dark",
    labelKey: "livestream.widgetThemeDark",
    patch: {
      bgColor: "#0b1220",
      textColor: "#f8fafc",
      scoreColor: "#ffffff",
      timerColor: "#e2e8f0",
      accentColor: "#38bdf8",
      borderColor: "#ffffff",
    },
  },
  {
    id: "light",
    labelKey: "livestream.widgetThemeLight",
    patch: {
      bgColor: "#f8fafc",
      textColor: "#0f172a",
      scoreColor: "#0f172a",
      timerColor: "#334155",
      accentColor: "#0284c7",
      borderColor: "#0f172a",
    },
  },
  {
    id: "night",
    labelKey: "livestream.widgetThemeNight",
    patch: {
      bgColor: "#020617",
      textColor: "#e2e8f0",
      scoreColor: "#f8fafc",
      timerColor: "#94a3b8",
      accentColor: "#22c55e",
      borderColor: "#22c55e",
    },
  },
  {
    id: "gold",
    labelKey: "livestream.widgetThemeGold",
    patch: {
      bgColor: "#1c1408",
      textColor: "#fff7ed",
      scoreColor: "#fbbf24",
      timerColor: "#fde68a",
      accentColor: "#f59e0b",
      borderColor: "#f59e0b",
    },
  },
];

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-xs">
      <span>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-10 cursor-pointer" />
    </label>
  );
}

export function StreamScoreWidgetEditor({
  widget,
  designs,
  onChange,
  onDesignsChange,
  t,
}: {
  widget: StreamScoreWidgetSettings;
  designs: StreamScoreWidgetDesign[];
  onChange: (partial: Partial<StreamScoreWidgetSettings>) => void;
  onDesignsChange: (designs: StreamScoreWidgetDesign[]) => void;
  t: (key: string) => string;
}) {
  const [designName, setDesignName] = useState("");

  const applyLook = (patch: Partial<StreamScoreWidgetSettings>) => {
    const look = { ...patch };
    delete look.xPct;
    delete look.yPct;
    onChange(look);
  };

  const saveDesign = () => {
    const name = designName.trim().slice(0, 40);
    if (!name) return;
    onDesignsChange([...designs, { id: `design-${Date.now()}`, name, widget }]);
    setDesignName("");
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-secondary/20 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("livestream.widgetTitle")}
      </div>
      <p className="text-[11px] text-sky-300/90 leading-snug">{t("livestream.widgetDragHint")}</p>

      <Label htmlFor="sw-style">{t("livestream.widgetStyle")}</Label>
      <Select
        id="sw-style"
        value={widget.style}
        onChange={(e) => {
          const style = e.target.value as StreamScoreWidgetStyle;
          const found = BUILTIN_WIDGET_DESIGNS.find((item) => item.patch.style === style);
          onChange(found?.patch ?? { style });
        }}
      >
        {BUILTIN_WIDGET_DESIGNS.map((item) => (
          <option key={item.id} value={item.patch.style}>
            {t(item.nameKey)}
          </option>
        ))}
      </Select>

      <Label htmlFor="sw-shape">{t("livestream.widgetShape")}</Label>
      <Select
        id="sw-shape"
        value={widget.shape}
        onChange={(e) => onChange({ shape: e.target.value as StreamScoreWidgetShape })}
      >
        <option value="rounded">{t("livestream.widgetShapeRounded")}</option>
        <option value="sharp">{t("livestream.widgetShapeSharp")}</option>
        <option value="pill">{t("livestream.widgetShapePill")}</option>
        <option value="cut">{t("livestream.widgetShapeCut")}</option>
      </Select>

      <div className="grid grid-cols-3 gap-1">
        {(
          [
            ["top-left", "↖"],
            ["top-center", "↑"],
            ["top-right", "↗"],
            ["bottom-left", "↙"],
            ["bottom-center", "↓"],
            ["bottom-right", "↘"],
          ] as const
        ).map(([anchor, label]) => (
          <button
            key={anchor}
            type="button"
            className="rounded border border-border/70 px-1 py-1 text-[11px] hover:bg-secondary"
            onClick={() => onChange({ anchor, ...pctFromAnchor(anchor as StreamScoreWidgetAnchor) })}
          >
            {label}
          </button>
        ))}
      </div>

      <Label htmlFor="sw-scale">
        {t("livestream.widgetScale")} ({Math.round(widget.scale * 100)}%)
      </Label>
      <input
        id="sw-scale"
        type="range"
        min={50}
        max={250}
        value={Math.round(widget.scale * 100)}
        onChange={(e) => onChange({ scale: Number(e.target.value) / 100 })}
      />

      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={widget.showLogos} onChange={(e) => onChange({ showLogos: e.target.checked })} />
          {t("livestream.widgetShowLogos")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={widget.showNames} onChange={(e) => onChange({ showNames: e.target.checked })} />
          {t("livestream.widgetShowNames")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={widget.showTimer} onChange={(e) => onChange({ showTimer: e.target.checked })} />
          {t("livestream.widgetShowTimer")}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={widget.showPeriod}
            onChange={(e) => onChange({ showPeriod: e.target.checked })}
          />
          {t("livestream.widgetShowPeriod")}
        </label>
      </div>

      {widget.showNames ? (
        <>
          <Label htmlFor="sw-names">{t("livestream.widgetNameMode")}</Label>
          <Select
            id="sw-names"
            value={widget.nameMode}
            onChange={(e) => onChange({ nameMode: e.target.value as StreamScoreWidgetNameMode })}
          >
            <option value="short">{t("livestream.widgetNameShort")}</option>
            <option value="abbr">{t("livestream.widgetNameAbbr")}</option>
            <option value="full">{t("livestream.widgetNameFull")}</option>
          </Select>
        </>
      ) : null}

      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("livestream.widgetColors")}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {COLOR_THEMES.map((theme) => (
          <button
            key={theme.id}
            type="button"
            className="rounded border border-border/70 px-2 py-1 text-[11px] hover:bg-secondary"
            onClick={() => onChange(theme.patch)}
          >
            {t(theme.labelKey)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <ColorField label={t("livestream.widgetBg")} value={widget.bgColor} onChange={(bgColor) => onChange({ bgColor })} />
        <ColorField label={t("livestream.widgetText")} value={widget.textColor} onChange={(textColor) => onChange({ textColor })} />
        <ColorField
          label={t("livestream.widgetScoreColor")}
          value={widget.scoreColor}
          onChange={(scoreColor) => onChange({ scoreColor })}
        />
        <ColorField
          label={t("livestream.widgetTimerColor")}
          value={widget.timerColor}
          onChange={(timerColor) => onChange({ timerColor })}
        />
        <ColorField
          label={t("livestream.widgetAccent")}
          value={widget.accentColor}
          onChange={(accentColor) => onChange({ accentColor })}
        />
        <ColorField
          label={t("livestream.widgetBorder")}
          value={widget.borderColor}
          onChange={(borderColor) => onChange({ borderColor })}
        />
      </div>
      <Label htmlFor="sw-opacity">
        {t("livestream.widgetOpacity")} ({widget.bgOpacity}%)
      </Label>
      <input
        id="sw-opacity"
        type="range"
        min={20}
        max={100}
        value={widget.bgOpacity}
        onChange={(e) => onChange({ bgOpacity: Number(e.target.value) })}
      />
      <Label htmlFor="sw-border">
        {t("livestream.widgetBorderWidth")} ({widget.borderWidth}px)
      </Label>
      <input
        id="sw-border"
        type="range"
        min={0}
        max={6}
        value={widget.borderWidth}
        onChange={(e) => onChange({ borderWidth: Number(e.target.value) })}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={widget.useTeamColors}
          onChange={(e) => onChange({ useTeamColors: e.target.checked })}
        />
        {t("livestream.widgetTeamColors")}
      </label>

      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("livestream.widgetOwnDesigns")}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">{t("livestream.widgetOwnDesignsHelp")}</p>
      <div className="flex gap-2">
        <Input
          value={designName}
          placeholder={t("livestream.widgetDesignName")}
          onChange={(e) => setDesignName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveDesign();
          }}
        />
        <Button type="button" variant="secondary" disabled={!designName.trim()} onClick={saveDesign}>
          {t("livestream.widgetSaveDesign")}
        </Button>
      </div>
      {designs.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {designs.map((design) => (
            <li key={design.id} className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1">
              <span className="truncate text-xs">{design.name}</span>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => applyLook(design.widget)}>
                  {t("livestream.widgetApplyDesign")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => onDesignsChange(designs.filter((item) => item.id !== design.id))}
                >
                  {t("livestream.widgetDeleteDesign")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground">{t("livestream.widgetNoDesigns")}</p>
      )}
    </div>
  );
}
