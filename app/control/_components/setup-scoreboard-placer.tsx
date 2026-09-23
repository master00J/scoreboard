"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CustomScoreboardLayout } from "@/app/display/_modes/custom-scoreboard-layout";
import { MatchScoreboardFull } from "@/app/display/_modes/match-scoreboard-full";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/form";
import {
  FULL_SLOT_IDS,
  LAYOUT_SLOT_IDS,
  SCOREBOARD_CANVAS_H,
  SCOREBOARD_CANVAS_W,
  normalizeSlot,
  type FullScoreboardSlots,
  type FullSlotId,
  type LayoutSlot,
  type LayoutSlotId,
  type ResolvedScoreboardTheme,
  type ScoreboardSlots,
} from "@/lib/scoreboard-theme";
import type { Match, Team } from "@/lib/types";

const SLOT_TONE: Record<LayoutSlotId, string> = {
  home: "border-sky-400",
  homeScore: "border-sky-200",
  away: "border-rose-400",
  awayScore: "border-rose-200",
  clock: "border-emerald-400",
  shotClock: "border-red-400",
  sponsor: "border-amber-400",
};

export type EditorSurface = "sponsor" | "full";

type DragId = LayoutSlotId | FullSlotId;

type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const RESIZE_HANDLES: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const HANDLE_CLASS: Record<ResizeHandle, string> = {
  n: "left-1/2 top-0 h-2.5 w-8 -translate-x-1/2 cursor-n-resize",
  s: "left-1/2 bottom-0 h-2.5 w-8 -translate-x-1/2 cursor-s-resize",
  e: "right-0 top-1/2 h-8 w-2.5 -translate-y-1/2 cursor-e-resize",
  w: "left-0 top-1/2 h-8 w-2.5 -translate-y-1/2 cursor-w-resize",
  ne: "right-0 top-0 h-3.5 w-3.5 cursor-ne-resize",
  nw: "left-0 top-0 h-3.5 w-3.5 cursor-nw-resize",
  se: "right-0 bottom-0 h-3.5 w-3.5 cursor-se-resize",
  sw: "left-0 bottom-0 h-3.5 w-3.5 cursor-sw-resize",
};

type Drag =
  | { kind: "move"; id: DragId; startX: number; startY: number; slot: LayoutSlot }
  | { kind: "resize"; id: DragId; startX: number; startY: number; slot: LayoutSlot; handle: ResizeHandle };

const FALLBACK_HOME: Team = {
  id: "preview-home",
  name: "Thuis",
  shortName: "THU",
  logoPath: null,
  primaryColor: "#2563eb",
  secondaryColor: "#1e3a8a",
};

const FALLBACK_AWAY: Team = {
  id: "preview-away",
  name: "Uit",
  shortName: "UIT",
  logoPath: null,
  primaryColor: "#dc2626",
  secondaryColor: "#7f1d1d",
};

function editorMatch(home: Team, away: Team): Match {
  return {
    id: "preview",
    homeTeamId: home.id,
    awayTeamId: away.id,
    homeTeam: home,
    awayTeam: away,
    kickoffAt: null,
    halfDurationSec: 2700,
    halfBreakSec: 900,
    sport: "FOOTBALL",
    currentPeriod: 1,
    periodDurationSec: 2700,
    homeTimeouts: 0,
    awayTimeouts: 0,
    homeFouls: 0,
    awayFouls: 0,
    homeSets: 0,
    awaySets: 0,
    status: "FIRST_HALF",
    homeScore: 1,
    awayScore: 0,
    createdAt: new Date().toISOString(),
  };
}

function toHex(raw: string, fallback: string): string {
  const s = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return fallback;
  return `#${[m[1], m[2], m[3]]
    .map((n) => Number(n).toString(16).padStart(2, "0"))
    .join("")}`;
}

const ALIGN_EPS = 0.55;
const GRID_PCT = [10, 20, 30, 40, 60, 70, 80, 90];
const THIRD_PCT = [100 / 3, 200 / 3];
const SAFE_X_PCT = (40 / SCOREBOARD_CANVAS_W) * 100;
const SAFE_Y_PCT = (40 / SCOREBOARD_CANVAS_H) * 100;

function nearPct(a: number, b: number, eps = ALIGN_EPS): boolean {
  return Math.abs(a - b) <= eps;
}

