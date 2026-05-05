/** Opgeslagen in AppSettings.scoreboardThemeJson (merge met defaults). */

export type LeftStripSegment = "home" | "timer" | "away";

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
