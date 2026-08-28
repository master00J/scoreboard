"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  GripVertical,
  LayoutDashboard,
  PanelRightOpen,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import DisplayPage from "@/app/display/page";
import {
  DEFAULT_MATCH_TAB_LAYOUT,
  resolveHydratedMatchTabLayout,
  sanitizeMatchTabLayout,
  saveMatchTabLayout,
  type MatchTabLayoutState,
  type MatchTabPanelId,
} from "@/lib/control-match-layout";

const WORKSPACE_MODE_KEY = "stadium-control-workspace-mode-v1";
const QUICK_PANEL_IDS: MatchTabPanelId[] = ["player-intro", "sponsor-hud", "event-log"];
const ADVANCED_PANEL_IDS: MatchTabPanelId[] = [
  "sponsor-hud",
  "sponsor-overview",
  "sponsor-timeline",
  "player-intro",
  "external",
  "event-log",
  "match-info",
];

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

/** Zet `dragged` op index 0 (ook bij slepen naar andere kolom). */
function insertFirst(order: MatchTabPanelId[], dragged: MatchTabPanelId): MatchTabPanelId[] {
  const rest = order.filter((x) => x !== dragged);
  return [dragged, ...rest];
}

/** Zet `dragged` als laatste module in de gekozen kolom. */
function insertLast(order: MatchTabPanelId[], dragged: MatchTabPanelId): MatchTabPanelId[] {
  return [...order.filter((x) => x !== dragged), dragged];
}

function colToKey(column: "left" | "center" | "right"): keyof Pick<
  MatchTabLayoutState,
  "orderLeft" | "orderCenter" | "orderRight"
> {
  return column === "left" ? "orderLeft" : column === "center" ? "orderCenter" : "orderRight";
}

function ColumnTopDropZone({
  column,
  setLayout,
  placement = "top",
}: {
  column: "left" | "center" | "right";
  setLayout: Dispatch<SetStateAction<MatchTabLayoutState>>;
  placement?: "top" | "bottom";
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setActive(true);
  };

  const onDragLeave = (e: DragEvent) => {
    const rel = e.relatedTarget as Node | null;
    if (rel && e.currentTarget.contains(rel)) return;
    setActive(false);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActive(false);
    const dragged = e.dataTransfer.getData("application/x-stadium-panel") as MatchTabPanelId;
    const fromCol = e.dataTransfer.getData("application/x-stadium-column") as
      | "left"
      | "center"
      | "right";
    if (!dragged) return;
    if (fromCol !== "left" && fromCol !== "center" && fromCol !== "right") return;

    const toKey = colToKey(column);
    const fromKey = colToKey(fromCol);

    setLayout((prev) => {
      const place = placement === "top" ? insertFirst : insertLast;
      if (fromCol === column) {
        return { ...prev, [toKey]: place(prev[toKey], dragged) };
      }
      const fromOrder = prev[fromKey].filter((x) => x !== dragged);
      const toOrder = place(
        prev[toKey].filter((x) => x !== dragged),
        dragged,
      );
      return { ...prev, [fromKey]: fromOrder, [toKey]: toOrder };
    });
  };

  return (
    <div
      className={cn(
        "shrink-0 rounded-md border border-dashed transition-colors",
        placement === "bottom" ? "flex min-h-16 flex-1 items-center justify-center" : "min-h-2",
        active
          ? "border-primary/70 bg-primary/15 text-primary"
          : placement === "bottom"
            ? "border-border/40 text-muted-foreground/60"
            : "border-transparent",
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      title={placement === "bottom" ? t("shell.dropAtBottom") : t("shell.dropAtTop")}
      aria-label={placement === "bottom" ? t("shell.dropAtBottom") : t("shell.dropAtTop")}
    >
      {placement === "bottom" && (
        <span className="pointer-events-none px-3 text-center text-[10px] font-semibold uppercase tracking-wider">
          {t("shell.dropAtBottom")}
        </span>
      )}
    </div>
  );
}

function LayoutPanelWrapper({
  id,
  column,
  layout,
  setLayout,
  children,
  editable = true,
}: {
  id: MatchTabPanelId;
  column: "left" | "center" | "right";
  layout: MatchTabLayoutState;
  setLayout: Dispatch<SetStateAction<MatchTabLayoutState>>;
  children: ReactNode;
  editable?: boolean;
}) {
  const { t } = useTranslation();
  const collapsed = !!layout.collapsed[id];
  const title = t(`panels.${id}`);

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData("application/x-stadium-panel", id);
    e.dataTransfer.setData("application/x-stadium-column", column);
    e.dataTransfer.effectAllowed = "move";
    const img = new Image();
    img.src =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    try {
      e.dataTransfer.setDragImage(img, 0, 0);
    } catch {
      /* ignore */
    }
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
    <div
      className="flex min-w-0 flex-col gap-1"
      onDragOver={editable ? onDragOver : undefined}
      onDrop={editable ? onDrop : undefined}
    >
      <div className="flex items-center gap-2 px-0.5 text-muted-foreground select-none">
        {editable && (
          <span
            draggable
            onDragStart={onDragStart}
            className="cursor-grab touch-none rounded-md px-1 py-1.5 text-foreground/70 will-change-transform hover:bg-muted active:cursor-grabbing"
            aria-label={t("shell.dragPanel")}
          >
            <GripVertical className="size-4" />
          </span>
        )}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80 flex-1 truncate">
          {title}
        </span>
        <button
          type="button"
          className="p-1 rounded hover:bg-muted shrink-0 text-foreground"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("shell.expand") : t("shell.collapse")}
        >
          <ChevronDown className={cn("size-4 transition-transform", collapsed && "-rotate-90")} />
        </button>
      </div>
      {!collapsed && <div className="min-w-0">{children}</div>}
    </div>
  );
}

