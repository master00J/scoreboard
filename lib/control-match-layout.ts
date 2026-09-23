export type MatchTabPanelId =
  | "music"
  | "timer"
  | "display"
  | "sponsor-hud"
  | "sponsor-overview"
  | "sponsor-timeline"
  | "player-intro"
  | "external"
  | "preview"
  | "match-live"
  | "event-log"
  | "match-info";

export type MatchTabColumn = "left" | "center" | "right";

export type MatchTabColumnWeights = {
  left: number;
  center: number;
  right: number;
};

export type MatchTabLayoutState = {
  orderLeft: MatchTabPanelId[];
  orderCenter: MatchTabPanelId[];
  orderRight: MatchTabPanelId[];
  collapsed: Partial<Record<MatchTabPanelId, boolean>>;
  columnWeights: MatchTabColumnWeights;
  panelHeights: Partial<Record<MatchTabPanelId, number>>;
};

/** Ongeveer de oude grid: 0.92fr / 0.68fr / 1.1fr. */
export const DEFAULT_COLUMN_WEIGHTS: MatchTabColumnWeights = {
  left: 34,
  center: 25,
  right: 41,
};

export const MIN_COLUMN_WEIGHT = 18;
export const MAX_COLUMN_WEIGHT = 64;
export const MIN_PANEL_HEIGHT = 140;
export const MAX_PANEL_HEIGHT = 1400;

const STORAGE_KEY = "stadium-control-match-tab-layout-v1";

const LEGACY_DEFAULT_MATCH_TAB_LAYOUT: MatchTabLayoutState = {
  orderLeft: [
    "timer",
    "display",
    "sponsor-hud",
    "sponsor-overview",
    "sponsor-timeline",
    "player-intro",
    "external",
  ],
  orderCenter: ["preview", "match-live", "event-log"],
  orderRight: ["match-info"],
  collapsed: {},
  columnWeights: { ...DEFAULT_COLUMN_WEIGHTS },
  panelHeights: {},
};

export const DEFAULT_MATCH_TAB_LAYOUT: MatchTabLayoutState = {
  orderLeft: ["timer", "match-live", "music"],
  orderCenter: [
    "sponsor-hud",
    "player-intro",
    "event-log",
    "sponsor-overview",
    "sponsor-timeline",
    "external",
  ],
  orderRight: ["preview", "display", "match-info"],
  collapsed: {},
  columnWeights: { ...DEFAULT_COLUMN_WEIGHTS },
  panelHeights: {},
};

const ALL_PANEL_IDS: MatchTabPanelId[] = [
  "music",
  "timer",
  "display",
  "sponsor-hud",
  "sponsor-overview",
  "sponsor-timeline",
  "player-intro",
  "external",
  "preview",
  "match-live",
  "event-log",
  "match-info",
];

export function isMatchTabPanelId(x: unknown): x is MatchTabPanelId {
  return typeof x === "string" && (ALL_PANEL_IDS as string[]).includes(x);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeColumnWeights(raw?: Partial<MatchTabColumnWeights> | null): MatchTabColumnWeights {
  const left = Math.max(0, finiteNumber(raw?.left, DEFAULT_COLUMN_WEIGHTS.left));
  const center = Math.max(0, finiteNumber(raw?.center, DEFAULT_COLUMN_WEIGHTS.center));
  const right = Math.max(0, finiteNumber(raw?.right, DEFAULT_COLUMN_WEIGHTS.right));
  const sum = left + center + right;
  if (sum <= 0) return { ...DEFAULT_COLUMN_WEIGHTS };
  let nextLeft = Math.round((left / sum) * 100);
  let nextCenter = Math.round((center / sum) * 100);
  let nextRight = 100 - nextLeft - nextCenter;
  const clampCol = (n: number) => Math.min(MAX_COLUMN_WEIGHT, Math.max(MIN_COLUMN_WEIGHT, n));
  nextLeft = clampCol(nextLeft);
  nextCenter = clampCol(nextCenter);
  nextRight = clampCol(nextRight);
  const clampedSum = nextLeft + nextCenter + nextRight;
  if (clampedSum === 100) return { left: nextLeft, center: nextCenter, right: nextRight };
  const scale = 100 / clampedSum;
  nextLeft = Math.round(nextLeft * scale);
  nextCenter = Math.round(nextCenter * scale);
  nextRight = 100 - nextLeft - nextCenter;
  return {
    left: clampCol(nextLeft),
    center: clampCol(nextCenter),
    right: Math.max(MIN_COLUMN_WEIGHT, 100 - clampCol(nextLeft) - clampCol(nextCenter)),
  };
}

export function nudgeColumnPair(
  weights: MatchTabColumnWeights,
  grow: MatchTabColumn,
  shrink: MatchTabColumn,
  dPct: number,
): MatchTabColumnWeights {
  const next = { ...normalizeColumnWeights(weights) };
  if (grow === shrink || !Number.isFinite(dPct) || dPct === 0) return next;
  const nextGrow = Math.min(MAX_COLUMN_WEIGHT, Math.max(MIN_COLUMN_WEIGHT, next[grow] + dPct));
  const wanted = nextGrow - next[grow];
  const nextShrink = Math.min(MAX_COLUMN_WEIGHT, Math.max(MIN_COLUMN_WEIGHT, next[shrink] - wanted));
  const applied = next[shrink] - nextShrink;
  next[grow] = Math.round((next[grow] + applied) * 10) / 10;
  next[shrink] = Math.round(nextShrink * 10) / 10;
  return normalizeColumnWeights(next);
}

export function sanitizePanelHeights(raw: unknown): Partial<Record<MatchTabPanelId, number>> {
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<Record<MatchTabPanelId, number>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isMatchTabPanelId(key) || typeof value !== "number" || !Number.isFinite(value)) continue;
    out[key] = Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, Math.round(value)));
  }
  return out;
}

