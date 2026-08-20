"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LAYOUT_SLOT_IDS,
  SLOT_PRESETS,
  normalizeSlot,
  type LayoutSlot,
  type LayoutSlotId,
  type ScoreboardSlots,
} from "@/lib/scoreboard-theme";

const SLOT_TONE: Record<LayoutSlotId, string> = {
  home: "border-sky-400 bg-sky-500/25",
  away: "border-rose-400 bg-rose-500/25",
  clock: "border-emerald-400 bg-emerald-500/25",
  sponsor: "border-amber-400 bg-amber-500/20",
};

type Drag =
  | { kind: "move"; id: LayoutSlotId; startX: number; startY: number; slot: LayoutSlot }
  | { kind: "resize"; id: LayoutSlotId; startX: number; startY: number; slot: LayoutSlot };

export function SetupScoreboardPlacer({
  slots,
  onChange,
}: {
  slots: ScoreboardSlots;
  onChange: (slots: ScoreboardSlots) => void;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<LayoutSlotId>("sponsor");
  const dragRef = useRef<Drag | null>(null);

  function apply(id: LayoutSlotId, next: LayoutSlot) {
    onChange({ ...slots, [id]: normalizeSlot(next, slots[id]) });
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
      apply(drag.id, { ...drag.slot, x: drag.slot.x + dx, y: drag.slot.y + dy });
    } else if (drag.id === "sponsor") {
      const side = Math.max(drag.slot.w + dx, drag.slot.h + dy);
      apply(drag.id, { ...drag.slot, w: side, h: side });
    } else {
      apply(drag.id, { ...drag.slot, w: drag.slot.w + dx, h: drag.slot.h + dy });
    }
  }

  function endDrag() {
    dragRef.current = null;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {SLOT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/50"
            onClick={() => onChange(preset.slots)}
          >
            {t(`setup.themePreset_${preset.id}`)}
          </button>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">{t("setup.themePlacerHelp")}</p>

      <div
        ref={canvasRef}
        className="relative w-full overflow-hidden rounded-xl border border-border bg-[#050607]"
        style={{ aspectRatio: "16 / 9", touchAction: "none" }}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {LAYOUT_SLOT_IDS.map((id) => {
          const slot = slots[id];
          const active = selected === id;
          return (
            <div
              key={id}
              className={`absolute cursor-grab rounded-md border-2 ${SLOT_TONE[id]} ${active ? "z-20 ring-2 ring-white/70" : "z-10"}`}
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
              <div className="px-2 pt-1 text-xs font-bold uppercase tracking-wide text-white drop-shadow">
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

      <div className="text-xs text-muted-foreground">
        {t("setup.themeSlotHint", {
          slot: t(`setup.themeSlot_${selected}`),
        })}
      </div>
    </div>
  );
}
