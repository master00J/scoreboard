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
  away: "border-rose-400",
  clock: "border-emerald-400",
  sponsor: "border-amber-400",
};

export type EditorSurface = "sponsor" | "full";

type DragId = LayoutSlotId | FullSlotId;

type Drag =
  | { kind: "move"; id: DragId; startX: number; startY: number; slot: LayoutSlot }
  | { kind: "resize"; id: DragId; startX: number; startY: number; slot: LayoutSlot };

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
  const [selected, setSelected] = useState<DragId>(surface === "full" ? "home" : "sponsor");
  const dragRef = useRef<Drag | null>(null);
  const slotIds = surface === "full" ? FULL_SLOT_IDS : LAYOUT_SLOT_IDS;

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
    if (drag.kind === "move") {
      applySlot(drag.id, { ...drag.slot, x: drag.slot.x + dx, y: drag.slot.y + dy });
    } else if (drag.id === "sponsor") {
      const side = Math.max(drag.slot.w + dx, drag.slot.h + dy);
      applySlot(drag.id, { ...drag.slot, w: side, h: side });
    } else {
      applySlot(drag.id, { ...drag.slot, w: drag.slot.w + dx, h: drag.slot.h + dy });
    }
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
      <p className="text-sm text-muted-foreground">
        {surface === "full" ? t("setup.themePlacerHelpFull") : t("setup.themePlacerHelp")}
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
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

          {slotIds.map((id) => {
            const slot = slots[id];
            const active = selected === id;
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
                <button
                  type="button"
                  aria-label={t("setup.themeResize")}
                  className="absolute bottom-1 right-1 h-4 w-4 cursor-se-resize rounded-sm bg-white/90"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    setSelected(id);
                    const p = pointerToPct(e);
                    dragRef.current = { kind: "resize", id, startX: p.x, startY: p.y, slot };
                  }}
                />
              </div>
            );
          })}
        </div>

        <div className="space-y-3 rounded-xl border border-border p-3">
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
          slot: t(`setup.themeSlot_${selected}`),
        })}
      </div>
    </div>
  );
}