function LivePreviewPanel({
  embedInControl,
  active = true,
}: {
  embedInControl?: boolean;
  active?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="w-full shrink-0 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-secondary/50 px-4 py-2">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          {t("shell.livePreview")}
        </div>
        <div className="text-xs text-muted-foreground">1920 × 1080</div>
      </div>
      {/* Volle kolombreedte (16:9); kolom scrollt als de preview hoog wordt */}
      <div className="relative aspect-video w-full bg-black">
        {active ? (
          <DisplayPage embedInControl={embedInControl} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/45">
            {t("shell.previewPaused")}
          </div>
        )}
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
  editable = true,
}: {
  column: "left" | "center" | "right";
  order: MatchTabPanelId[];
  layout: MatchTabLayoutState;
  setLayout: Dispatch<SetStateAction<MatchTabLayoutState>>;
  panels: Partial<Record<MatchTabPanelId, ReactNode>>;
  editable?: boolean;
}) {
  const ids = order.filter((id) => panels[id] != null);
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2 overflow-x-hidden lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
      {editable && <ColumnTopDropZone column={column} setLayout={setLayout} />}
      <div className="flex min-w-0 flex-col gap-3 pb-2">
        {ids.map((id) => (
          <LayoutPanelWrapper
            key={id}
            id={id}
            column={column}
            layout={layout}
            setLayout={setLayout}
            editable={editable}
          >
            {panels[id]}
          </LayoutPanelWrapper>
        ))}
      </div>
      {editable && (
        <ColumnTopDropZone column={column} setLayout={setLayout} placement="bottom" />
      )}
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
  const [workspaceMode, setWorkspaceMode] = useState<"live" | "customize">("live");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedPanel, setAdvancedPanel] = useState<MatchTabPanelId>("event-log");
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutRef = useRef(layout);
  const hydratedRef = useRef(false);
  layoutRef.current = layout;
  hydratedRef.current = hydrated;

  useEffect(() => {
    let initial = DEFAULT_MATCH_TAB_LAYOUT;
    if (typeof window !== "undefined") {
      const fileJson = window.electronAPI?.getMatchTabLayoutSnapshot?.() ?? null;
      initial = sanitizeMatchTabLayout(resolveHydratedMatchTabLayout(fileJson));
      const savedMode = window.localStorage.getItem(WORKSPACE_MODE_KEY);
      if (savedMode === "customize" || savedMode === "live") setWorkspaceMode(savedMode);
    }
    setLayout(initial);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const sanitized = sanitizeMatchTabLayout(layout);
    if (JSON.stringify(sanitized) !== JSON.stringify(layout)) {
      setLayout(sanitized);
    }
  }, [layout, hydrated]);

  useEffect(() => {
    if (!advancedOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAdvancedOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advancedOpen]);

  useEffect(() => {
    return () => {
      if (hydratedRef.current) {
        saveMatchTabLayout(layoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const flush = () => {
      if (hydratedRef.current) saveMatchTabLayout(layoutRef.current);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      saveDebounceRef.current = null;
      saveMatchTabLayout(layoutRef.current);
    }, 350);
    return () => {
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
        saveMatchTabLayout(layoutRef.current);
      }
    };
  }, [layout, hydrated]);

  const { t } = useTranslation();
  const resetLayout = () => setLayout(DEFAULT_MATCH_TAB_LAYOUT);
  const advancedIds = ADVANCED_PANEL_IDS.filter((id) => panels[id] != null);
  const currentAdvancedPanel = advancedIds.includes(advancedPanel)
    ? advancedPanel
    : (advancedIds[0] ?? "event-log");

  const selectWorkspaceMode = (mode: "live" | "customize") => {
    setWorkspaceMode(mode);
    setAdvancedOpen(false);
    try {
      window.localStorage.setItem(WORKSPACE_MODE_KEY, mode);
    } catch {
      /* ignore quota */
    }
  };

  const openAdvancedPanel = (id?: MatchTabPanelId) => {
    const next = id && advancedIds.includes(id) ? id : currentAdvancedPanel;
    setAdvancedPanel(next);
    setAdvancedOpen(true);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-card/70 p-2 shadow-sm backdrop-blur">
        <div className="inline-flex rounded-lg bg-background/70 p-1" role="group" aria-label={t("shell.workspaceModeLabel")}>
          <button
            type="button"
            aria-pressed={workspaceMode === "live"}
            onClick={() => selectWorkspaceMode("live")}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-bold transition-colors",
              workspaceMode === "live"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <LayoutDashboard className="size-4" />
            {t("shell.workspaceLive")}
          </button>
          <button
            type="button"
            aria-pressed={workspaceMode === "customize"}
            onClick={() => selectWorkspaceMode("customize")}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-bold transition-colors",
              workspaceMode === "customize"
                ? "bg-secondary text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <SlidersHorizontal className="size-4" />
            {t("shell.workspaceCustomize")}
          </button>
        </div>

        {workspaceMode === "live" ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
            <span className="hidden text-[11px] text-muted-foreground 2xl:inline">
              {t("shell.quickControls")}
            </span>
            {QUICK_PANEL_IDS.filter((id) => panels[id] != null).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => openAdvancedPanel(id)}
                className="h-8 rounded-md border border-border bg-background/70 px-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary/60 hover:bg-primary/10"
              >
                {t(`panels.${id}`)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => openAdvancedPanel()}
              className="inline-flex h-8 items-center gap-2 rounded-md bg-secondary px-3 text-xs font-bold text-secondary-foreground transition-colors hover:bg-secondary/70"
            >
              <PanelRightOpen className="size-4" />
              {t("shell.moreControls")}
              <span className="rounded bg-background/60 px-1.5 py-0.5 text-[10px] tabular-nums">
                {advancedIds.length}
              </span>
            </button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 px-1">
            <p className="max-w-2xl text-[11px] text-muted-foreground">{t("shell.layoutHint")}</p>
            <button
              type="button"
              onClick={resetLayout}
              className="shrink-0 text-xs font-medium text-primary hover:underline"
            >
              {t("shell.resetLayout")}
            </button>
          </div>
        )}
      </div>

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 overflow-y-auto xl:grid-cols-[minmax(390px,0.92fr)_minmax(300px,0.68fr)_minmax(460px,1.1fr)] xl:overflow-hidden">
        <Column
          column="left"
          order={layout.orderLeft}
          layout={layout}
          setLayout={setLayout}
          panels={panels}
          editable={workspaceMode === "customize"}
        />
        <Column
          column="center"
          order={layout.orderCenter}
          layout={layout}
          setLayout={setLayout}
          panels={panels}
          editable={workspaceMode === "customize"}
        />
        <Column
          column="right"
          order={layout.orderRight}
          layout={layout}
          setLayout={setLayout}
          panels={panels}
          editable={workspaceMode === "customize"}
        />
      </div>

      {workspaceMode === "live" && (
        <>
          <button
            type="button"
            aria-label={t("common.close")}
            tabIndex={advancedOpen ? 0 : -1}
            onClick={() => setAdvancedOpen(false)}
            className={cn(
              "absolute inset-0 z-20 bg-background/75 backdrop-blur-sm transition-opacity",
              advancedOpen ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          />
          <aside
            aria-hidden={!advancedOpen}
            className={cn(
              "absolute inset-y-0 right-0 z-30 flex w-full max-w-5xl flex-col overflow-hidden rounded-l-2xl border-l border-border bg-background shadow-2xl transition-transform duration-200",
              advancedOpen
                ? "visible translate-x-0"
                : "invisible pointer-events-none translate-x-full",
            )}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-5">
              <div>
                <div className="text-sm font-black text-foreground">{t("shell.moreControls")}</div>
                <div className="text-xs text-muted-foreground">{t("shell.moreControlsHint")}</div>
              </div>
              <button
                type="button"
                onClick={() => setAdvancedOpen(false)}
                className="grid size-10 place-items-center rounded-lg border border-border bg-background text-foreground hover:bg-muted"
                aria-label={t("common.close")}
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[190px_minmax(0,1fr)]">
              <nav className="flex gap-2 overflow-x-auto border-b border-border bg-card/60 p-3 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r">
                {advancedIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setAdvancedPanel(id)}
                    className={cn(
                      "shrink-0 rounded-lg px-3 py-2.5 text-left text-xs font-semibold transition-colors sm:w-full",
                      currentAdvancedPanel === id
                        ? "bg-primary text-primary-foreground"
                        : "bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {t(`panels.${id}`)}
                  </button>
                ))}
              </nav>
              <div className="min-h-0 min-w-0 overflow-y-auto p-3 sm:p-5">
                {advancedIds.map((id) => (
                  <div key={id} hidden={currentAdvancedPanel !== id}>
                    {panels[id]}
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

export { LivePreviewPanel };