export function clampPanelHeight(value: number): number {
  if (!Number.isFinite(value)) return MIN_PANEL_HEIGHT;
  return Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, Math.round(value)));
}

function normalizeSavedOrder(saved: unknown): MatchTabPanelId[] {
  if (!Array.isArray(saved)) return [];
  const picked = saved.filter(isMatchTabPanelId);
  const seen = new Set<MatchTabPanelId>();
  const out: MatchTabPanelId[] = [];
  for (const id of picked) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
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
    columnWeights: normalizeColumnWeights(layout.columnWeights),
    panelHeights: sanitizePanelHeights(layout.panelHeights),
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

function layoutOrdersEqual(a: MatchTabLayoutState, b: MatchTabLayoutState): boolean {
  return (
    JSON.stringify(a.orderLeft) === JSON.stringify(b.orderLeft) &&
    JSON.stringify(a.orderCenter) === JSON.stringify(b.orderCenter) &&
    JSON.stringify(a.orderRight) === JSON.stringify(b.orderRight)
  );
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
            Object.entries(p.collapsed).filter(([k, v]) => isMatchTabPanelId(k) && typeof v === "boolean"),
          ) as Partial<Record<MatchTabPanelId, boolean>>)
        : {};
    const orderLeft = normalizeSavedOrder(p.orderLeft);
    const orderCenter = normalizeSavedOrder(p.orderCenter);
    const orderRight = normalizeSavedOrder(p.orderRight);
    if (orderLeft.length === 0 && orderCenter.length === 0 && orderRight.length === 0) {
      return DEFAULT_MATCH_TAB_LAYOUT;
    }
    const parsed = sanitizeMatchTabLayout({
      orderLeft,
      orderCenter,
      orderRight,
      collapsed,
      columnWeights: normalizeColumnWeights(p.columnWeights),
      panelHeights: sanitizePanelHeights(p.panelHeights),
    });
    if (layoutOrdersEqual(parsed, sanitizeMatchTabLayout(LEGACY_DEFAULT_MATCH_TAB_LAYOUT))) {
      return { ...DEFAULT_MATCH_TAB_LAYOUT, collapsed: parsed.collapsed };
    }
    return parsed;
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

export function matchTabColumnKey(
  column: MatchTabColumn,
): keyof Pick<MatchTabLayoutState, "orderLeft" | "orderCenter" | "orderRight"> {
  return column === "left" ? "orderLeft" : column === "center" ? "orderCenter" : "orderRight";
}

export function reorderPanelBefore(
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

export function reorderPanelAfter(
  order: MatchTabPanelId[],
  dragged: MatchTabPanelId,
  afterId: MatchTabPanelId,
): MatchTabPanelId[] {
  if (dragged === afterId) return order;
  const rest = order.filter((x) => x !== dragged);
  const ti = rest.indexOf(afterId);
  if (ti < 0) return [...rest, dragged];
  rest.splice(ti + 1, 0, dragged);
  return rest;
}

export function insertPanelFirst(order: MatchTabPanelId[], dragged: MatchTabPanelId): MatchTabPanelId[] {
  return [dragged, ...order.filter((x) => x !== dragged)];
}

export function moveMatchTabPanel(
  layout: MatchTabLayoutState,
  dragged: MatchTabPanelId,
  fromCol: MatchTabColumn,
  toCol: MatchTabColumn,
  place: { before?: MatchTabPanelId; after?: MatchTabPanelId; atStart?: boolean },
): MatchTabLayoutState {
  const fromKey = matchTabColumnKey(fromCol);
  const toKey = matchTabColumnKey(toCol);
  const nextFrom = layout[fromKey].filter((x) => x !== dragged);
  const baseTo = fromCol === toCol ? nextFrom : layout[toKey].filter((x) => x !== dragged);
  let nextTo = baseTo;
  if (place.atStart) nextTo = insertPanelFirst(baseTo, dragged);
  else if (place.after) nextTo = reorderPanelAfter(baseTo, dragged, place.after);
  else if (place.before) nextTo = reorderPanelBefore(baseTo, dragged, place.before);
  else nextTo = [...baseTo, dragged];

  if (fromCol === toCol) {
    return { ...layout, [toKey]: nextTo };
  }
  return { ...layout, [fromKey]: nextFrom, [toKey]: nextTo };
}

export const MATCH_TAB_PANEL_LABELS: Record<MatchTabPanelId, string> = {
  music: "Muziek",
  timer: "Timer",
  display: "Display & modus",
  "sponsor-hud": "Sponsor HUD",
  "sponsor-overview": "Sponsors live",
  "sponsor-timeline": "Sponsor timeline",
  "player-intro": "Speler-intro",
  external: "Externe capture",
  preview: "Live preview",
  "match-live": "Wedstrijd live",
  "event-log": "Logboek",
  "match-info": "Wedstrijd",
};
