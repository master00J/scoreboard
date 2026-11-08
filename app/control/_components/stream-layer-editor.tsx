"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { TFunction } from "i18next";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  cropFromHandle,
  pixelsToRect,
  r2,
  rectToPixels,
  resizeRect,
  snapEdge,
  type LayerHandle,
} from "@/lib/stream-layer-drag";
import {
  STREAM_LAYER_FITS,
  STREAM_LAYER_ORDERS,
  canOrderSceneLayer,
  sceneSourcesTopFirst,
  transformSceneLayer,
  type StreamLayerOrder,
  type StreamLayerTransform,
  type StreamScene,
  type StreamSceneLayer,
} from "@/lib/stream-scenes";

export type StreamLayerPatch = Partial<Omit<StreamSceneLayer, "id" | "inputId">>;

/** Ctrl+Home / Ctrl+End, zoals in OBS: helemaal naar voorgrond of achtergrond. */
function orderFromKey(event: KeyboardEvent<HTMLElement>): StreamLayerOrder | null {
  if (!(event.ctrlKey || event.metaKey)) return null;
  return event.key === "Home" ? "front" : event.key === "End" ? "back" : null;
}


/** Grepen iets naar binnen, anders knipt overflow van de monitor de hoeken af. */
const HANDLE_INSET = 8;
const HANDLES: { id: Exclude<LayerHandle, "move">; style: CSSProperties; hit: string; cursor: string }[] = [
  { id: "nw", style: { left: HANDLE_INSET, top: HANDLE_INSET }, hit: "h-5 w-5", cursor: "nwse-resize" },
  { id: "n", style: { left: "50%", top: HANDLE_INSET }, hit: "h-5 w-16", cursor: "ns-resize" },
  { id: "ne", style: { left: `calc(100% - ${HANDLE_INSET}px)`, top: HANDLE_INSET }, hit: "h-5 w-5", cursor: "nesw-resize" },
  { id: "e", style: { left: `calc(100% - ${HANDLE_INSET}px)`, top: "50%" }, hit: "h-16 w-5", cursor: "ew-resize" },
  { id: "se", style: { left: `calc(100% - ${HANDLE_INSET}px)`, top: `calc(100% - ${HANDLE_INSET}px)` }, hit: "h-5 w-5", cursor: "nwse-resize" },
  { id: "s", style: { left: "50%", top: `calc(100% - ${HANDLE_INSET}px)` }, hit: "h-5 w-16", cursor: "ns-resize" },
  { id: "sw", style: { left: HANDLE_INSET, top: `calc(100% - ${HANDLE_INSET}px)` }, hit: "h-5 w-5", cursor: "nesw-resize" },
  { id: "w", style: { left: HANDLE_INSET, top: "50%" }, hit: "h-16 w-5", cursor: "ew-resize" },
];

/**
 * Het rode kader over een monitor, zoals in OBS: slepen verplaatst, een hoek vergroot vrij
 * (Shift: verhouding blijft), een rand rekt één kant op, Alt + rand snijdt bij. Pijltjes schuiven het
 * kader (Shift: grotere stap). Klikken buiten het kader gaan door naar wat eronder ligt.
 */
