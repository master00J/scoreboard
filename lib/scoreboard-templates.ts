import {
  DEFAULT_SCOREBOARD_THEME,
  type ResolvedScoreboardTheme,
  type ScoreboardTheme,
} from "./scoreboard-theme";

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

/* ————————————————————————— meegeleverde voorbeelden ————————————————————————— */

type BuiltIn = { key: string; name: string; label: string; theme: ScoreboardTheme };

/**
 * Vertrekpunten, geen dwangbuis: elk voorbeeld is te dupliceren en aan te passen.
 * Waarden blijven binnen de clamps van `mergeScoreboardTheme`.
 */
export const BUILT_IN_TEMPLATES: BuiltIn[] = [
  {
    key: "standaard",
    name: "Standaard",
    label: "ArenaCue",
    theme: {},
  },
  {
    key: "pro-league",
    name: "Pro League",
    label: "Brede balk, grote klok",
    theme: {
      leftBarWidthPx: 320,
      bottomBarHeightPx: 300,
      leftLogoPx: 150,
      leftScorePx: 150,
      leftTimerPx: 84,
      fullLogoPx: 340,
      fullScorePx: 210,
      fullTimerPx: 140,
      fullShowTeamNames: true,
      fullTeamNamePx: 44,
      fullTeamNameUppercase: true,
    },
  },
  {
    key: "amateur",
    name: "Amateur",
    label: "Compact, leesbaar van ver",
    theme: {
      leftBarWidthPx: 240,
      bottomBarHeightPx: 240,
      leftLogoPx: 110,
      leftScorePx: 130,
      leftTimerPx: 70,
      fullLogoPx: 260,
      fullScorePx: 200,
      fullTimerPx: 130,
      fullShowPeriod: true,
      fullShowTeamNames: false,
    },
  },
  {
    key: "beker",
    name: "Beker",
    label: "Met teamnamen en extra tijd",
    theme: {
      leftBarWidthPx: 300,
      fullShowTeamNames: true,
      fullTeamNamePx: 40,
      fullTeamNameUppercase: false,
      fullShowAddedTime: true,
      fullShowPeriod: true,
      fullCenterWidthPx: 620,
    },
  },
  {
    key: "minimal",
    name: "Minimaal",
    label: "Alleen score en klok",
    theme: {
      leftBarWidthPx: 220,
      bottomBarHeightPx: 200,
      fullShowPeriod: false,
      fullShowAddedTime: false,
      fullShowTeamNames: false,
      fullLogoPx: 280,
      fullScorePx: 240,
      fullTimerPx: 120,
      fullCenterWidthPx: 460,
    },
  },
  {
    key: "led-strip",
    name: "LED-strip",
    label: "Lage onderbalk voor smalle schermen",
    theme: {
      layoutMode: "bottom-strip",
      leftBarWidthPx: 200,
      bottomBarHeightPx: 140,
      stripHeightPx: 140,
      stripLogoPx: 90,
      stripScorePx: 96,
      stripTimerPx: 64,
      stripPeriodPx: 18,
      fullShowTeamNames: false,
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
