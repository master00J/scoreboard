/** Opgeslagen in AppSettings.scoreboardThemeJson (merge met defaults). */

export type LeftStripSegment = "home" | "timer" | "away";

export type ScoreboardLayoutMode = "auto" | "custom" | "left-l" | "full" | "bottom-strip";

export type LayoutSlotId = "home" | "away" | "clock" | "sponsor";

/** Positie op het LED-canvas, in procent (0–100). Onafhankelijk van resolutie. */
export type LayoutSlot = { x: number; y: number; w: number; h: number };

export type ScoreboardSlots = Record<LayoutSlotId, LayoutSlot>;

export const LAYOUT_SLOT_IDS: LayoutSlotId[] = ["home", "away", "clock", "sponsor"];

/**
 * Op een 16:9-LED-canvas is een vak 16:9 wanneer breedte% === hoogte%.
 * Grootste 16:9-rechthoek die in `area` past, gecentreerd.
 */
export function largestSixteenByNineSlot(area: LayoutSlot): LayoutSlot {
  const side = Math.min(area.w, area.h);
  return {
    x: area.x + (area.w - side) / 2,
    y: area.y + (area.h - side) / 2,
    w: side,
    h: side,
  };
}

export function slotIsSixteenByNine(slot: LayoutSlot): boolean {
  return slot.w === slot.h;
}

export const DEFAULT_SLOTS: ScoreboardSlots = {
  home: { x: 2, y: 6, w: 18, h: 42 },
  clock: { x: 38, y: 4, w: 24, h: 20 },
  away: { x: 80, y: 6, w: 18, h: 42 },
  sponsor: { x: 22, y: 26, w: 56, h: 56 },
};

export const SLOT_PRESETS: { id: string; slots: ScoreboardSlots }[] = [
  { id: "overlay", slots: DEFAULT_SLOTS },
  {
    id: "leftBar",
    slots: {
      home: { x: 0, y: 0, w: 16, h: 36 },
      clock: { x: 0, y: 36, w: 16, h: 22 },
      away: { x: 0, y: 58, w: 16, h: 42 },
      sponsor: largestSixteenByNineSlot({ x: 16, y: 0, w: 84, h: 100 }),
    },
  },
  {
    id: "topBar",
    slots: {
      home: { x: 0, y: 0, w: 28, h: 18 },
      clock: { x: 38, y: 0, w: 24, h: 18 },
      away: { x: 72, y: 0, w: 28, h: 18 },
      sponsor: largestSixteenByNineSlot({ x: 0, y: 18, w: 100, h: 82 }),
    },
  },
  {
    id: "bottomBar",
    slots: {
      sponsor: largestSixteenByNineSlot({ x: 0, y: 0, w: 100, h: 78 }),
      home: { x: 0, y: 78, w: 28, h: 22 },
      clock: { x: 38, y: 78, w: 24, h: 22 },
      away: { x: 72, y: 78, w: 28, h: 22 },
    },
  },
];

export type TeamStackOrder = "logo-name-score" | "name-logo-score" | "logo-score-name" | "score-name-logo";

export const SCOREBOARD_LAYOUT_MODES: ScoreboardLayoutMode[] = [
  "custom",
  "auto",
  "left-l",
  "full",
  "bottom-strip",
];

export const TEAM_STACK_ORDERS: TeamStackOrder[] = [
  "logo-name-score",
  "name-logo-score",
  "logo-score-name",
  "score-name-logo",
];

