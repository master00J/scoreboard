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

/** Dedupe panelen over kolommen + ontbrekende ids terugzetten (laden, opslaan, runtime). */
export function sanitizeMatchTabLayout(layout: MatchTabLayoutState): MatchTabLayoutState {
  return appendMissingPanels(dedupePanelsAcrossColumns(layout));
}

function layoutsEqual(a: MatchTabLayoutState, b: MatchTabLayoutState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Kiest de beste startlay-out voor de control-app: Electron-userData-bestand én localStorage
 * worden meegenomen. Zo blijft een gepersonaliseerde lay-out behouden als het bestand ontbreekt,
 * leeg is, of ongeldige JSON bevat terwijl localStorage wél nog een geldige kopie heeft.
 */
export function resolveHydratedMatchTabLayout(electronFileJson: string | null): MatchTabLayoutState {
  const def = DEFAULT_MATCH_TAB_LAYOUT;
  const localRaw =
    typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
  const fromLocal = parseMatchTabLayoutJson(localRaw);
  const fileRaw = typeof electronFileJson === "string" && electronFileJson.trim() ? electronFileJson : null;
  const localCustom = !layoutsEqual(fromLocal, def);

  if (fileRaw) {
    const fromFile = parseMatchTabLayoutJson(fileRaw);
    const fileCustom = !layoutsEqual(fromFile, def);
    if (fileCustom) return fromFile;
    if (localCustom) return fromLocal;
    return fromFile;
  }
  if (localCustom) return fromLocal;
  return def;
}

/** Parseert opgeslagen JSON (localStorage of userData-bestand in Electron). */
export function parseMatchTabLayoutJson(raw: string | null): MatchTabLayoutState {
  if (typeof raw !== "string" || !raw.trim()) return DEFAULT_MATCH_TAB_LAYOUT;
  try {
    const p = JSON.parse(raw) as Partial<MatchTabLayoutState>;
    const collapsed =
      p.collapsed && typeof p.collapsed === "object"
        ? (Object.fromEntries(
            Object.entries(p.collapsed).filter(([k, v]) => isPanelId(k) && typeof v === "boolean"),
          ) as Partial<Record<MatchTabPanelId, boolean>>)
        : {};
    return sanitizeMatchTabLayout({
      orderLeft: normalizeOrder(DEFAULT_MATCH_TAB_LAYOUT.orderLeft, p.orderLeft),
      orderCenter: normalizeOrder(DEFAULT_MATCH_TAB_LAYOUT.orderCenter, p.orderCenter),
      orderRight: normalizeOrder(DEFAULT_MATCH_TAB_LAYOUT.orderRight, p.orderRight),
      collapsed,
    });
  } catch {
    return DEFAULT_MATCH_TAB_LAYOUT;
  }
}

export function loadMatchTabLayout(): MatchTabLayoutState {
  if (typeof window === "undefined") return DEFAULT_MATCH_TAB_LAYOUT;
  return parseMatchTabLayoutJson(localStorage.getItem(STORAGE_KEY));
}

export function saveMatchTabLayout(layout: MatchTabLayoutState): void {
  if (typeof window === "undefined") return;
  const json = JSON.stringify(sanitizeMatchTabLayout(layout));
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    /* ignore quota */
  }
  try {
    window.electronAPI?.persistMatchTabLayout?.(json);
  } catch {
    /* ignore */
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