export function StreamLayerEditor({
  layer,
  live,
  canvas,
  t,
  onChange,
  others = [],
  onSelect,
  onRemove,
  canOrder,
  onOrder,
}: {
  layer: StreamSceneLayer;
  /** Deze monitor is wat er nu de stream in gaat. */
  live: boolean;
  /** Uitvoergrootte van de stream, zodat de labels echte pixels zijn. */
  canvas: { width: number; height: number };
  t: TFunction;
  onChange: (patch: StreamLayerPatch, commit: boolean) => void;
  /** De andere lagen van de scène: een stippellijn, aanklikken om die te bewerken. */
  others?: StreamSceneLayer[];
  onSelect?: (layerId: string) => void;
  onRemove?: () => void;
  /** Volgorde van de geselecteerde laag: naar voorgrond, naar voren, … (rechtsklikmenu). */
  canOrder?: (order: StreamLayerOrder) => boolean;
  onOrder?: (order: StreamLayerOrder) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [cropMode, setCropMode] = useState(false);
  useEffect(() => () => cleanupRef.current?.(), []);

  const begin = (event: ReactPointerEvent<HTMLElement>, handle: LayerHandle) => {
    if (event.button !== 0 || layer.locked) return;
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
    const cropping = handle !== "move" && (cropMode || event.altKey);
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
      // Zoals in OBS: zonder Shift vervormt een hoek, met Shift blijft de verhouding gelijk.
      return { rect: resizeRect(startRect, handle, dx, dy, !e.shiftKey) };
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

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const applyTransform = (action: StreamLayerTransform) => {
    if (layer.locked) return;
    onChange(transformSceneLayer(layer, action), true);
    setMenu(null);
  };

  const pickOrder = (order: StreamLayerOrder) => {
    // Ook een vastgezette laag mag van plaats wisselen, zoals in OBS: het slot houdt alleen het kader vast.
    if (canOrder?.(order)) onOrder?.(order);
    setMenu(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onRemove?.();
      return;
    }
    const order = orderFromKey(event);
    if (order) {
      event.preventDefault();
      pickOrder(order);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      const action =
        key === "f" ? "fit" : key === "s" ? "stretch" : key === "d" ? "center" : key === "r" ? "reset" : null;
      if (action) {
        event.preventDefault();
        applyTransform(action);
        return;
      }
    }
    const stepPx = event.shiftKey ? 10 : 1;
    const dx = event.key === "ArrowLeft" ? -stepPx : event.key === "ArrowRight" ? stepPx : 0;
    const dy = event.key === "ArrowUp" ? -stepPx : event.key === "ArrowDown" ? stepPx : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    const px = rectToPixels(layer.rect, canvas.width, canvas.height);
    onChange({ rect: pixelsToRect({ ...px, x: px.x + dx, y: px.y + dy }, canvas.width, canvas.height) }, true);
  };

  const color = cropMode ? "border-sky-400" : live ? "border-red-500" : "border-amber-400";
  const handleColor = cropMode ? "bg-sky-400" : live ? "bg-red-500" : "bg-amber-400";
  const labelColor = cropMode ? "text-sky-300" : live ? "text-red-400" : "text-amber-300";
  const px = rectToPixels(layer.rect, canvas.width, canvas.height);
  const setPx = (next: Partial<typeof px>, commit: boolean) => {
    onChange(
      { rect: pixelsToRect({ x: px.x, y: px.y, w: px.w, h: px.h, ...next }, canvas.width, canvas.height) },
      commit,
    );
  };
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
          onContextMenu={(event) => {
            // Zoals in OBS: rechtsklik kiest de bron en opent meteen zijn menu.
            event.preventDefault();
            event.stopPropagation();
            onSelect?.(other.id);
            setMenu({ x: event.clientX, y: event.clientY });
          }}
        />
      ))}
      <PxGuide
        className={`${labelColor} top-0`}
        style={{ left: `${layer.rect.x}%`, width: `${layer.rect.w}%`, height: `${layer.rect.y}%` }}
        value={px.top}
      />
      <PxGuide
        className={`${labelColor} bottom-0`}
        style={{ left: `${layer.rect.x}%`, width: `${layer.rect.w}%`, height: `${100 - layer.rect.y - layer.rect.h}%` }}
        value={px.bottom}
      />
      <PxGuide
        className={labelColor}
        style={{ top: `${layer.rect.y}%`, width: `${layer.rect.x}%`, height: `${layer.rect.h}%` }}
        value={px.left}
      />
      <PxGuide
        className={`${labelColor} right-0`}
        style={{ top: `${layer.rect.y}%`, width: `${100 - layer.rect.x - layer.rect.w}%`, height: `${layer.rect.h}%` }}
        value={px.right}
      />
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
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        {HANDLES.map((handle) => (
          <div
            key={handle.id}
            className={`absolute z-10 flex -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center ${handle.hit}`}
            style={{ ...handle.style, cursor: handle.cursor }}
            onPointerDown={(event) => begin(event, handle.id)}
          >
            <span className={`block h-2.5 w-2.5 rounded-[1px] ring-1 ring-black/70 ${handleColor}`} />
          </div>
        ))}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-black/70 px-1 py-0.5 text-[10px] font-semibold tabular-nums text-white">
          {px.w} × {px.h} px
        </div>
      </div>
      <form
        className={`pointer-events-auto absolute top-1 left-1/2 z-50 flex max-w-[calc(100%-0.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-white ${
          layer.locked ? "opacity-50" : ""
        }`}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => event.preventDefault()}
      >
        <PxField label="X" value={px.x} max={canvas.width} disabled={layer.locked} onChange={(x) => setPx({ x }, true)} />
        <PxField label="Y" value={px.y} max={canvas.height} disabled={layer.locked} onChange={(y) => setPx({ y }, true)} />
        <PxField label="W" value={px.w} max={canvas.width} disabled={layer.locked} onChange={(w) => setPx({ w }, true)} />
        <PxField label="H" value={px.h} max={canvas.height} disabled={layer.locked} onChange={(h) => setPx({ h }, true)} />
        <span className="pl-0.5 text-white/60">px</span>
        <button
          type="button"
          disabled={layer.locked}
          title={t("livestream.layerCropModeHint")}
          aria-pressed={cropMode}
          onClick={() => setCropMode((on) => !on)}
          className={`h-5 rounded px-1.5 text-[10px] font-semibold ${
            cropMode ? "bg-sky-400 text-black" : "bg-white/10 text-white hover:bg-white/20"
          } disabled:opacity-40`}
        >
          {t("livestream.layerCropMode")}
        </button>
        <span className="mx-0.5 h-4 w-px bg-white/20" aria-hidden />
        {(["fit", "fill", "stretch"] as const).map((action) => {
          const fit = action === "fill" ? "cover" : action === "stretch" ? "stretch" : "contain";
          const on =
            layer.rect.x === 0 &&
            layer.rect.y === 0 &&
            layer.rect.w === 100 &&
            layer.rect.h === 100 &&
            layer.fit === fit;
          return (
            <button
              key={action}
              type="button"
              disabled={layer.locked}
              title={t(`livestream.layerTransform_${action}`)}
              aria-pressed={on}
              onClick={() => applyTransform(action)}
              className={`h-5 rounded px-1.5 text-[10px] font-semibold ${
                on ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/20"
              } disabled:opacity-40`}
            >
              {t(`livestream.layerFit_${fit}`)}
            </button>
          );
        })}
      </form>
      {menu ? (
        <LayerTransformMenu
          x={menu.x}
          y={menu.y}
          t={t}
          disabled={layer.locked}
          onPick={applyTransform}
          canOrder={onOrder ? canOrder : undefined}
          onOrder={pickOrder}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

const TRANSFORM_ACTIONS: StreamLayerTransform[] = ["fit", "fill", "stretch", "center", "reset"];

const ORDER_LABELS: Record<StreamLayerOrder, string> = {
  front: "livestream.layerToFront",
  up: "livestream.layerUp",
  down: "livestream.layerDown",
  back: "livestream.layerToBack",
};
const ORDER_KEYS: Record<StreamLayerOrder, string> = { front: "Ctrl+Home", up: "", down: "", back: "Ctrl+End" };

const MENU_ITEM =
  "flex h-7 w-full items-center justify-between gap-4 px-2.5 text-left text-xs text-zinc-100 hover:bg-blue-700 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent";
const MENU_HEADING = "px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/40";

/**
 * Rechtsklikmenu van een bron, in de lijst en op het scherm: volgorde en transformeren, zoals in OBS.
 * `disabled` (vastgezet) geldt alleen voor transformeren.
 */
function LayerTransformMenu({
  x,
  y,
  t,
  disabled,
  onPick,
  canOrder,
  onOrder,
  onClose,
}: {
  x: number;
  y: number;
  t: TFunction;
  disabled?: boolean;
  onPick: (action: StreamLayerTransform) => void;
  /** Zonder dit geen volgorde-items. */
  canOrder?: (order: StreamLayerOrder) => boolean;
  onOrder?: (order: StreamLayerOrder) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [onClose]);
  return (
    <div
      role="menu"
      className="pointer-events-auto fixed z-[80] min-w-[14rem] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {canOrder && onOrder ? (
        <>
          <div className={MENU_HEADING}>{t("livestream.layerOrder")}</div>
          {STREAM_LAYER_ORDERS.map((order) => (
            <button
              key={order}
              type="button"
              role="menuitem"
              disabled={!canOrder(order)}
              onClick={() => onOrder(order)}
              className={MENU_ITEM}
            >
              {t(ORDER_LABELS[order])}
              <span className="text-[10px] text-white/40">{ORDER_KEYS[order]}</span>
            </button>
          ))}
          <div className="my-1 h-px bg-zinc-700" aria-hidden />
        </>
      ) : null}
      <div className={MENU_HEADING}>{t("livestream.layerTransform")}</div>
      {TRANSFORM_ACTIONS.map((action) => (
        <button
          key={action}
          type="button"
          role="menuitem"
          disabled={disabled}
          onClick={() => onPick(action)}
          className={MENU_ITEM}
        >
          {t(`livestream.layerTransform_${action}`)}
          <span className="text-[10px] text-white/40">
            {action === "fit" ? "Ctrl+F" : action === "stretch" ? "Ctrl+S" : action === "center" ? "Ctrl+D" : action === "reset" ? "Ctrl+R" : ""}
          </span>
        </button>
      ))}
    </div>
  );
}