export type ScoreboardTheme = {
  /** Breedte linkse L-balk (px) */
  leftBarWidthPx?: number;
  /** Hoogte onderbalk (px); default = leftBarWidthPx */
  bottomBarHeightPx?: number;
  /** Frame: drie kleuren voor verticale gradient op balken */
  frameColorTop?: string;
  frameColorMid?: string;
  frameColorBot?: string;
  /** Achtergrond contentvlak (rechts) */
  contentAreaBg?: string;
  /** CSS font-family stack */
  fontFamily?: string;
  /** Volgorde blokken in linkerkolom */
  leftColumnOrder?: LeftStripSegment[];
  /** Linker L-layout */
  leftLogoPx?: number;
  leftScorePx?: number;
  leftTimerPx?: number;
  leftPeriodPx?: number;
  leftTimerBlockHeightPx?: number;
  /** Fullscreen scorebord */
  fullLogoPx?: number;
  fullScorePx?: number;
  fullTimerPx?: number;
  fullPeriodPx?: number;
  /** Vaste breedte middenkolom (timer + periode), px */
  fullCenterWidthPx?: number;
  /** Horizontale padding aan de teamzijden (px) */
  fullSidePaddingPx?: number;
  /** Verticale ruimte tussen logo, optionele naam en score (px) */
  fullTeamStackGapPx?: number;
  /** Ruimte tussen periode, klok en extratijd in het midden (px) */
  fullCenterStackGapPx?: number;
  /** Twee hex-cijfers (00–ff): alpha van de team-radialen op de achtergrond */
  fullTeamRadialAlphaHex?: string;
  fullShowPeriod?: boolean;
  fullShowAddedTime?: boolean;
  fullShowTeamNames?: boolean;
  fullTeamNamePx?: number;
  fullTeamNameUppercase?: boolean;
  /** Welk frame het stadionscherm gebruikt. auto = L naast sponsors, anders fullscreen. */
  layoutMode?: ScoreboardLayoutMode;
  /** Volgorde logo / naam / score op het fullscreen-scorebord. */
  fullTeamStackOrder?: TeamStackOrder;
  showLogos?: boolean;
  showScores?: boolean;
  showClock?: boolean;
  scoreColor?: string;
  teamNameColor?: string;
  /** Vrije plaatsing van thuis, uit, klok en sponsors (procenten). */
  slots?: ScoreboardSlots;
  /** Onderstrip (indien later gebruikt) */
  stripHeightPx?: number;
  stripLogoPx?: number;
  stripScorePx?: number;
  stripTimerPx?: number;
  stripPeriodPx?: number;
  timerRunningColor?: string;
  timerPausedColor?: string;
  /**
   * Als true: sponsorrotatie met budget start een nieuwe tellerronde zodra iedereen zijn quotum
   * heeft gehaald (doorlopende loop tot de fase wisselt). Zie ook playlist voor losse video-loops.
   */
  sponsorRepeatBudgetCycles?: boolean;
};

export type ResolvedScoreboardTheme = Required<
  Pick<
    ScoreboardTheme,
    | "leftBarWidthPx"
    | "bottomBarHeightPx"
    | "frameColorTop"
    | "frameColorMid"
    | "frameColorBot"
    | "contentAreaBg"
    | "fontFamily"
    | "leftColumnOrder"
    | "leftLogoPx"
    | "leftScorePx"
    | "leftTimerPx"
    | "leftPeriodPx"
    | "leftTimerBlockHeightPx"
    | "fullLogoPx"
    | "fullScorePx"
    | "fullTimerPx"
    | "fullPeriodPx"
    | "fullCenterWidthPx"
    | "fullSidePaddingPx"
    | "fullTeamStackGapPx"
    | "fullCenterStackGapPx"
    | "fullTeamRadialAlphaHex"
    | "fullShowPeriod"
    | "fullShowAddedTime"
    | "fullShowTeamNames"
    | "fullTeamNamePx"
    | "fullTeamNameUppercase"
    | "layoutMode"
    | "fullTeamStackOrder"
    | "showLogos"
    | "showScores"
    | "showClock"
    | "scoreColor"
    | "teamNameColor"
    | "slots"
    | "stripHeightPx"
    | "stripLogoPx"
    | "stripScorePx"
    | "stripTimerPx"
    | "stripPeriodPx"
    | "timerRunningColor"
    | "timerPausedColor"
  >
>;

const DEFAULT_ORDER: LeftStripSegment[] = ["home", "timer", "away"];

