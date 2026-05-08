export type MatchTabPanelId =
  | "timer"
  | "display"
  | "sponsor-hud"
  | "sponsor-overview"
  | "player-intro"
  | "external"
  | "preview"
  | "match-live"
  | "event-log"
  | "match-info";

export type MatchTabLayoutState = {
  orderLeft: MatchTabPanelId[];
  orderCenter: MatchTabPanelId[];
  orderRight: MatchTabPanelId[];
  collapsed: Partial<Record<MatchTabPanelId, boolean>>;
};

const STORAGE_KEY = "stadium-control-match-tab-layout-v1";

export const DEFAULT_MATCH_TAB_LAYOUT: MatchTabLayoutState = {
  orderLeft: [
    "timer",
    "display",
    "sponsor-hud",
    "sponsor-overview",
    "player-intro",
    "external",
  ],
  orderCenter: ["preview", "match-live", "event-log"],
  orderRight: ["match-info"],
  collapsed: {},
};

const ALL_PANEL_IDS: MatchTabPanelId[] = [
  "timer",
  "display",
  "sponsor-hud",
  "sponsor-overview",
  "player-intro",
  "external",
  "preview",
  "match-live",
  "event-log",
  "match-info",
];

function isPanelId(x: unknown): x is MatchTabPanelId {
  return typeof x === "string" && (ALL_PANEL_IDS as string[]).includes(x);
}

function normalizeOrder(defaultOrder: MatchTabPanelId[], saved: unknown): MatchTabPanelId[] {
  if (!Array.isArray(saved)) return defaultOrder;
  const picked = saved.filter(isPanelId);
  const seen = new Set<MatchTabPanelId>();
  const out: MatchTabPanelId[] = [];
  for (const id of picked) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of defaultOrder) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

/**
 * Eén paneel-id mag maar in één kolom voorkomen (anders dubbele HUD / capture / etc.).
 * Links → midden → rechts: eerste voorkomen wint.
 */
function dedupePanelsAcrossColumns(layout: MatchTabLayoutState): MatchTabLayoutState {
  const seen = new Set<MatchTabPanelId>();
  const uniq = (order: MatchTabPanelId[]) => {
    const out: MatchTabPanelId[] = [];
    for (const id of order) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  };
  return {
    ...layout,
    orderLeft: uniq(layout.orderLeft),
    orderCenter: uniq(layout.orderCenter),
    orderRight: uniq(layout.orderRight),
  };
}

/** Ontbrekende panelen weer toevoegen op hun standaardkolom (na dedupe). */
function appendMissingPanels(layout: MatchTabLayoutState): MatchTabLayoutState {
  const seen = new Set<MatchTabPanelId>([
    ...layout.orderLeft,
    ...layout.orderCenter,
    ...layout.orderRight,
  ]);
  const out: MatchTabLayoutState = {
    orderLeft: [...layout.orderLeft],
    orderCenter: [...layout.orderCenter],
    orderRight: [...layout.orderRight],
    collapsed: layout.collapsed,
  };
  for (const id of ALL_PANEL_IDS) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (DEFAULT_MATCH_TAB_LAYOUT.orderLeft.includes(id)) out.orderLeft.push(id);
    else if (DEFAULT_MATCH_TAB_LAYOUT.orderCenter.includes(id)) out.orderCenter.push(id);
    else out.orderRight.push(id);
  }
  return out;
}

export function loadMatchTabLayout(): MatchTabLayoutState {
  if (typeof window === "undefined") return DEFAULT_MATCH_TAB_LAYOUT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_MATCH_TAB_LAYOUT;
    const p = JSON.parse(raw) as Partial<MatchTabLayoutState>;
    const collapsed =
      p.collapsed && typeof p.collapsed === "object"
        ? (Object.fromEntries(
            Object.entries(p.collapsed).filter(([k, v]) => isPanelId(k) && typeof v === "boolean"),
          ) as Partial<Record<MatchTabPanelId, boolean>>)
        : {};
    return appendMissingPanels(
      dedupePanelsAcrossColumns({
        orderLeft: normalizeOrder(DEFAULT_MATCH_TAB_LAYOUT.orderLeft, p.orderLeft),
        orderCenter: normalizeOrder(DEFAULT_MATCH_TAB_LAYOUT.orderCenter, p.orderCenter),
        orderRight: normalizeOrder(DEFAULT_MATCH_TAB_LAYOUT.orderRight, p.orderRight),
        collapsed,
      }),
    );
  } catch {
    return DEFAULT_MATCH_TAB_LAYOUT;
  }
}

export function saveMatchTabLayout(layout: MatchTabLayoutState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* ignore quota */
  }
}

export const MATCH_TAB_PANEL_LABELS: Record<MatchTabPanelId, string> = {
  timer: "Timer",
  display: "Display & modus",
  "sponsor-hud": "Sponsor HUD",
  "sponsor-overview": "Sponsors live",
  "player-intro": "Speler-intro",
  external: "Externe capture",
  preview: "Live preview",
  "match-live": "Wedstrijd live",
  "event-log": "Logboek",
  "match-info": "Matchstatus",
};