function PxGuide({
  value,
  className,
  style,
}: {
  value: number;
  className?: string;
  style: CSSProperties;
}) {
  if (Math.abs(value) < 1) return null;
  return (
    <div className={`absolute flex items-center justify-center ${className ?? ""}`} style={style}>
      <span className="rounded bg-black/70 px-1 py-px text-[10px] font-semibold tabular-nums">{value} px</span>
    </div>
  );
}

function PxField({
  label,
  value,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-0.5">
      <span className="text-white/50">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        className="h-5 w-12 rounded border border-white/20 bg-black/40 px-1 text-[10px] tabular-nums text-white"
        value={value}
        min={-max}
        max={max}
        step={1}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.round(next));
        }}
      />
    </label>
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

/**
 * Bronnen van de gekozen scène, als de lijst in OBS. De bovenste regel ligt vooraan in beeld.
 * Klikken selecteert de bron, daarna versleep je het kader. Shift houdt de verhouding.
 * Rechtsklik: naar voorgrond/achtergrond en transformeren; Ctrl+Home/End doet hetzelfde.
 */
export function SceneSourcesDock({
  scene,
  selectedLayerId,
  sourceLabel,
  addOpen,
  addPanel,
  properties,
  t,
  onSelect,
  onToggleAdd,
  onToggleVisible,
  onToggleLock,
  onOrder,
  onRemove,
  onTransform,
}: {
  scene: StreamScene;
  selectedLayerId: string | null;
  sourceLabel: (layer: StreamSceneLayer) => string;
  addOpen?: boolean;
  addPanel?: ReactNode;
  /** Extra paneel onder de bronnen, bv. de items van een afspeellijst. */
  properties?: ReactNode;
  t: TFunction;
  onSelect: (layerId: string) => void;
  onToggleAdd: () => void;
  onToggleVisible: (layerId: string) => void;
  onToggleLock: (layerId: string) => void;
  /** Lijst en beeld lezen dezelfde lagen: wat hier bovenaan komt, staat ook vooraan in beeld. */
  onOrder: (layerId: string, order: StreamLayerOrder) => void;
  onRemove: (layerId: string) => void;
  onTransform: (layerId: string, action: StreamLayerTransform) => void;
}) {
  const frontFirst = sceneSourcesTopFirst(scene.layers);
  const selected = frontFirst.find((item) => item.id === selectedLayerId) ?? null;
  const canOrder = (layerId: string, order: StreamLayerOrder) => canOrderSceneLayer(scene.layers, layerId, order);
  const [menu, setMenu] = useState<{ x: number; y: number; layerId: string } | null>(null);
  return (
    <section
      className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-zinc-950/70"
      data-scene-sources
      tabIndex={0}
      onKeyDown={(event) => {
        if (!selected) return;
        const target = event.target as HTMLElement;
        if (target.closest("input, textarea, select")) return;
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          onRemove(selected.id);
          return;
        }
        const order = orderFromKey(event);
        if (order) {
          event.preventDefault();
          if (canOrder(selected.id, order)) onOrder(selected.id, order);
          return;
        }
        if (event.ctrlKey || event.metaKey) {
          const key = event.key.toLowerCase();
          const action =
            key === "f" ? "fit" : key === "s" ? "stretch" : key === "d" ? "center" : key === "r" ? "reset" : null;
          if (action) {
            event.preventDefault();
            onTransform(selected.id, action);
          }
        }
      }}
    >
      <div className="border-b border-border px-2 py-1.5 text-xs font-semibold uppercase text-zinc-200">
        {t("livestream.dockSources")}
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-y-auto">
          {frontFirst.map((item) => (
            <div
              key={item.id}
              className={`flex h-8 items-center gap-1 px-1.5 ${
                item.id === selectedLayerId ? "bg-blue-700 text-white" : "text-zinc-100 hover:bg-zinc-800"
              }`}
              onClick={() => onSelect(item.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                onSelect(item.id);
                setMenu({ x: event.clientX, y: event.clientY, layerId: item.id });
              }}
            >
              <button
                type="button"
                aria-label={item.visible ? t("livestream.layerHide") : t("livestream.layerShow")}
                title={item.visible ? t("livestream.layerHide") : t("livestream.layerShow")}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleVisible(item.id);
                }}
                className="w-4 shrink-0 text-[11px] opacity-80"
              >
                {item.visible ? "👁" : "–"}
              </button>
              <button
                type="button"
                aria-pressed={item.id === selectedLayerId}
                onClick={() => onSelect(item.id)}
                className="min-w-0 flex-1 truncate text-left text-xs font-medium"
              >
                {sourceLabel(item)}
              </button>
              <button
                type="button"
                aria-pressed={item.locked}
                aria-label={item.locked ? t("livestream.layerUnlock") : t("livestream.layerLock")}
                title={item.locked ? t("livestream.layerUnlock") : t("livestream.layerLock")}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleLock(item.id);
                }}
                className="w-4 shrink-0 text-[11px] opacity-80"
              >
                {item.locked ? "🔒" : "🔓"}
              </button>
            </div>
          ))}
        </div>
        {addOpen && addPanel ? (
          <div className="absolute inset-x-1 bottom-1 z-20 max-h-[calc(100%-0.25rem)] overflow-y-auto rounded border border-zinc-700 bg-zinc-900 p-1 shadow-xl">
            {addPanel}
          </div>
        ) : null}
      </div>
      {properties ? <div className="border-t border-border p-1.5">{properties}</div> : null}
      <div className="flex items-center gap-0.5 border-t border-border p-1">
        <button
          type="button"
          aria-pressed={Boolean(addOpen)}
          aria-label={t("livestream.sourceAdd")}
          title={t("livestream.sourceAdd")}
          onClick={onToggleAdd}
          className={`flex h-8 w-8 items-center justify-center rounded text-zinc-200 hover:bg-zinc-700 ${
            addOpen ? "bg-blue-700 text-white" : "bg-zinc-800"
          }`}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t("livestream.layerRemove")}
          title={t("livestream.layerRemove")}
          disabled={!selected}
          onClick={() => selected && onRemove(selected.id)}
          className="flex h-8 w-8 items-center justify-center rounded bg-zinc-800 text-zinc-200 hover:bg-red-700 hover:text-white disabled:opacity-30"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          aria-label={t("livestream.layerUp")}
          title={t("livestream.layerUp")}
          disabled={!selected || !canOrder(selected.id, "up")}
          onClick={() => selected && onOrder(selected.id, "up")}
          className="h-8 w-8 rounded bg-zinc-800 text-xs disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={t("livestream.layerDown")}
          title={t("livestream.layerDown")}
          disabled={!selected || !canOrder(selected.id, "down")}
          onClick={() => selected && onOrder(selected.id, "down")}
          className="h-8 w-8 rounded bg-zinc-800 text-xs disabled:opacity-30"
        >
          ↓
        </button>
      </div>
      {menu ? (
        <LayerTransformMenu
          x={menu.x}
          y={menu.y}
          t={t}
          disabled={scene.layers.find((layer) => layer.id === menu.layerId)?.locked}
          onPick={(action) => {
            onTransform(menu.layerId, action);
            setMenu(null);
          }}
          canOrder={(order) => canOrder(menu.layerId, order)}
          onOrder={(order) => {
            onOrder(menu.layerId, order);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </section>
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
          {sceneSourcesTopFirst(scene.layers).map((item, index, list) => (
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