export const DEFAULT_SCOREBOARD_THEME: ResolvedScoreboardTheme = {
  leftBarWidthPx: 280,
  bottomBarHeightPx: 280,
  frameColorTop: "#dc2626",
  frameColorMid: "#b91c1c",
  frameColorBot: "#7f1d1d",
  contentAreaBg: "#050607",
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  leftColumnOrder: [...DEFAULT_ORDER],
  leftLogoPx: 160,
  leftScorePx: 160,
  leftTimerPx: 58,
  leftPeriodPx: 15,
  leftTimerBlockHeightPx: 200,
  fullLogoPx: 320,
  fullScorePx: 200,
  fullTimerPx: 132,
  fullPeriodPx: 22,
  fullCenterWidthPx: 520,
  fullSidePaddingPx: 32,
  fullTeamStackGapPx: 24,
  fullCenterStackGapPx: 12,
  fullTeamRadialAlphaHex: "2a",
  fullShowPeriod: true,
  fullShowAddedTime: true,
  fullShowTeamNames: false,
  fullTeamNamePx: 28,
  fullTeamNameUppercase: true,
  layoutMode: "auto",
  fullTeamStackOrder: "logo-name-score",
  showLogos: true,
  showScores: true,
  showClock: true,
  scoreColor: "#ffffff",
  teamNameColor: "rgba(255,255,255,0.88)",
  slots: normalizeSlots(DEFAULT_SLOTS),
  stripHeightPx: 180,
  stripLogoPx: 120,
  stripScorePx: 120,
  stripTimerPx: 72,
  stripPeriodPx: 24,
  timerRunningColor: "#ffffff",
  timerPausedColor: "rgba(255,255,255,0.72)",
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function normalizeTeamRadialAlphaHex(raw: string | undefined, fallback: string): string {
  if (raw && /^[0-9a-fA-F]{2}$/.test(raw.trim())) return raw.trim().toLowerCase();
  return fallback;
}

function normalizeLayoutMode(raw: unknown): ScoreboardLayoutMode {
  if (raw === "left-l" || raw === "full" || raw === "bottom-strip" || raw === "auto" || raw === "custom") {
    return raw;
  }
  return "auto";
}

function clampPct(n: number, lo: number, hi: number): number {
  return Math.round(Math.min(hi, Math.max(lo, n)));
}

export function normalizeSlot(raw: Partial<LayoutSlot> | undefined, fallback: LayoutSlot): LayoutSlot {
  const w = clampPct(raw?.w ?? fallback.w, 8, 100);
  const h = clampPct(raw?.h ?? fallback.h, 8, 100);
  return {
    x: clampPct(raw?.x ?? fallback.x, 0, 100 - w),
    y: clampPct(raw?.y ?? fallback.y, 0, 100 - h),
    w,
    h,
  };
}

export function normalizeSlots(raw: Partial<ScoreboardSlots> | undefined): ScoreboardSlots {
  return {
    home: normalizeSlot(raw?.home, DEFAULT_SLOTS.home),
    away: normalizeSlot(raw?.away, DEFAULT_SLOTS.away),
    clock: normalizeSlot(raw?.clock, DEFAULT_SLOTS.clock),
    sponsor: normalizeSlot(raw?.sponsor, DEFAULT_SLOTS.sponsor),
  };
}

export function slotStyle(slot: LayoutSlot): { left: string; top: string; width: string; height: string } {
  return {
    left: `${slot.x}%`,
    top: `${slot.y}%`,
    width: `${slot.w}%`,
    height: `${slot.h}%`,
  };
}

function normalizeTeamStackOrder(raw: unknown): TeamStackOrder {
  if (
    raw === "logo-name-score" ||
    raw === "name-logo-score" ||
    raw === "logo-score-name" ||
    raw === "score-name-logo"
  ) {
    return raw;
  }
  return "logo-name-score";
}

function normalizeOrder(order: unknown): LeftStripSegment[] {
  if (!Array.isArray(order)) return [...DEFAULT_ORDER];
  const allowed = new Set<LeftStripSegment>(["home", "timer", "away"]);
  const picked = order.filter((x): x is LeftStripSegment => allowed.has(x as LeftStripSegment));
  const out: LeftStripSegment[] = [];
  for (const seg of picked) {
    if (!out.includes(seg)) out.push(seg);
  }
  for (const seg of DEFAULT_ORDER) {
    if (!out.includes(seg)) out.push(seg);
  }
  return out;
}

/** Leest optionele display-voorkeuren uit dezelfde JSON als het scorebordthema. */
export function sponsorRepeatBudgetCyclesFromThemeJson(
  raw: string | null | undefined,
): boolean {
  if (!raw || typeof raw !== "string" || !raw.trim()) return false;
  try {
    const patch = JSON.parse(raw) as ScoreboardTheme;
    return patch.sponsorRepeatBudgetCycles === true;
  } catch {
    return false;
  }
}

export function mergeScoreboardTheme(raw: string | null | undefined): ResolvedScoreboardTheme {
  let patch: ScoreboardTheme = {};
  if (raw && typeof raw === "string" && raw.trim()) {
    try {
      patch = JSON.parse(raw) as ScoreboardTheme;
    } catch {
      patch = {};
    }
  }
  const bar = clamp(Math.round(patch.leftBarWidthPx ?? DEFAULT_SCOREBOARD_THEME.leftBarWidthPx), 180, 520);
  const bottom = patch.bottomBarHeightPx != null
    ? clamp(Math.round(patch.bottomBarHeightPx), 120, 600)
    : bar;
  return {
    ...DEFAULT_SCOREBOARD_THEME,
    ...patch,
    leftBarWidthPx: bar,
    bottomBarHeightPx: bottom,
    leftColumnOrder: normalizeOrder(patch.leftColumnOrder),
    leftLogoPx: clamp(Math.round(patch.leftLogoPx ?? DEFAULT_SCOREBOARD_THEME.leftLogoPx), 64, 280),
    leftScorePx: clamp(Math.round(patch.leftScorePx ?? DEFAULT_SCOREBOARD_THEME.leftScorePx), 48, 220),
    leftTimerPx: clamp(Math.round(patch.leftTimerPx ?? DEFAULT_SCOREBOARD_THEME.leftTimerPx), 28, 120),
    leftPeriodPx: clamp(Math.round(patch.leftPeriodPx ?? DEFAULT_SCOREBOARD_THEME.leftPeriodPx), 10, 28),
    leftTimerBlockHeightPx: clamp(
      Math.round(patch.leftTimerBlockHeightPx ?? DEFAULT_SCOREBOARD_THEME.leftTimerBlockHeightPx),
      120,
      400,
    ),
    fullLogoPx: clamp(Math.round(patch.fullLogoPx ?? DEFAULT_SCOREBOARD_THEME.fullLogoPx), 160, 480),
    fullScorePx: clamp(Math.round(patch.fullScorePx ?? DEFAULT_SCOREBOARD_THEME.fullScorePx), 96, 280),
    fullTimerPx: clamp(Math.round(patch.fullTimerPx ?? DEFAULT_SCOREBOARD_THEME.fullTimerPx), 64, 200),
    fullPeriodPx: clamp(Math.round(patch.fullPeriodPx ?? DEFAULT_SCOREBOARD_THEME.fullPeriodPx), 14, 40),
    fullCenterWidthPx: clamp(
      Math.round(patch.fullCenterWidthPx ?? DEFAULT_SCOREBOARD_THEME.fullCenterWidthPx),
      280,
      960,
    ),
    fullSidePaddingPx: clamp(
      Math.round(patch.fullSidePaddingPx ?? DEFAULT_SCOREBOARD_THEME.fullSidePaddingPx),
      8,
      120,
    ),
    fullTeamStackGapPx: clamp(
      Math.round(patch.fullTeamStackGapPx ?? DEFAULT_SCOREBOARD_THEME.fullTeamStackGapPx),
      4,
      64,
    ),
    fullCenterStackGapPx: clamp(
      Math.round(patch.fullCenterStackGapPx ?? DEFAULT_SCOREBOARD_THEME.fullCenterStackGapPx),
      4,
      48,
    ),
    fullTeamRadialAlphaHex: normalizeTeamRadialAlphaHex(
      patch.fullTeamRadialAlphaHex,
      DEFAULT_SCOREBOARD_THEME.fullTeamRadialAlphaHex,
    ),
    fullShowPeriod: patch.fullShowPeriod !== false,
    fullShowAddedTime: patch.fullShowAddedTime !== false,
    fullShowTeamNames: patch.fullShowTeamNames === true,
    fullTeamNamePx: clamp(
      Math.round(patch.fullTeamNamePx ?? DEFAULT_SCOREBOARD_THEME.fullTeamNamePx),
      14,
      72,
    ),
    fullTeamNameUppercase: patch.fullTeamNameUppercase !== false,
    layoutMode: normalizeLayoutMode(patch.layoutMode),
    fullTeamStackOrder: normalizeTeamStackOrder(patch.fullTeamStackOrder),
    showLogos: patch.showLogos !== false,
    showScores: patch.showScores !== false,
    showClock: patch.showClock !== false,
    scoreColor: patch.scoreColor?.trim() || DEFAULT_SCOREBOARD_THEME.scoreColor,
    teamNameColor: patch.teamNameColor?.trim() || DEFAULT_SCOREBOARD_THEME.teamNameColor,
    slots: normalizeSlots(patch.slots),
    stripHeightPx: clamp(Math.round(patch.stripHeightPx ?? DEFAULT_SCOREBOARD_THEME.stripHeightPx), 120, 280),
    stripLogoPx: clamp(Math.round(patch.stripLogoPx ?? DEFAULT_SCOREBOARD_THEME.stripLogoPx), 64, 200),
    stripScorePx: clamp(Math.round(patch.stripScorePx ?? DEFAULT_SCOREBOARD_THEME.stripScorePx), 48, 200),
    stripTimerPx: clamp(Math.round(patch.stripTimerPx ?? DEFAULT_SCOREBOARD_THEME.stripTimerPx), 36, 120),
    stripPeriodPx: clamp(Math.round(patch.stripPeriodPx ?? DEFAULT_SCOREBOARD_THEME.stripPeriodPx), 12, 36),
    frameColorTop: patch.frameColorTop ?? DEFAULT_SCOREBOARD_THEME.frameColorTop,
    frameColorMid: patch.frameColorMid ?? DEFAULT_SCOREBOARD_THEME.frameColorMid,
    frameColorBot: patch.frameColorBot ?? DEFAULT_SCOREBOARD_THEME.frameColorBot,
    contentAreaBg: patch.contentAreaBg ?? DEFAULT_SCOREBOARD_THEME.contentAreaBg,
    fontFamily: patch.fontFamily?.trim() || DEFAULT_SCOREBOARD_THEME.fontFamily,
    timerRunningColor: patch.timerRunningColor ?? DEFAULT_SCOREBOARD_THEME.timerRunningColor,
    timerPausedColor: patch.timerPausedColor ?? DEFAULT_SCOREBOARD_THEME.timerPausedColor,
  };
}

export function frameGradientCss(t: ResolvedScoreboardTheme): string {
  return `linear-gradient(180deg, ${t.frameColorTop} 0%, ${t.frameColorMid} 55%, ${t.frameColorBot} 100%)`;
}

/** L-frame: geforceerd, of automatisch naast sponsors/interrupts. */
export function scoreboardUsesLeftFrame(
  theme: Pick<ResolvedScoreboardTheme, "layoutMode">,
  autoLeft: boolean,
): boolean {
  if (theme.layoutMode === "custom" || theme.layoutMode === "bottom-strip") return false;
  if (theme.layoutMode === "left-l") return true;
  return autoLeft;
}

export function scoreboardUsesStrip(theme: Pick<ResolvedScoreboardTheme, "layoutMode">): boolean {
  return theme.layoutMode === "bottom-strip";
}

export function scoreboardUsesCustom(theme: Pick<ResolvedScoreboardTheme, "layoutMode">): boolean {
  return theme.layoutMode === "custom";
}
