import {
  DEFAULT_SCOREBOARD_THEME,
  SLOT_PRESETS,
  bottomBarForSixteenByNine,
  type ResolvedScoreboardTheme,
  type ScoreboardTheme,
} from "./scoreboard-theme";

const OVERLAY_SLOTS = SLOT_PRESETS.find((p) => p.id === "overlay")!.slots;
const TOP_BAR_SLOTS = SLOT_PRESETS.find((p) => p.id === "topBar")!.slots;
const FULL_BLEED_SLOTS = {
  home: { x: 3, y: 72, w: 18, h: 24 },
  away: { x: 79, y: 72, w: 18, h: 24 },
  clock: { x: 38, y: 78, w: 24, h: 18 },
  sponsor: { x: 0, y: 0, w: 100, h: 100 },
};

/**
 * Scorebord-layouts als herbruikbare templates.
 *
 * Een template bevat **alleen visuele thema-keys**. Afspeelgedrag zoals
 * `sponsorRepeatBudgetCycles` staat óók in `AppSettings.scoreboardThemeJson`,
 * maar hoort niet bij een layout: anders verandert het wisselen van een layout
 * stilletjes je sponsorrotatie. `applyTemplateToThemeJson` bewaart die keys.
 */

export type ScoreboardTemplate = {
  id: string;
  name: string;
  label: string | null;
  themeJson: string;
  isBuiltIn: boolean;
  sortIndex: number;
};

/** Keys die bij de layout horen (en dus in een template mogen). */
const VISUAL_THEME_KEYS = Object.keys(DEFAULT_SCOREBOARD_THEME) as (keyof ResolvedScoreboardTheme)[];

/** Keys die in dezelfde JSON zitten maar géén layout zijn — nooit in een template. */
export const NON_VISUAL_THEME_KEYS = ["sponsorRepeatBudgetCycles"] as const;

function parseThemeJson(raw: string | null | undefined): ScoreboardTheme {
  if (!raw || typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as ScoreboardTheme;
  } catch {
    return {};
  }
}

/** Haalt enkel de layout-keys uit een thema-JSON (voor "huidige opslaan als template"). */
export function extractVisualTheme(raw: string | null | undefined): ScoreboardTheme {
  const patch = parseThemeJson(raw);
  const out: Record<string, unknown> = {};
  for (const key of VISUAL_THEME_KEYS) {
    if (patch[key] !== undefined) out[key] = patch[key];
  }
  return out as ScoreboardTheme;
}

/**
 * Nieuwe `scoreboardThemeJson` na het toepassen van een template: layout uit de
 * template, afspeelinstellingen uit de huidige settings.
 */
export function applyTemplateToThemeJson(
  currentRaw: string | null | undefined,
  templateThemeJson: string,
): string {
  const current = parseThemeJson(currentRaw);
  const next: Record<string, unknown> = { ...extractVisualTheme(templateThemeJson) };
  for (const key of NON_VISUAL_THEME_KEYS) {
    if (current[key] !== undefined) next[key] = current[key];
  }
  return JSON.stringify(next);
}

/** Template-JSON opschonen voor opslag: alleen layout-keys, compact. */
export function sanitizeTemplateThemeJson(raw: string | null | undefined): string {
  return JSON.stringify(extractVisualTheme(raw));
}

export function templateDisplayName(t: ScoreboardTemplate): string {
  return t.label ? `${t.name} · ${t.label}` : t.name;
}

export type TemplateMediaKind = "overlay" | "reserved";

/** Overlay = video full-bleed 16:9 met graphics erover. Reserved = vast vak naast/boven de balken. */
export function templateMediaKind(themeJson: string): TemplateMediaKind {
  const theme = extractVisualTheme(themeJson);
  return theme.layoutMode === "custom" || theme.layoutMode === "bottom-strip" ? "overlay" : "reserved";
}

/* ————————————————————————— meegeleverde voorbeelden ————————————————————————— */

type BuiltIn = { key: string; name: string; label: string; theme: ScoreboardTheme };

/**
 * Vertrekpunten, geen dwangbuis: elk voorbeeld is te dupliceren en aan te passen.
 * Waarden blijven binnen de clamps van `mergeScoreboardTheme`.
 */
export const BUILT_IN_TEMPLATES: BuiltIn[] = [
  {
    key: "standaard",
    name: "Broadcast",
    label: "Video 16:9 full-bleed, score eroverheen",
    theme: {
      layoutMode: "custom",
      slots: FULL_BLEED_SLOTS,
      fullShowTeamNames: true,
      fullShowPeriod: true,
      fullShowAddedTime: true,
      showLogos: true,
      showScores: true,
      showClock: true,
    },
  },
  {
    key: "pro-league",
    name: "LED L-balk",
    label: "Score links, video 16:9 ernaast",
    theme: {
      layoutMode: "left-l",
      leftBarWidthPx: 320,
      bottomBarHeightPx: bottomBarForSixteenByNine(320),
      leftLogoPx: 150,
      leftScorePx: 150,
      leftTimerPx: 72,
      fullShowTeamNames: false,
      fullShowPeriod: true,
      fullShowAddedTime: true,
      showLogos: true,
      showScores: true,
      showClock: true,
    },
  },
  {
    key: "amateur",
    name: "Bovenbalk",
    label: "Dunne balk boven, maximale 16:9-video",
    theme: {
      layoutMode: "custom",
      slots: TOP_BAR_SLOTS,
      fullShowTeamNames: true,
      fullShowPeriod: true,
      fullShowAddedTime: false,
      showLogos: true,
      showScores: true,
      showClock: true,
    },
  },
  {
    key: "beker",
    name: "Beker",
    label: "Namen, periode en extra tijd over 16:9",
    theme: {
      layoutMode: "custom",
      slots: OVERLAY_SLOTS,
      fullShowTeamNames: true,
      fullTeamNamePx: 40,
      fullTeamNameUppercase: false,
      fullShowAddedTime: true,
      fullShowPeriod: true,
      showLogos: true,
      showScores: true,
      showClock: true,
    },
  },
  {
    key: "minimal",
    name: "Minimaal",
    label: "Alleen score en klok over 16:9",
    theme: {
      layoutMode: "custom",
      slots: {
        home: { x: 4, y: 80, w: 14, h: 16 },
        away: { x: 82, y: 80, w: 14, h: 16 },
        clock: { x: 42, y: 82, w: 16, h: 14 },
        sponsor: { x: 0, y: 0, w: 100, h: 100 },
      },
      fullShowPeriod: false,
      fullShowAddedTime: false,
      fullShowTeamNames: false,
      showLogos: true,
      showScores: true,
      showClock: true,
    },
  },
  {
    key: "led-strip",
    name: "LED-strip",
    label: "Lage onderbalk, video 16:9 erboven",
    theme: {
      layoutMode: "bottom-strip",
      stripHeightPx: 160,
      stripLogoPx: 88,
      stripScorePx: 88,
      stripTimerPx: 56,
      stripPeriodPx: 16,
      fullShowTeamNames: true,
      fullShowPeriod: true,
      fullShowAddedTime: true,
      showLogos: true,
      showScores: true,
      showClock: true,
    },
  },
];

export function builtInTemplateRows(): {
  id: string;
  name: string;
  label: string;
  themeJson: string;
  isBuiltIn: boolean;
  sortIndex: number;
}[] {
  return BUILT_IN_TEMPLATES.map((t, i) => ({
    id: `builtin_${t.key}`,
    name: t.name,
    label: t.label,
    themeJson: JSON.stringify(t.theme),
    isBuiltIn: true,
    sortIndex: i,
  }));
}
