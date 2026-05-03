"use client";

import { useEffect, useState, type ReactNode, type DragEvent } from "react";
import { ChevronDown, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import DisplayPage from "@/app/display/page";
import {
  DEFAULT_MATCH_TAB_LAYOUT,
  loadMatchTabLayout,
  saveMatchTabLayout,
  MATCH_TAB_PANEL_LABELS,
  type MatchTabLayoutState,
  type MatchTabPanelId,
} from "@/lib/control-match-layout";

function reorderBefore(
  order: MatchTabPanelId[],
  dragged: MatchTabPanelId,
  beforeId: MatchTabPanelId,
): MatchTabPanelId[] {
  if (dragged === beforeId) return order;
  const rest = order.filter((x) => x !== dragged);
  const ti = rest.indexOf(beforeId);
  if (ti < 0) return order;
  rest.splice(ti, 0, dragged);
  return rest;
}

function colToKey(column: "left" | "center" | "right"): keyof Pick<
  MatchTabLayoutState,
  "orderLeft" | "orderCenter" | "orderRight"
> {
  return column === "left" ? "orderLeft" : column === "center" ? "orderCenter" : "orderRight";
}

function LayoutPanelWrapper({
  id,
  column,
  layout,
  setLayout,
  children,
}: {
  id: MatchTabPanelId;
  column: "left" | "center" | "right";
  layout: MatchTabLayoutState;
  setLayout: React.Dispatch<React.SetStateAction<MatchTabLayoutState>>;
  children: ReactNode;
}) {
  const collapsed = !!layout.collapsed[id];
  const title = MATCH_TAB_PANEL_LABELS[id];

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData("application/x-stadium-panel", id);
    e.dataTransfer.setData("application/x-stadium-column", column);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const dragged = e.dataTransfer.getData("application/x-stadium-panel") as MatchTabPanelId;
    const fromCol = e.dataTransfer.getData("application/x-stadium-column") as
      | "left"
      | "center"
      | "right";
    if (!dragged || dragged === id) return;
    if (fromCol !== "left" && fromCol !== "center" && fromCol !== "right") return;

    const toKey = colToKey(column);
    const fromKey = colToKey(fromCol);

    setLayout((prev) => {
      if (fromCol === column) {
        return { ...prev, [toKey]: reorderBefore(prev[toKey], dragged, id) };
      }
      const fromOrder = prev[fromKey].filter((x) => x !== dragged);
      const toOrder = [...prev[toKey].filter((x) => x !== dragged)];
      const ti = toOrder.indexOf(id);
      if (ti >= 0) {
        toOrder.splice(ti, 0, dragged);
      } else {
        toOrder.push(dragged);
      }
      return { ...prev, [fromKey]: fromOrder, [toKey]: toOrder };
    });
  };

  const toggle = () =>
    setLayout((p) => ({
      ...p,
      collapsed: { ...p.collapsed, [id]: !p.collapsed[id] },
    }));

  return (
    <div className="min-w-0 flex flex-col gap-1" onDragOver={onDragOver} onDrop={onDrop}>
      <div className="flex items-center gap-2 px-0.5 text-muted-foreground select-none">
        <span
          draggable
          onDragStart={onDragStart}
          className="cursor-grab active:cursor-grabbing touch-none p-0.5 rounded hover:bg-muted text-foreground/70"
          aria-label="Versleep om volgorde te wijzigen"
        >
          <GripVertical className="size-4" />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80 flex-1 truncate">
          {title}
        </span>
        <button
          type="button"
          className="p-1 rounded hover:bg-muted shrink-0 text-foreground"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Uitklappen" : "Inklappen"}
        >
          <ChevronDown className={cn("size-4 transition-transform", collapsed && "-rotate-90")} />
        </button>
      </div>
      {!collapsed && <div className="min-w-0">{children}</div>}
    </div>
  );
}

function LivePreviewPanel({ embedInControl }: { embedInControl?: boolean }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-secondary/50">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Live preview</div>
        <div className="text-xs text-muted-foreground">1920 × 1080</div>
      </div>
      <div className="relative aspect-video w-full bg-black">
        <DisplayPage embedInControl={embedInControl} />
      </div>
    </div>
  );
}

function Column({
  column,
  order,
  layout,
  setLayout,
  panels,
}: {
  column: "left" | "center" | "right";
  order: MatchTabPanelId[];
  layout: MatchTabLayoutState;
  setLayout: React.Dispatch<React.SetStateAction<MatchTabLayoutState>>;
  panels: Partial<Record<MatchTabPanelId, ReactNode>>;
}) {
  const ids = order.filter((id) => panels[id] != null);
  return (
    <div className="flex flex-col gap-4 min-w-0">
      {ids.map((id) => (
        <LayoutPanelWrapper key={id} id={id} column={column} layout={layout} setLayout={setLayout}>
          {panels[id]}
        </LayoutPanelWrapper>
      ))}
    </div>
  );
}

export function MatchTabGrid({
  panels,
}: {
  /** optioneel: ontbrekende panels worden niet getoond maar blijven in opgeslagen volgorde */
  panels: Partial<Record<MatchTabPanelId, ReactNode>>;
}) {
  const [layout, setLayout] = useState<MatchTabLayoutState>(DEFAULT_MATCH_TAB_LAYOUT);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setLayout(loadMatchTabLayout());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveMatchTabLayout(layout);
  }, [layout, hydrated]);

  const resetLayout = () => setLayout(DEFAULT_MATCH_TAB_LAYOUT);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground max-w-xl">
          Versleep een blok aan het grip-icoon om de volgorde te wijzigen (ook naar een andere kolom).
          Het pijltje klapt een sectie in of uit.
        </p>
        <button
          type="button"
          onClick={resetLayout}
          className="text-xs text-muted-foreground underline hover:text-foreground shrink-0"
        >
          Standaard lay-out
        </button>
      </div>
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-[minmax(320px,26vw)_minmax(0,1fr)_minmax(320px,26vw)]">
        <Column
          column="left"
          order={layout.orderLeft}
          layout={layout}
          setLayout={setLayout}
          panels={panels}
        />
        <Column
          column="center"
          order={layout.orderCenter}
          layout={layout}
          setLayout={setLayout}
          panels={panels}
        />
        <Column
          column="right"
          order={layout.orderRight}
          layout={layout}
          setLayout={setLayout}
          panels={panels}
        />
      </div>
    </div>
  );
}

export { LivePreviewPanel };
