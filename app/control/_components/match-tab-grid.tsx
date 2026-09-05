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
import { ChevronDown, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import DisplayPage from "@/app/display/page";
import {
  DEFAULT_MATCH_TAB_LAYOUT,
  isMatchTabPanelId,
  moveMatchTabPanel,
  resolveHydratedMatchTabLayout,
  sanitizeMatchTabLayout,
  saveMatchTabLayout,
  type MatchTabColumn,
  type MatchTabLayoutState,
  type MatchTabPanelId,
} from "@/lib/control-match-layout";

type PanelDragPayload = { id: MatchTabPanelId; column: MatchTabColumn };

let activePanelDrag: PanelDragPayload | null = null;

function writePanelDrag(e: DragEvent, payload: PanelDragPayload) {
  activePanelDrag = payload;
  const raw = JSON.stringify(payload);
  e.dataTransfer.setData("application/x-stadium-panel", payload.id);
  e.dataTransfer.setData("application/x-stadium-column", payload.column);
  e.dataTransfer.setData("text/plain", raw);
  e.dataTransfer.effectAllowed = "move";
}

function readPanelDrag(e: DragEvent): PanelDragPayload | null {
  const raw = e.dataTransfer.getData("text/plain");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as PanelDragPayload;
      if (isMatchTabPanelId(parsed.id) && isMatchTabColumn(parsed.column)) return parsed;
    } catch {
      /* fallback */
    }
  }
  const id = e.dataTransfer.getData("application/x-stadium-panel");
  const column = e.dataTransfer.getData("application/x-stadium-column");
  if (isMatchTabPanelId(id) && isMatchTabColumn(column)) return { id, column };
  return activePanelDrag;
}

function isMatchTabColumn(x: unknown): x is MatchTabColumn {
  return x === "left" || x === "center" || x === "right";
}

function ColumnTopDropZone({
  column,
  setLayout,
}: {
  column: MatchTabColumn;
  setLayout: Dispatch<SetStateAction<MatchTabLayoutState>>;
}) {
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
    const drag = readPanelDrag(e);
    if (!drag) return;
    setLayout((prev) => moveMatchTabPanel(prev, drag.id, drag.column, column, { atStart: true }));
    activePanelDrag = null;
  };

  return (
    <div
      className={cn(
        "shrink-0 min-h-2 rounded-md border border-dashed transition-colors",
        active ? "border-primary/50 bg-primary/15" : "border-transparent",
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      title="Sleep hier om bovenaan in deze kolom te zetten"
      aria-label="Dropzone bovenaan kolom"
    />
  );
}

function LayoutPanelWrapper({
  id,
  column,
  layout,
  setLayout,
  children,
}: {
  id: MatchTabPanelId;
  column: MatchTabColumn;
  layout: MatchTabLayoutState;
  setLayout: Dispatch<SetStateAction<MatchTabLayoutState>>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const collapsed = !!layout.collapsed[id];
  const title = t(`panels.${id}`);

  const onDragStart = (e: DragEvent) => {
    writePanelDrag(e, { id, column });
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
    e.stopPropagation();
    const drag = readPanelDrag(e);
    if (!drag || drag.id === id) return;
    setLayout((prev) => moveMatchTabPanel(prev, drag.id, drag.column, column, { before: id }));
    activePanelDrag = null;
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
          onDragEnd={() => {
            activePanelDrag = null;
          }}
          className="cursor-grab active:cursor-grabbing touch-none py-1.5 px-1.5 -ml-1 rounded-md hover:bg-muted text-foreground/70 will-change-transform"
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
    <div className="overflow-hidden rounded-xl border border-border bg-card">
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

function BetweenPanelDropZone({
  column,
  afterId,
  setLayout,
}: {
  column: MatchTabColumn;
  afterId: MatchTabPanelId;
  setLayout: Dispatch<SetStateAction<MatchTabLayoutState>>;
}) {
  const [active, setActive] = useState(false);
  return (
    <div
      className={cn(
        "shrink-0 min-h-3 rounded-md border border-dashed transition-colors",
        active ? "border-primary/60 bg-primary/20" : "border-transparent",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setActive(true);
      }}
      onDragLeave={(e) => {
        const rel = e.relatedTarget as Node | null;
        if (rel && e.currentTarget.contains(rel)) return;
        setActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setActive(false);
        const drag = readPanelDrag(e);
        if (!drag || drag.id === afterId) return;
        setLayout((prev) => moveMatchTabPanel(prev, drag.id, drag.column, column, { after: afterId }));
        activePanelDrag = null;
      }}
    />
  );
}

function Column({
  column,
  order,
  layout,
  setLayout,
  panels,
}: {
  column: MatchTabColumn;
  order: MatchTabPanelId[];
  layout: MatchTabLayoutState;
  setLayout: Dispatch<SetStateAction<MatchTabLayoutState>>;
  panels: Partial<Record<MatchTabPanelId, ReactNode>>;
}) {
  const ids = order.filter((id) => panels[id] != null);
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2 overflow-x-hidden lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
      <ColumnTopDropZone column={column} setLayout={setLayout} />
      <div className="flex min-w-0 flex-col gap-1 pb-2">
        {ids.map((id) => (
          <div key={id} className="flex min-w-0 flex-col">
            <LayoutPanelWrapper id={id} column={column} layout={layout} setLayout={setLayout}>
              {panels[id]}
            </LayoutPanelWrapper>
            <BetweenPanelDropZone column={column} afterId={id} setLayout={setLayout} />
          </div>
        ))}
      </div>
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-[11px] text-muted-foreground">
          {t("shell.layoutHint")}
        </p>
        <button
          type="button"
          onClick={resetLayout}
          className="shrink-0 text-xs text-muted-foreground underline hover:text-foreground"
        >
          {t("shell.resetLayout")}
        </button>
      </div>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-[minmax(260px,0.9fr)_minmax(320px,1.25fr)_minmax(260px,0.9fr)] lg:overflow-hidden">
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
