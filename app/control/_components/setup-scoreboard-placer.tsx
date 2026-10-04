"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Trash2 } from "lucide-react";
import { CustomScoreboardLayout } from "@/app/display/_modes/custom-scoreboard-layout";
import { LeftScoreboardLayout } from "@/app/display/_modes/left-scoreboard-layout";
import { MatchScoreboardFull } from "@/app/display/_modes/match-scoreboard-full";
import { StripScoreboardLayout } from "@/app/display/_modes/scoreboard-strip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Select } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { isElectron, selectFilesViaDialog } from "@/lib/electron";
import { tPeriodName, tSportLabel } from "@/lib/i18n/t-sport";
import {
  GRID_PCT,
  RESIZE_HANDLES,
  THIRD_PCT,
  boxEdges,
  nearPct,
  resizeBox,
  snapMovedBox,
  snapResizedBox,
  type ResizeHandle,
} from "@/lib/layout-geometry";
import {
  ADDABLE_ELEMENT_TYPES,
  ELEMENT_LIMIT,
  ELEMENT_TEXT_MAX,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  createElement,
  duplicateElement,
  isClassicElementId,
  moveElementLayer,
  normalizeBox,
  sixteenByNineHeightPct,
  type AddableElementType,
  type ElementAlign,
  type ElementSide,
  type LayoutElement,
  type LayoutElementStyle,
} from "@/lib/scoreboard-elements";
import {
  scoreboardEditorShowsLeftFrame,
  withSurfaceElements,
  type LayoutSlot,
  type ResolvedScoreboardTheme,
} from "@/lib/scoreboard-theme";
import { SPORT_TYPES, getSportProfile, normalizeSport, resolveDisplayShowClock, type SportType } from "@/lib/sports";
import type { Match, Team } from "@/lib/types";

export type EditorSurface = "sponsor" | "full";

/**
 * `live` = tussenstand tijdens slepen (de eigenaar maakt er bij `onGestureEnd` één stap van).
 * `coalesce` = een reeks snelle wijzigingen met dezelfde sleutel telt als één stap (typen, kleur kiezen).
 */
export type LayoutChangeOptions = { live?: boolean; coalesce?: string };

const TYPE_TONE: Record<LayoutElement["type"], string> = {
  teamLogo: "border-sky-400",
  teamScore: "border-sky-200",
  clock: "border-emerald-400",
  shotClock: "border-red-400",
  media: "border-amber-400",
  teamName: "border-sky-300",
  teamExtras: "border-violet-300",
  period: "border-emerald-200",
  timeOfDay: "border-teal-300",
  text: "border-fuchsia-300",
  image: "border-orange-300",
};

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
  | { kind: "move"; id: string; startX: number; startY: number; box: LayoutSlot }
  | { kind: "resize"; id: string; startX: number; startY: number; box: LayoutSlot; handle: ResizeHandle };

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