function slotEdges(slot: LayoutSlot) {
  return {
    left: slot.x,
    right: slot.x + slot.w,
    cx: slot.x + slot.w / 2,
    top: slot.y,
    bottom: slot.y + slot.h,
    cy: slot.y + slot.h / 2,
  };
}

function snapTo(value: number, targets: number[]): number {
  let best = value;
  let bestD = ALIGN_EPS;
  for (const t of targets) {
    const d = Math.abs(value - t);
    if (d <= bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

function snapMovedSlot(slot: LayoutSlot, others: LayoutSlot[]): LayoutSlot {
  const vTargets = [0, 50, 100, ...THIRD_PCT, ...GRID_PCT];
  const hTargets = [...vTargets];
  for (const other of others) {
    const e = slotEdges(other);
    vTargets.push(e.left, e.cx, e.right);
    hTargets.push(e.top, e.cy, e.bottom);
  }
  const e = slotEdges(slot);
  const snappedCx = snapTo(e.cx, vTargets);
  const snappedLeft = snapTo(e.left, vTargets);
  const preferCenterX = Math.abs(snappedCx - e.cx) <= Math.abs(snappedLeft - e.left);
  const snappedCy = snapTo(e.cy, hTargets);
  const snappedTop = snapTo(e.top, hTargets);
  const preferCenterY = Math.abs(snappedCy - e.cy) <= Math.abs(snappedTop - e.top);
  return {
    ...slot,
    x: preferCenterX ? snappedCx - slot.w / 2 : snappedLeft,
    y: preferCenterY ? snappedCy - slot.h / 2 : snappedTop,
  };
}

function resizeSlot(
  slot: LayoutSlot,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  keepSquare: boolean,
): LayoutSlot {
  const right = slot.x + slot.w;
  const bottom = slot.y + slot.h;
  let x = slot.x;
  let y = slot.y;
  let w = slot.w;
  let h = slot.h;

  if (handle.includes("e")) w = slot.w + dx;
  if (handle.includes("s")) h = slot.h + dy;
  if (handle.includes("w")) {
    x = slot.x + dx;
    w = right - x;
  }
  if (handle.includes("n")) {
    y = slot.y + dy;
    h = bottom - y;
  }

  if (keepSquare) {
    const fromW = handle.includes("e") || handle.includes("w");
    const fromH = handle.includes("n") || handle.includes("s");
    let side = slot.w;
    if (fromW && fromH) side = Math.max(w, h);
    else if (fromW) side = w;
    else if (fromH) side = h;
    x = handle.includes("w") ? right - side : slot.x;
    y = handle.includes("n") ? bottom - side : slot.y;
    w = side;
    h = side;
  }

  return { x, y, w, h };
}

function snapResizedSlot(slot: LayoutSlot, handle: ResizeHandle, others: LayoutSlot[]): LayoutSlot {
  const vTargets = [0, 50, 100, ...THIRD_PCT, ...GRID_PCT];
  const hTargets = [...vTargets];
  for (const other of others) {
    const e = slotEdges(other);
    vTargets.push(e.left, e.cx, e.right);
    hTargets.push(e.top, e.cy, e.bottom);
  }
  let { x, y, w, h } = slot;
  const right = x + w;
  const bottom = y + h;
  if (handle.includes("e")) w = snapTo(right, vTargets) - x;
  if (handle.includes("w")) {
    x = snapTo(x, vTargets);
    w = right - x;
  }
  if (handle.includes("s")) h = snapTo(bottom, hTargets) - y;
  if (handle.includes("n")) {
    y = snapTo(y, hTargets);
    h = bottom - y;
  }
  return { x, y, w, h };
}

function GuideLine({
  dir,
  pos,
  color,
  dashed,
  strong,
}: {
  dir: "v" | "h";
  pos: number;
  color: string;
  dashed?: boolean;
  strong?: boolean;
}) {
  const width = strong ? 2 : 1;
  if (dir === "v") {
    return (
      <div
        className="absolute top-0 h-full"
        style={{
          left: `${pos}%`,
          width: 0,
          borderLeft: `${width}px ${dashed ? "dashed" : "solid"} ${color}`,
        }}
      />
    );
  }
  return (
    <div
      className="absolute left-0 w-full"
      style={{
        top: `${pos}%`,
        height: 0,
        borderTop: `${width}px ${dashed ? "dashed" : "solid"} ${color}`,
      }}
    />
  );
}

function AlignGuides({ slot, others }: { slot: LayoutSlot; others: LayoutSlot[] }) {
  const e = slotEdges(slot);
  const vLines = [e.left, e.cx, e.right];
  const hLines = [e.top, e.cy, e.bottom];
  const vHit = (v: number) =>
    nearPct(v, 0) ||
    nearPct(v, 50) ||
    nearPct(v, 100) ||
    THIRD_PCT.some((t) => nearPct(v, t)) ||
    others.some((o) => {
      const oe = slotEdges(o);
      return nearPct(v, oe.left) || nearPct(v, oe.cx) || nearPct(v, oe.right);
    });
  const hHit = (h: number) =>
    nearPct(h, 0) ||
    nearPct(h, 50) ||
    nearPct(h, 100) ||
    THIRD_PCT.some((t) => nearPct(h, t)) ||
    others.some((o) => {
      const oe = slotEdges(o);
      return nearPct(h, oe.top) || nearPct(h, oe.cy) || nearPct(h, oe.bottom);
    });

  return (
    <div className="pointer-events-none absolute inset-0 z-[6]" aria-hidden>
      {GRID_PCT.map((p) => (
        <div key={`g-${p}`}>
          <GuideLine dir="v" pos={p} color="rgba(255,255,255,0.18)" />
          <GuideLine dir="h" pos={p} color="rgba(255,255,255,0.18)" />
        </div>
      ))}
      {THIRD_PCT.map((p) => (
        <div key={`t-${p}`}>
          <GuideLine dir="v" pos={p} color="rgba(250,204,21,0.32)" dashed />
          <GuideLine dir="h" pos={p} color="rgba(250,204,21,0.32)" dashed />
        </div>
      ))}
      <div
        className="absolute rounded-sm border border-dashed border-sky-400/60"
        style={{
          left: `${SAFE_X_PCT}%`,
          top: `${SAFE_Y_PCT}%`,
          width: `${100 - SAFE_X_PCT * 2}%`,
          height: `${100 - SAFE_Y_PCT * 2}%`,
        }}
      />
      <GuideLine dir="v" pos={50} color="rgba(255,255,255,0.62)" strong />
      <GuideLine dir="h" pos={50} color="rgba(255,255,255,0.62)" strong />
      {vLines.map((x, i) => (
        <GuideLine
          key={`sv-${i}`}
          dir="v"
          pos={x}
          color={vHit(x) ? "rgba(52,211,153,0.95)" : "rgba(255,255,255,0.42)"}
          dashed
          strong={vHit(x)}
        />
      ))}
      {hLines.map((y, i) => (
        <GuideLine
          key={`sh-${i}`}
          dir="h"
          pos={y}
          color={hHit(y) ? "rgba(52,211,153,0.95)" : "rgba(255,255,255,0.42)"}
          dashed
          strong={hHit(y)}
        />
      ))}
    </div>
  );
}

function VideoPlate() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-zinc-800 via-zinc-900 to-black">
      <div className="rounded border border-white/25 px-[4%] py-[2%] text-[min(8cqw,42px)] font-black tracking-[0.28em] text-white/55">
        16:9
      </div>
      <div className="mt-[2%] text-[min(3.4cqw,22px)] uppercase tracking-[0.2em] text-white/35">Video</div>
    </div>
  );
}

type ColorKey =
  | "contentAreaBg"
  | "frameColorTop"
  | "frameColorMid"
  | "frameColorBot"
  | "scoreColor"
  | "teamNameColor"
  | "timerRunningColor"
  | "timerPausedColor";

export function SetupScoreboardPlacer({
  theme,
  onChange,
  homeTeam,
  awayTeam,
  surface,
}: {
  theme: ResolvedScoreboardTheme;
  onChange: (next: ResolvedScoreboardTheme) => void;
  homeTeam?: Team | null;
  awayTeam?: Team | null;
  surface: EditorSurface;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [showAlignGuides, setShowAlignGuides] = useState(true);
  const [selected, setSelected] = useState<DragId>(surface === "full" ? "home" : "sponsor");
  const dragRef = useRef<Drag | null>(null);
  const slotIds = (surface === "full" ? FULL_SLOT_IDS : LAYOUT_SLOT_IDS).filter(
    (id) => theme.showScores || (id !== "homeScore" && id !== "awayScore"),
  );

  useEffect(() => {
    setSelected(surface === "full" ? "home" : "sponsor");
    dragRef.current = null;
  }, [surface]);

  const home = homeTeam ?? {
    ...FALLBACK_HOME,
    name: t("common.home"),
    shortName: t("common.home").slice(0, 3).toUpperCase(),
  };
  const away = awayTeam ?? {
    ...FALLBACK_AWAY,
    name: t("common.away"),
    shortName: t("common.away").slice(0, 3).toUpperCase(),
  };
  const match = editorMatch(home, away);
  const slots = surface === "full" ? theme.fullSlots : theme.slots;
  const activeId = slotIds.includes(selected as (typeof slotIds)[number]) ? selected : slotIds[0];
  const activeSlot = slots[activeId];

  function applySlot(id: DragId, next: LayoutSlot) {
    const current = slots[id as FullSlotId];
    const normalized = normalizeSlot(next, current);
    if (surface === "full") {
      onChange({
        ...theme,
        fullSlots: { ...theme.fullSlots, [id]: normalized } as FullScoreboardSlots,
      });
      return;
    }
    onChange({
      ...theme,
      layoutMode: "custom",
      slots: { ...theme.slots, [id]: normalized } as ScoreboardSlots,
    });
  }

  function pointerToPct(e: React.PointerEvent) {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box || box.width < 1 || box.height < 1) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - box.left) / box.width) * 100,
      y: ((e.clientY - box.top) / box.height) * 100,
    };
  }

  function onMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const now = pointerToPct(e);
    const dx = now.x - drag.startX;
    const dy = now.y - drag.startY;
    const others = slotIds.filter((id) => id !== drag.id).map((id) => slots[id]);
    if (drag.kind === "move") {
      const moved = { ...drag.slot, x: drag.slot.x + dx, y: drag.slot.y + dy };
      applySlot(drag.id, snapMovedSlot(moved, others));
      return;
    }
    const resized = resizeSlot(drag.slot, drag.handle, dx, dy, drag.id === "sponsor");
    applySlot(
      drag.id,
      drag.id === "sponsor" ? resized : snapResizedSlot(resized, drag.handle, others),
    );
  }

  function endDrag() {
    dragRef.current = null;
  }

  const colorField = (label: string, key: ColorKey) => (
    <div>
      <Label className="text-[11px]">{label}</Label>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          className="h-9 w-11 shrink-0 cursor-pointer rounded border border-border bg-background"
          value={toHex(theme[key], "#000000")}
          onChange={(e) => onChange({ ...theme, [key]: e.target.value })}
        />
        <Input
          value={theme[key]}
          onChange={(e) => onChange({ ...theme, [key]: e.target.value })}
          className="font-mono text-xs"
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {surface === "full" ? t("setup.themePlacerHelpFull") : t("setup.themePlacerHelp")}
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showAlignGuides}
            onChange={(e) => setShowAlignGuides(e.target.checked)}
          />
          {t("setup.themeAlignGuides")}
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div
          ref={canvasRef}
          className="relative w-full overflow-hidden rounded-xl border border-border bg-[#050607]"
          style={{ aspectRatio: "16 / 9", touchAction: "none" }}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="pointer-events-none absolute inset-0">
            {surface === "full" ? (
              <MatchScoreboardFull
                match={match}
                elapsed={512}
                running
                period={t("sports.period.half1")}
                addedTime={2}
                theme={theme}
              />
            ) : (
              <CustomScoreboardLayout
                match={match}
                elapsed={512}
                running
                period={t("sports.period.half1")}
                addedTime={2}
                theme={{ ...theme, layoutMode: "custom" }}
              >
                <VideoPlate />
              </CustomScoreboardLayout>
            )}
          </div>

          {showAlignGuides && (
            <AlignGuides
              slot={activeSlot}
              others={slotIds.filter((id) => id !== activeId).map((id) => slots[id])}
            />
          )}

          {showAlignGuides && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-[7] flex justify-between px-1.5 pt-0.5 text-[9px] font-semibold tabular-nums text-white/75 drop-shadow">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          )}
          {showAlignGuides && (
            <div className="pointer-events-none absolute inset-y-0 left-0 z-[7] flex flex-col justify-between py-1 pl-1 text-[9px] font-semibold tabular-nums text-white/75 drop-shadow">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          )}
          {showAlignGuides && (
            <div className="pointer-events-none absolute bottom-1 right-1 z-[7] rounded bg-black/60 px-1.5 py-0.5 text-[10px] tabular-nums text-white/90">
              {activeSlot.x.toFixed(1)}%, {activeSlot.y.toFixed(1)}% · {activeSlot.w.toFixed(1)}×{activeSlot.h.toFixed(1)}%
            </div>
          )}

          {slotIds.map((id) => {
            const slot = slots[id];
            const active = activeId === id;
            return (
              <div
                key={id}
                className={`absolute cursor-grab rounded-md border-2 bg-transparent ${SLOT_TONE[id]} ${
                  active ? "z-20 border-white ring-2 ring-white/70" : "z-10 border-white/35 hover:border-white/70"
                }`}
                style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  setSelected(id);
                  const p = pointerToPct(e);
                  dragRef.current = { kind: "move", id, startX: p.x, startY: p.y, slot };
                }}
              >
                <div className="pointer-events-none px-2 pt-1 text-[10px] font-bold uppercase tracking-wide text-white drop-shadow">
                  {t(`setup.themeSlot_${id}`)}
                </div>
                {active
                  ? RESIZE_HANDLES.map((handle) => (
                      <button
                        key={handle}
                        type="button"
                        aria-label={t("setup.themeResize")}
                        className={`absolute z-30 rounded-sm bg-white shadow ${HANDLE_CLASS[handle]}`}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                          setSelected(id);
                          const p = pointerToPct(e);
                          dragRef.current = { kind: "resize", id, startX: p.x, startY: p.y, slot, handle };
                        }}
                      />
                    ))
                  : (
                    <button
                      type="button"
                      aria-label={t("setup.themeResize")}
                      className="absolute bottom-0 right-0 z-30 h-3.5 w-3.5 cursor-se-resize rounded-sm bg-white/80"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                        setSelected(id);
                        const p = pointerToPct(e);
                        dragRef.current = { kind: "resize", id, startX: p.x, startY: p.y, slot, handle: "se" };
                      }}
                    />
                  )}
              </div>
            );
          })}
        </div>

        <div className="space-y-3 rounded-xl border border-border p-3">
          <div>
            <div className="text-sm font-semibold">{t("setup.themeSlotSize")}</div>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {t("setup.themeSlotSizeHint")}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  ["x", "themeSlotX"],
                  ["y", "themeSlotY"],
                  ["w", "themeSlotWidth"],
                  ["h", "themeSlotHeight"],
                ] as const
              ).map(([field, labelKey]) => (
                <div key={field}>
                  <Label className="text-[11px]">{t(`setup.${labelKey}`)}</Label>
                  <Input
                    type="number"
                    min={field === "x" || field === "y" ? 0 : 8}
                    max={100}
                    step={1}
                    value={Math.round(activeSlot[field])}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (!Number.isFinite(value)) return;
                      const next = { ...activeSlot, [field]: value };
                      if (activeId === "sponsor" && (field === "w" || field === "h")) {
                        next.w = value;
                        next.h = value;
                      }
                      applySlot(activeId, next);
                    }}
                    className="mt-1 h-8 font-mono text-xs tabular-nums"
                    aria-label={t(`setup.${labelKey}`)}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="text-sm font-semibold">{t("setup.themeColorsTitle")}</div>
          {colorField(t("setup.themeContentBg"), "contentAreaBg")}
          {colorField(t("setup.themeScoreColor"), "scoreColor")}
          {colorField(t("setup.themeTeamNameColor"), "teamNameColor")}
          {colorField(t("setup.themeTimerRunning"), "timerRunningColor")}
          {colorField(t("setup.themeTimerPaused"), "timerPausedColor")}
          {surface === "sponsor" ? (
            <>
              {colorField(t("setup.themeFrameMid"), "frameColorMid")}
              {colorField(t("setup.themeFrameTop"), "frameColorTop")}
              {colorField(t("setup.themeFrameBot"), "frameColorBot")}
            </>
          ) : null}
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        {t("setup.themeSlotHint", {
          slot: t(`setup.themeSlot_${activeId}`),
        })}{" "}
        {t("setup.themeSlotPos", {
          x: activeSlot.x.toFixed(1),
          y: activeSlot.y.toFixed(1),
          w: activeSlot.w.toFixed(1),
          h: activeSlot.h.toFixed(1),
          px: `${Math.round((activeSlot.x / 100) * SCOREBOARD_CANVAS_W)},${Math.round((activeSlot.y / 100) * SCOREBOARD_CANVAS_H)}`,
          size: `${Math.round((activeSlot.w / 100) * SCOREBOARD_CANVAS_W)}×${Math.round((activeSlot.h / 100) * SCOREBOARD_CANVAS_H)}`,
        })}
      </div>
    </div>
  );
}
