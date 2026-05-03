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
    return {
      orderLeft: normalizeOrder(DEFAULT_MATCH_TAB_LAYOUT.orderLeft, p.orderLeft),
      orderCenter: normalizeOrder(DEFAULT_MATCH_TAB_LAYOUT.orderCenter, p.orderCenter),
      orderRight: normalizeOrder(DEFAULT_MATCH_TAB_LAYOUT.orderRight, p.orderRight),
      collapsed,
    };
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
