"use client";

import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { TFunction } from "i18next";
import { Input } from "@/components/ui/input";
import { cropFromHandle, r2, resizeRect, snapEdge, type LayerHandle } from "@/lib/stream-layer-drag";
import {
  STREAM_LAYER_FITS,
  type StreamScene,
  type StreamSceneLayer,
} from "@/lib/stream-scenes";

export type StreamLayerPatch = Partial<Omit<StreamSceneLayer, "id" | "inputId">>;


const HANDLES: { id: Exclude<LayerHandle, "move">; style: React.CSSProperties; cursor: string }[] = [
  { id: "nw", style: { left: 0, top: 0 }, cursor: "nwse-resize" },
  { id: "n", style: { left: "50%", top: 0 }, cursor: "ns-resize" },
  { id: "ne", style: { left: "100%", top: 0 }, cursor: "nesw-resize" },
  { id: "e", style: { left: "100%", top: "50%" }, cursor: "ew-resize" },
  { id: "se", style: { left: "100%", top: "100%" }, cursor: "nwse-resize" },
  { id: "s", style: { left: "50%", top: "100%" }, cursor: "ns-resize" },
  { id: "sw", style: { left: 0, top: "100%" }, cursor: "nesw-resize" },
  { id: "w", style: { left: 0, top: "50%" }, cursor: "ew-resize" },
];

/**
 * Het rode kader over een monitor, zoals in OBS: slepen verplaatst, een hoek vergroot met dezelfde
 * verhouding (Shift: vrij), een rand rekt één kant op, Alt + rand snijdt bij. Pijltjes schuiven het
 * kader (Shift: grotere stap). Klikken buiten het kader gaan door naar wat eronder ligt.
 */