/** Voorbeeldwedstrijd per sport, zodat sets, fouten, time-outs en shotclock in de editor te zien zijn. */
function editorMatch(home: Team, away: Team, sport: SportType): Match {
  const base: Match = {
    id: "preview",
    homeTeamId: home.id,
    awayTeamId: away.id,
    homeTeam: home,
    awayTeam: away,
    kickoffAt: null,
    halfDurationSec: 2700,
    halfBreakSec: 900,
    sport,
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
  switch (sport) {
    case "BASKETBALL":
      return {
        ...base,
        currentPeriod: 2,
        periodDurationSec: 600,
        homeScore: 34,
        awayScore: 31,
        homeFouls: 3,
        awayFouls: 5,
        homeTimeouts: 1,
        awayTimeouts: 2,
        possessionArrow: "home",
      };
    case "FUTSAL":
      return { ...base, currentPeriod: 2, periodDurationSec: 1200, homeScore: 3, awayScore: 2, homeFouls: 4, awayFouls: 6, homeTimeouts: 1 };
    case "VOLLEYBALL":
      return {
        ...base,
        currentPeriod: 4,
        homeScore: 18,
        awayScore: 21,
        homeSets: 1,
        awaySets: 2,
        homeTimeouts: 1,
        servingSide: "away",
        setHistory: [
          { home: 25, away: 22 },
          { home: 20, away: 25 },
          { home: 23, away: 25 },
        ],
      };
    case "HOCKEY":
      return { ...base, currentPeriod: 3, periodDurationSec: 900, homeScore: 2, awayScore: 2 };
    default:
      return base;
  }
}

/** Klokstand in het voorbeeld; aftellende sporten tonen de resterende tijd. */
function previewElapsed(sport: SportType): number {
  return getSportProfile(sport).timerMode === "COUNT_DOWN" ? 437 : 512;
}

function toHex(raw: string | undefined, fallback: string): string {
  const s = (raw ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return fallback;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}

function newElementId(): string {
  return `el-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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
        style={{ left: `${pos}%`, width: 0, borderLeft: `${width}px ${dashed ? "dashed" : "solid"} ${color}` }}
      />
    );
  }
  return (
    <div
      className="absolute left-0 w-full"
      style={{ top: `${pos}%`, height: 0, borderTop: `${width}px ${dashed ? "dashed" : "solid"} ${color}` }}
    />
  );
}

function AlignGuides({
  box,
  others,
  safeXPct,
  safeYPct,
}: {
  box: LayoutSlot | null;
  others: LayoutSlot[];
  safeXPct: number;
  safeYPct: number;
}) {
  const hit = (value: number, pick: (edges: ReturnType<typeof boxEdges>) => number[]) =>
    nearPct(value, 0) ||
    nearPct(value, 50) ||
    nearPct(value, 100) ||
    THIRD_PCT.some((third) => nearPct(value, third)) ||
    others.some((other) => pick(boxEdges(other)).some((line) => nearPct(value, line)));
  const e = box ? boxEdges(box) : null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[60]" aria-hidden>
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
      {safeXPct > 0 || safeYPct > 0 ? (
        <div
          className="absolute rounded-sm border border-dashed border-sky-400/60"
          style={{ left: `${safeXPct}%`, top: `${safeYPct}%`, width: `${100 - safeXPct * 2}%`, height: `${100 - safeYPct * 2}%` }}
        />
      ) : null}
      <GuideLine dir="v" pos={50} color="rgba(255,255,255,0.62)" strong />
      <GuideLine dir="h" pos={50} color="rgba(255,255,255,0.62)" strong />
      {e
        ? [e.left, e.cx, e.right].map((x, i) => {
            const on = hit(x, (o) => [o.left, o.cx, o.right]);
            return (
              <GuideLine key={`sv-${i}`} dir="v" pos={x} dashed strong={on} color={on ? "rgba(52,211,153,0.95)" : "rgba(255,255,255,0.42)"} />
            );
          })
        : null}
      {e
        ? [e.top, e.cy, e.bottom].map((y, i) => {
            const on = hit(y, (o) => [o.top, o.cy, o.bottom]);
            return (
              <GuideLine key={`sh-${i}`} dir="h" pos={y} dashed strong={on} color={on ? "rgba(52,211,153,0.95)" : "rgba(255,255,255,0.42)"} />
            );
          })
        : null}
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

type AddOption = { type: AddableElementType; side?: ElementSide };

const ADD_OPTIONS: AddOption[] = ADDABLE_ELEMENT_TYPES.flatMap((type): AddOption[] =>
  type === "teamName" || type === "teamExtras"
    ? [
        { type, side: "home" },
        { type, side: "away" },
      ]
    : [{ type }],
);

export function SetupScoreboardPlacer({
  theme,
  onChange,
  onGestureStart,
  onGestureEnd,
  onUndo,
  onRedo,
  homeTeam,
  awayTeam,
  initialSport,
  surface,
  canvasWidth,
  canvasHeight,
  safeZonePx,
}: {
  theme: ResolvedScoreboardTheme;
  onChange: (next: ResolvedScoreboardTheme, opts?: LayoutChangeOptions) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  onUndo: () => void;
  onRedo: () => void;
  homeTeam?: Team | null;
  awayTeam?: Team | null;
  /** Sport van de actieve wedstrijd; daarna kiest de operator zelf. */
  initialSport?: string | null;
  surface: EditorSurface;
  /** Schermformaat uit Scherminstellingen; het canvas en het 16:9-videovak rekenen hiermee. */
  canvasWidth: number;
  canvasHeight: number;
  safeZonePx: number;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const altRef = useRef(false);
  /** Slepen aan de schuif telt als één stap; met de pijltjes is elke tik een stap. */
  const sliderDragRef = useRef(false);
  const [showAlignGuides, setShowAlignGuides] = useState(true);
  const [snap, setSnap] = useState(true);
  const [lockMediaRatio, setLockMediaRatio] = useState(true);
  const [previewSport, setPreviewSport] = useState<SportType>(() => normalizeSport(initialSport));

  // Een andere wedstrijd actief: het voorbeeld volgt die sport.
  useEffect(() => {
    if (initialSport) setPreviewSport(normalizeSport(initialSport));
  }, [initialSport]);
  const [selected, setSelected] = useState<string>(surface === "full" ? "home" : "sponsor");

  useEffect(() => {
    setSelected(surface === "full" ? "home" : "sponsor");
    dragRef.current = null;
  }, [surface]);

  const elements = theme.elements[surface];
  const active = elements.find((element) => element.id === selected) ?? elements[0];
  const activeIndex = elements.indexOf(active);
  const mediaRatio = sixteenByNineHeightPct(1, canvasWidth, canvasHeight);

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
  const match = editorMatch(home, away, previewSport);
  const profile = getSportProfile(previewSport);
  /** Zelfde aanpassingen als het stadionscherm: geen klok of extra tijd bij sporten die dat niet kennen. */
  const previewTheme: ResolvedScoreboardTheme = {
    ...theme,
    showClock: resolveDisplayShowClock(previewSport, theme.showClock),
    fullShowAddedTime: profile.supportsInjuryTime ? theme.fullShowAddedTime : false,
  };
  const period = tPeriodName(t, previewSport, match.currentPeriod);
  const shotClock = profile.shotClockPresets.length > 0 ? 14 : 0;

  function elementLabel(element: LayoutElement): string {
    if (isClassicElementId(element.id)) return t(`setup.themeSlot_${element.id}`);
    if (element.type === "text" && element.text?.trim()) return `“${element.text.trim().slice(0, 24)}”`;
    return t(`layoutEditor.type_${element.type}${element.side ? `_${element.side}` : ""}`);
  }

  function commit(list: LayoutElement[], opts?: LayoutChangeOptions) {
    onChange(withSurfaceElements(theme, surface, list), opts);
  }

  function patchElement(id: string, patch: Partial<LayoutElement>, opts?: LayoutChangeOptions) {
    commit(
      elements.map((element) => (element.id === id ? { ...element, ...patch } : element)),
      opts,
    );
  }

  function patchStyle(id: string, patch: Partial<LayoutElementStyle>, opts?: LayoutChangeOptions) {
    const current = elements.find((element) => element.id === id);
    if (!current) return;
    const style: LayoutElementStyle = { ...current.style, ...patch };
    for (const key of Object.keys(style) as Array<keyof LayoutElementStyle>) {
      if (style[key] === undefined || style[key] === "" || style[key] === false) delete style[key];
    }
    if (style.fontScale === 1) delete style.fontScale;
    if (style.align === "center") delete style.align;
    const { style: _old, ...rest } = current;
    commit(
      elements.map((element) =>
        element.id === id ? (Object.keys(style).length > 0 ? { ...rest, style } : rest) : element,
      ),
      opts,
    );
  }

  function setBox(id: string, next: LayoutSlot, opts?: LayoutChangeOptions) {
    const current = elements.find((element) => element.id === id);
    if (!current) return;
    patchElement(id, normalizeBox(next, current), opts);
  }

  function ratioFor(element: LayoutElement): number | null {
    return element.type === "media" && lockMediaRatio ? mediaRatio : null;
  }

  function othersOf(id: string): LayoutSlot[] {
    return elements.filter((element) => element.id !== id && !element.hidden);
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
    const element = elements.find((item) => item.id === drag.id);
    if (!element) return;
    const now = pointerToPct(e);
    const dx = now.x - drag.startX;
    const dy = now.y - drag.startY;
    const magnetic = snap && !e.altKey && !altRef.current;
    const others = othersOf(drag.id);
    if (drag.kind === "move") {
      const moved = { ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy };
      setBox(drag.id, magnetic ? snapMovedBox(moved, others) : moved, { live: true });
      return;
    }
    const ratio = ratioFor(element);
    const resized = resizeBox(drag.box, drag.handle, dx, dy, ratio);
    // Een vak met vaste verhouding springt niet per rand: dat zou de verhouding breken.
    setBox(drag.id, magnetic && !ratio ? snapResizedBox(resized, drag.handle, others) : resized, { live: true });
  }

  function startDrag(e: React.PointerEvent, element: LayoutElement, handle?: ResizeHandle) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    canvasRef.current?.focus({ preventScroll: true });
    setSelected(element.id);
    const p = pointerToPct(e);
    const box = { x: element.x, y: element.y, w: element.w, h: element.h };
    dragRef.current = handle
      ? { kind: "resize", id: element.id, startX: p.x, startY: p.y, box, handle }
      : { kind: "move", id: element.id, startX: p.x, startY: p.y, box };
    onGestureStart();
  }

  function endDrag() {
    if (!dragRef.current) return;
    dragRef.current = null;
    onGestureEnd();
  }

  function addElement(value: string) {
    const [type, side] = value.split(":") as [AddableElementType, ElementSide | undefined];
    if (!(ADDABLE_ELEMENT_TYPES as readonly string[]).includes(type)) return;
    if (elements.length >= ELEMENT_LIMIT) {
      toast({ title: t("layoutEditor.limitReached", { count: ELEMENT_LIMIT }), variant: "error" });
      return;
    }
    let element = createElement(type, newElementId(), side || "home");
    // Twee keer hetzelfde toevoegen: schuif het nieuwe iets op, zodat het niet precies op het vorige ligt.
    for (let i = 0; i < 8 && elements.some((item) => item.x === element.x && item.y === element.y); i++) {
      element = { ...element, ...normalizeBox({ x: element.x + 2, y: element.y + 2, w: element.w, h: element.h }, element) };
    }
    commit([...elements, element]);
    setSelected(element.id);
  }

  function removeOrHide(element: LayoutElement) {
    if (isClassicElementId(element.id)) {
      patchElement(element.id, { hidden: !element.hidden });
      return;
    }
    commit(elements.filter((item) => item.id !== element.id));
  }

  function duplicate(element: LayoutElement) {
    if (elements.length >= ELEMENT_LIMIT) {
      toast({ title: t("layoutEditor.limitReached", { count: ELEMENT_LIMIT }), variant: "error" });
      return;
    }
    const copy = duplicateElement(element, newElementId());
    if (!copy) return;
    commit([...elements, copy]);
    setSelected(copy.id);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    altRef.current = e.altKey;
    // Alt is hier "vrij slepen". Zonder dit klapt Windows bij het loslaten de menubalk open.
    if (e.key === "Alt") {
      e.preventDefault();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) onRedo();
      else onUndo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      onRedo();
      return;
    }
    if (!active) return;
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicate(active);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeOrHide(active);
      return;
    }
    const step = e.shiftKey ? 1 : 0.1;
    const delta =
      e.key === "ArrowLeft"
        ? { x: -step, y: 0 }
        : e.key === "ArrowRight"
          ? { x: step, y: 0 }
          : e.key === "ArrowUp"
            ? { x: 0, y: -step }
            : e.key === "ArrowDown"
              ? { x: 0, y: step }
              : null;
    if (!delta) return;
    e.preventDefault();
    setBox(
      active.id,
      { x: active.x + delta.x, y: active.y + delta.y, w: active.w, h: active.h },
      { coalesce: `nudge:${active.id}` },
    );
  }

  async function pickImage(element: LayoutElement) {
    const paths = await selectFilesViaDialog({
      title: t("layoutEditor.imageLabel"),
      filters: [{ name: t("setup.filterImage"), extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (paths[0]) patchElement(element.id, { src: paths[0] });
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
          onChange={(e) => onChange({ ...theme, [key]: e.target.value }, { coalesce: `color:${key}` })}
        />
        <Input
          value={theme[key]}
          onChange={(e) => onChange({ ...theme, [key]: e.target.value }, { coalesce: `color:${key}` })}
          className="font-mono text-xs"
        />
      </div>
    </div>
  );

  const elementColor = (label: string, key: "color" | "background", element: LayoutElement) => (
    <div>
      <Label className="text-[11px]">{label}</Label>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          className="h-8 w-11 shrink-0 cursor-pointer rounded border border-border bg-background"
          value={toHex(element.style?.[key], key === "color" ? "#ffffff" : "#000000")}
          onChange={(e) => patchStyle(element.id, { [key]: e.target.value }, { coalesce: `style:${element.id}:${key}` })}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!element.style?.[key]}
          onClick={() => patchStyle(element.id, { [key]: undefined })}
        >
          {t("common.clear")}
        </Button>
      </div>
    </div>
  );

  const hasText = active && active.type !== "image" && active.type !== "media" && active.type !== "shotClock";
  const safeXPct = (safeZonePx / Math.max(1, canvasWidth)) * 100;
  const safeYPct = (safeZonePx / Math.max(1, canvasHeight)) * 100;
  const px = (pct: number, total: number) => Math.round((pct / 100) * total);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {surface === "full" ? t("setup.themePlacerHelpFull") : t("setup.themePlacerHelp")}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            {t("layoutEditor.previewSport")}
            <Select
              className="h-8 w-auto text-xs"
              value={previewSport}
              aria-label={t("layoutEditor.previewSport")}
              onChange={(e) => setPreviewSport(e.target.value as SportType)}
            >
              {SPORT_TYPES.map((sport) => (
                <option key={sport} value={sport}>
                  {tSportLabel(t, sport)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex cursor-pointer items-center gap-2" title={t("layoutEditor.snapHint")}>
            <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
            {t("layoutEditor.snap")}
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={showAlignGuides} onChange={(e) => setShowAlignGuides(e.target.checked)} />
            {t("setup.themeAlignGuides")}
          </label>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0">
          <div
            ref={canvasRef}
            tabIndex={0}
            role="application"
            aria-label={t("setup.themePlacerTitle")}
            className="relative mx-auto overflow-hidden rounded-xl border border-border bg-[#050607] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              aspectRatio: `${canvasWidth} / ${canvasHeight}`,
              width: `min(100%, calc(70vh * ${canvasWidth / canvasHeight}))`,
              touchAction: "none",
            }}
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
            onKeyUp={(e) => {
              altRef.current = e.altKey;
              if (e.key === "Alt") e.preventDefault();
            }}
          >
            <div className="pointer-events-none absolute inset-0" data-layout-preview>
              {surface === "full" ? (
                <MatchScoreboardFull
                  match={match}
                  elapsed={previewElapsed(previewSport)}
                  running
                  period={period}
                  addedTime={2}
                  shotClock={shotClock}
                  theme={previewTheme}
                />
              ) : scoreboardEditorShowsLeftFrame(previewTheme) ? (
                <LeftScoreboardLayout
                  match={match}
                  elapsed={previewElapsed(previewSport)}
                  running
                  period={period}
                  addedTime={2}
                  shotClock={shotClock}
                  theme={previewTheme}
                >
                  <VideoPlate />
                </LeftScoreboardLayout>
              ) : previewTheme.layoutMode === "bottom-strip" ? (
                <StripScoreboardLayout
                  match={match}
                  elapsed={previewElapsed(previewSport)}
                  running
                  period={period}
                  addedTime={2}
                  shotClock={shotClock}
                  theme={previewTheme}
                >
                  <VideoPlate />
                </StripScoreboardLayout>
              ) : (
                <CustomScoreboardLayout
                  match={match}
                  elapsed={previewElapsed(previewSport)}
                  running
                  period={period}
                  addedTime={2}
                  shotClock={shotClock}
                  theme={previewTheme}
                >
                  <VideoPlate />
                </CustomScoreboardLayout>
              )}
            </div>

            {showAlignGuides && (
              <AlignGuides
                box={active ?? null}
                others={active ? othersOf(active.id) : []}
                safeXPct={safeXPct}
                safeYPct={safeYPct}
              />
            )}

            {showAlignGuides && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-[61] flex justify-between px-1.5 pt-0.5 text-[9px] font-semibold tabular-nums text-white/75 drop-shadow">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            )}
            {showAlignGuides && (
              <div className="pointer-events-none absolute inset-y-0 left-0 z-[61] flex flex-col justify-between py-1 pl-1 text-[9px] font-semibold tabular-nums text-white/75 drop-shadow">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            )}

            {elements.map((element, index) => {
              const isActive = active?.id === element.id;
              return (
                <div
                  key={element.id}
                  data-layout-box={element.id}
                  className={`absolute cursor-grab rounded-md border-2 bg-transparent ${TYPE_TONE[element.type]} ${
                    isActive ? "border-white ring-2 ring-white/70" : "border-white/35 hover:border-white/70"
                  } ${element.hidden ? "border-dashed opacity-45" : ""}`}
                  style={{
                    left: `${element.x}%`,
                    top: `${element.y}%`,
                    width: `${element.w}%`,
                    height: `${element.h}%`,
                    zIndex: isActive ? 120 : 70 + index,
                  }}
                  onPointerDown={(e) => startDrag(e, element)}
                >
                  <div className="pointer-events-none truncate px-2 pt-1 text-[10px] font-bold uppercase tracking-wide text-white drop-shadow">
                    {elementLabel(element)}
                    {element.hidden ? ` · ${t("layoutEditor.hiddenTag")}` : ""}
                  </div>
                  {isActive ? (
                    RESIZE_HANDLES.map((handle) => (
                      <button
                        key={handle}
                        type="button"
                        tabIndex={-1}
                        aria-label={t("setup.themeResize")}
                        className={`absolute z-30 rounded-sm bg-white shadow ${HANDLE_CLASS[handle]}`}
                        onPointerDown={(e) => startDrag(e, element, handle)}
                      />
                    ))
                  ) : (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={t("setup.themeResize")}
                      className="absolute bottom-0 right-0 z-30 h-3.5 w-3.5 cursor-se-resize rounded-sm bg-white/80"
                      onPointerDown={(e) => startDrag(e, element, "se")}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            {t("layoutEditor.canvasNote", { width: canvasWidth, height: canvasHeight })} {t("layoutEditor.keyboardHint")}
          </p>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">{t("layoutEditor.elementsTitle")}</div>
              <Select
                className="h-8 w-auto max-w-[11rem] text-xs"
                value=""
                aria-label={t("layoutEditor.addElement")}
                onChange={(e) => {
                  if (e.target.value) addElement(e.target.value);
                }}
              >
                <option value="">{t("layoutEditor.addElement")}</option>
                {ADD_OPTIONS.map((option) => (
                  <option key={`${option.type}:${option.side ?? ""}`} value={`${option.type}:${option.side ?? ""}`}>
                    {t(`layoutEditor.type_${option.type}${option.side ? `_${option.side}` : ""}`)}
                  </option>
                ))}
              </Select>
            </div>
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1" data-layout-list>
              {[...elements].reverse().map((element) => {
                const index = elements.indexOf(element);
                const classic = isClassicElementId(element.id);
                return (
                  <li
                    key={element.id}
                    className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs ${
                      active?.id === element.id ? "border-primary bg-primary/10" : "border-border"
                    }`}
                  >
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 hover:bg-muted/60"
                      title={element.hidden ? t("layoutEditor.show") : t("layoutEditor.hide")}
                      aria-label={element.hidden ? t("layoutEditor.show") : t("layoutEditor.hide")}
                      onClick={() => patchElement(element.id, { hidden: !element.hidden })}
                    >
                      {element.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                    <button
                      type="button"
                      className={`min-w-0 flex-1 truncate text-left ${element.hidden ? "text-muted-foreground line-through" : ""}`}
                      onClick={() => setSelected(element.id)}
                    >
                      {elementLabel(element)}
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 hover:bg-muted/60 disabled:opacity-30"
                      title={t("layoutEditor.layerUp")}
                      aria-label={t("layoutEditor.layerUp")}
                      disabled={index >= elements.length - 1}
                      onClick={() => commit(moveElementLayer(elements, element.id, 1))}
                    >
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 hover:bg-muted/60 disabled:opacity-30"
                      title={t("layoutEditor.layerDown")}
                      aria-label={t("layoutEditor.layerDown")}
                      disabled={index <= 0}
                      onClick={() => commit(moveElementLayer(elements, element.id, -1))}
                    >
                      <ArrowDown className="size-3.5" />
                    </button>
                    {classic ? null : (
                      <>
                        <button
                          type="button"
                          className="shrink-0 rounded p-1 hover:bg-muted/60"
                          title={t("layoutEditor.duplicate")}
                          aria-label={t("layoutEditor.duplicate")}
                          onClick={() => duplicate(element)}
                        >
                          <Copy className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          className="shrink-0 rounded p-1 text-red-300 hover:bg-destructive/20"
                          title={t("layoutEditor.remove")}
                          aria-label={t("layoutEditor.remove")}
                          onClick={() => removeOrHide(element)}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {active ? (
            <div className="space-y-3 rounded-xl border border-border p-3" data-layout-props>
              <div className="text-sm font-semibold">
                {t("layoutEditor.propsTitle")}: {elementLabel(active)}
              </div>
              <div className="grid grid-cols-2 gap-2">
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
                      min={field === "x" || field === "y" ? 0 : 2}
                      max={100}
                      step={0.1}
                      value={active[field]}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        if (!Number.isFinite(value)) return;
                        const next = { x: active.x, y: active.y, w: active.w, h: active.h, [field]: value };
                        const ratio = ratioFor(active);
                        if (ratio && field === "w") next.h = value * ratio;
                        if (ratio && field === "h") next.w = value / ratio;
                        setBox(active.id, next, { coalesce: `box:${active.id}:${field}` });
                      }}
                      className="mt-1 h-8 font-mono text-xs tabular-nums"
                      aria-label={t(`setup.${labelKey}`)}
                    />
                  </div>
                ))}
              </div>

              {active.type === "media" ? (
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input type="checkbox" checked={lockMediaRatio} onChange={(e) => setLockMediaRatio(e.target.checked)} />
                  {t("layoutEditor.lockRatio")}
                </label>
              ) : null}

              {active.type === "text" ? (
                <div>
                  <Label className="text-[11px]">{t("layoutEditor.textLabel")}</Label>
                  <Input
                    className="mt-1 h-8 text-xs"
                    value={active.text ?? ""}
                    maxLength={ELEMENT_TEXT_MAX}
                    placeholder={t("layoutEditor.textPlaceholder")}
                    onChange={(e) => patchElement(active.id, { text: e.target.value }, { coalesce: `text:${active.id}` })}
                  />
                </div>
              ) : null}

              {active.type === "image" ? (
                <div>
                  <Label className="text-[11px]">{t("layoutEditor.imageLabel")}</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Input
                      className="h-8 font-mono text-xs"
                      value={active.src ?? ""}
                      onChange={(e) => patchElement(active.id, { src: e.target.value }, { coalesce: `src:${active.id}` })}
                    />
                    {isElectron ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => void pickImage(active)}>
                        {t("common.chooseFile")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {active.type !== "media" ? (
                <div>
                  <Label className="text-[11px]">
                    {t("layoutEditor.fontScale")}: {Math.round((active.style?.fontScale ?? 1) * 100)}%
                  </Label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="range"
                      className="w-full"
                      min={FONT_SCALE_MIN}
                      max={FONT_SCALE_MAX}
                      step={0.05}
                      value={active.style?.fontScale ?? 1}
                      aria-label={t("layoutEditor.fontScale")}
                      onPointerDown={() => {
                        sliderDragRef.current = true;
                        onGestureStart();
                      }}
                      onPointerUp={() => {
                        sliderDragRef.current = false;
                        onGestureEnd();
                      }}
                      onChange={(e) =>
                        patchStyle(active.id, { fontScale: Number(e.target.value) }, { live: sliderDragRef.current })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!active.style?.fontScale}
                      onClick={() => patchStyle(active.id, { fontScale: undefined })}
                    >
                      {t("layoutEditor.fontScaleAuto")}
                    </Button>
                  </div>
                </div>
              ) : null}

              {hasText ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {elementColor(t("layoutEditor.textColor"), "color", active)}
                    {elementColor(t("layoutEditor.background"), "background", active)}
                  </div>
                  <div>
                    <Label className="text-[11px]">{t("layoutEditor.align")}</Label>
                    <div className="mt-1 flex gap-1">
                      {(["left", "center", "right"] as ElementAlign[]).map((align) => (
                        <button
                          key={align}
                          type="button"
                          onClick={() => patchStyle(active.id, { align })}
                          className={`flex-1 rounded-md border px-2 py-1 text-xs ${
                            (active.style?.align ?? "center") === align
                              ? "border-primary bg-primary/10 font-medium"
                              : "border-border hover:bg-muted/50"
                          }`}
                        >
                          {t(`layoutEditor.align_${align}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {active.type === "text" || active.type === "teamName" ? (
                    <label className="flex cursor-pointer items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={active.style?.uppercase === true}
                        onChange={(e) => patchStyle(active.id, { uppercase: e.target.checked })}
                      />
                      {t("layoutEditor.uppercase")}
                    </label>
                  ) : null}
                </>
              ) : active.type !== "shotClock" ? (
                elementColor(t("layoutEditor.background"), "background", active)
              ) : null}
            </div>
          ) : null}

          <details className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-sm font-semibold">{t("setup.themeColorsTitle")}</summary>
            <div className="mt-3 space-y-3">
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
          </details>
        </div>
      </div>

      {active ? (
        <div className="text-xs text-muted-foreground" data-layout-status>
          {t("layoutEditor.posLine", {
            slot: elementLabel(active),
            x: active.x.toFixed(1),
            y: active.y.toFixed(1),
            w: active.w.toFixed(1),
            h: active.h.toFixed(1),
            px: `${px(active.x, canvasWidth)},${px(active.y, canvasHeight)}`,
            size: `${px(active.w, canvasWidth)}×${px(active.h, canvasHeight)}`,
            canvas: `${canvasWidth}×${canvasHeight}`,
            layer: activeIndex + 1,
            layers: elements.length,
          })}
        </div>
      ) : null}
    </div>
  );
}