export function StreamLayerEditor({
  layer,
  live,
  onChange,
  others = [],
  onSelect,
}: {
  layer: StreamSceneLayer;
  /** Deze monitor is wat er nu de stream in gaat. */
  live: boolean;
  onChange: (patch: StreamLayerPatch, commit: boolean) => void;
  /** De andere lagen van de scène: een stippellijn, aanklikken om die te bewerken. */
  others?: StreamSceneLayer[];
  onSelect?: (layerId: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  const begin = (event: ReactPointerEvent<HTMLElement>, handle: LayerHandle) => {
    if (event.button !== 0) return;
    const root = rootRef.current;
    if (!root) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = root.getBoundingClientRect();
    const cw = Math.max(1, bounds.width);
    const ch = Math.max(1, bounds.height);
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = { ...layer.rect };
    const startCrop = { ...layer.crop };
    const cropping = handle !== "move" && event.altKey;
    let last: StreamLayerPatch | null = null;

    const compute = (e: PointerEvent): StreamLayerPatch => {
      const dx = ((e.clientX - startX) / cw) * 100;
      const dy = ((e.clientY - startY) / ch) * 100;
      if (handle === "move") {
        return {
          rect: {
            ...startRect,
            x: r2(snapEdge(startRect.x + dx, startRect.w, !e.ctrlKey)),
            y: r2(snapEdge(startRect.y + dy, startRect.h, !e.ctrlKey)),
          },
        };
      }
      if (cropping) return cropFromHandle(startRect, startCrop, handle, dx, dy);
      return { rect: resizeRect(startRect, handle, dx, dy, e.shiftKey) };
    };
    const onMove = (e: PointerEvent) => {
      last = compute(e);
      onChange(last, false);
    };
    const finish = (e: PointerEvent) => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      const moved = e.clientX !== startX || e.clientY !== startY;
      if (moved) onChange(last ?? compute(e), true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    cleanupRef.current?.();
    cleanupRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 5 : 0.5;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    onChange({ rect: { ...layer.rect, x: r2(layer.rect.x + dx), y: r2(layer.rect.y + dy) } }, true);
  };

  const color = live ? "border-red-500" : "border-amber-400";
  const handleColor = live ? "bg-red-500" : "bg-amber-400";
  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-0 z-40"
      data-stream-layer-editor
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {others.map((other) => (
        <div
          key={other.id}
          className="pointer-events-auto absolute cursor-pointer border border-dashed border-white/60 hover:border-white"
          style={{
            left: `${other.rect.x}%`,
            top: `${other.rect.y}%`,
            width: `${other.rect.w}%`,
            height: `${other.rect.h}%`,
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            onSelect?.(other.id);
          }}
        />
      ))}
      <div
        role="application"
        tabIndex={0}
        className={`pointer-events-auto absolute cursor-move touch-none border-2 outline-none ${color} focus-visible:ring-2 focus-visible:ring-white/60`}
        style={{
          left: `${layer.rect.x}%`,
          top: `${layer.rect.y}%`,
          width: `${layer.rect.w}%`,
          height: `${layer.rect.h}%`,
        }}
        onPointerDown={(event) => begin(event, "move")}
        onKeyDown={onKeyDown}
      >
        {HANDLES.map((handle) => (
          <div
            key={handle.id}
            className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 touch-none rounded-[1px] ${handleColor} ring-1 ring-black/60`}
            style={{ ...handle.style, cursor: handle.cursor }}
            onPointerDown={(event) => begin(event, handle.id)}
          />
        ))}
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number, commit: boolean) => void;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-0.5 text-[10px] ${disabled ? "opacity-40" : ""}`}>
      <span className="flex justify-between text-muted-foreground">
        <span className="truncate">{label}</span>
        <span className="tabular-nums">{value}%</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        className="h-3 w-full accent-primary"
        onChange={(e) => onChange(Number(e.target.value), false)}
        onPointerUp={(e) => onChange(Number((e.target as HTMLInputElement).value), true)}
        onKeyUp={(e) => onChange(Number((e.target as HTMLInputElement).value), true)}
      />
    </label>
  );
}

/** Instellingen van de laag die je bewerkt: passen, bijsnijden, kleur, volgorde en reset. */
export function StreamLayerPanel({
  scene,
  layer,
  sceneLabel,
  sourceLabel,
  colorSupported,
  live,
  t,
  onLayerChange,
  onSceneName,
  onSelectLayer,
  onMoveLayer,
  onReset,
  onClose,
  addableSources,
  addHint,
  onAddLayer,
  onRemoveLayer,
}: {
  scene: StreamScene;
  layer: StreamSceneLayer;
  sceneLabel: string;
  sourceLabel: (layer: StreamSceneLayer) => string;
  colorSupported: boolean;
  live: boolean;
  t: TFunction;
  onLayerChange: (patch: StreamLayerPatch, commit: boolean) => void;
  onSceneName: (name: string) => void;
  onSelectLayer: (layerId: string) => void;
  onMoveLayer: (layerId: string, delta: 1 | -1) => void;
  onReset: () => void;
  onClose: () => void;
  /** Bronnen die als beeld-in-beeld bovenop kunnen. */
  addableSources: { id: string; label: string }[];
  /** Waarom er (nu) niets bij kan, of leeg. */
  addHint?: string;
  onAddLayer: (inputId: string) => void;
  onRemoveLayer: (layerId: string) => void;
}) {
  const cropSides = ["top", "right", "bottom", "left"] as const;
  return (
    <div
      className={`flex shrink-0 flex-col gap-1.5 rounded-md border bg-zinc-950/70 p-2 ${
        live ? "border-red-600/70" : "border-amber-500/50"
      }`}
      data-stream-layer-panel
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold">{t("livestream.sceneEditTitle", { name: sceneLabel })}</span>
        {live ? (
          <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {t("livestream.sceneEditLive")}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">{t("livestream.sceneEditHint")}</span>
        <button
          type="button"
          onClick={onReset}
          className="h-6 rounded bg-zinc-800 px-2 text-[11px] text-zinc-200 hover:bg-zinc-700"
        >
          {t("livestream.layerReset")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-6 rounded bg-primary px-2 text-[11px] font-semibold text-primary-foreground"
        >
          {t("livestream.sceneEditDone")}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(9rem,12rem)_minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
            {t("livestream.sceneName")}
            <Input
              className="h-7 px-1.5 text-[11px]"
              defaultValue={scene.name}
              key={scene.id}
              placeholder={sourceLabel(layer)}
              maxLength={40}
              onBlur={(e) => {
                if (e.target.value.trim() !== scene.name) onSceneName(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
          <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
            {t("livestream.layerFit")}
            <div className="grid grid-cols-3 gap-0.5" role="group" aria-label={t("livestream.layerFit")}>
              {STREAM_LAYER_FITS.map((fit) => (
                <button
                  key={fit}
                  type="button"
                  aria-pressed={layer.fit === fit}
                  onClick={() => onLayerChange({ fit }, true)}
                  className={`h-6 truncate rounded px-1 text-[10px] font-semibold ${
                    layer.fit === fit ? "bg-primary text-primary-foreground" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  {t(`livestream.layerFit_${fit}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
          {t("livestream.layerCrop")}
          <div className="grid grid-cols-2 gap-1">
            {cropSides.map((side) => (
              <label key={side} className="flex items-center gap-1">
                <span className="w-12 truncate">{t(`livestream.layerCrop_${side}`)}</span>
                <Input
                  type="number"
                  min={0}
                  max={95}
                  step={1}
                  className="h-6 px-1 text-[11px] tabular-nums"
                  value={Math.round(layer.crop[side])}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (!Number.isFinite(value)) return;
                    onLayerChange({ crop: { ...layer.crop, [side]: value } }, true);
                  }}
                />
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            <Slider
              label={t("livestream.layerOpacity")}
              value={layer.opacity}
              min={0}
              max={100}
              disabled={!colorSupported}
              onChange={(opacity, commit) => onLayerChange({ opacity }, commit)}
            />
            <Slider
              label={t("livestream.layerBrightness")}
              value={layer.brightness}
              min={0}
              max={200}
              disabled={!colorSupported}
              onChange={(brightness, commit) => onLayerChange({ brightness }, commit)}
            />
            <Slider
              label={t("livestream.layerContrast")}
              value={layer.contrast}
              min={0}
              max={200}
              disabled={!colorSupported}
              onChange={(contrast, commit) => onLayerChange({ contrast }, commit)}
            />
            <Slider
              label={t("livestream.layerSaturation")}
              value={layer.saturation}
              min={0}
              max={200}
              disabled={!colorSupported}
              onChange={(saturation, commit) => onLayerChange({ saturation }, commit)}
            />
          </div>
          {!colorSupported ? (
            <p className="text-[10px] leading-snug text-muted-foreground">{t("livestream.layerColorUnsupported")}</p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-0.5 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <span>{t("livestream.layers")}</span>
          {addableSources.length > 0 ? (
            <select
              aria-label={t("livestream.layerAdd")}
              className="h-6 rounded border border-border bg-background px-1 text-[11px] text-foreground"
              value=""
              onChange={(e) => {
                if (e.target.value) onAddLayer(e.target.value);
              }}
            >
              <option value="">{t("livestream.layerAdd")}</option>
              {addableSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
            </select>
          ) : null}
          {addHint ? <span className="min-w-0 flex-1 truncate">{addHint}</span> : null}
        </div>
        {scene.layers.length > 1 ? (
          <>
          {/* Bovenste laag eerst, zoals in de scorebord-editor; opgeslagen staat de onderste eerst. */}
          {[...scene.layers].reverse().map((item, index, list) => (
            <div
              key={item.id}
              className={`flex items-center gap-1 rounded px-1 py-0.5 ${
                item.id === layer.id ? "bg-zinc-800 text-foreground" : ""
              }`}
            >
              <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => onSelectLayer(item.id)}>
                {sourceLabel(item)}
              </button>
              <button
                type="button"
                aria-label={t("livestream.layerUp")}
                title={t("livestream.layerUp")}
                disabled={index === 0}
                onClick={() => onMoveLayer(item.id, 1)}
                className="h-5 w-5 rounded bg-zinc-800 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={t("livestream.layerDown")}
                title={t("livestream.layerDown")}
                disabled={index === list.length - 1}
                onClick={() => onMoveLayer(item.id, -1)}
                className="h-5 w-5 rounded bg-zinc-800 disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={t("livestream.layerRemove")}
                title={t("livestream.layerRemove")}
                onClick={() => onRemoveLayer(item.id)}
                className="h-5 w-5 rounded bg-zinc-800 hover:bg-red-700 hover:text-white"
              >
                ×
              </button>
            </div>
          ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
