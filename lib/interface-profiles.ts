import { isMatchTabPanelId, type MatchTabPanelId } from "./control-match-layout";

export const CONTROL_TABS = ["match", "setup", "media", "reports", "livestream"] as const;
export type ControlTabId = (typeof CONTROL_TABS)[number];

export const INTERFACE_PANELS: MatchTabPanelId[] = [
  "music",
  "timer",
  "match-live",
  "preview",
  "display",
  "sponsor-hud",
  "sponsor-overview",
  "sponsor-timeline",
  "player-intro",
  "external",
  "event-log",
  "match-info",
];

export const FULL_PROFILE_ID = "full";
export const SIMPLE_PROFILE_ID = "match";

export type InterfaceProfile = {
  id: string;
  name: string;
  builtin: boolean;
  tabs: ControlTabId[];
  panels: MatchTabPanelId[];
};

export type InterfaceProfileStore = {
  activeId: string;
  profiles: InterfaceProfile[];
};

function isTab(value: unknown): value is ControlTabId {
  return typeof value === "string" && (CONTROL_TABS as readonly string[]).includes(value);
}

function uniqueTabs(values: unknown): ControlTabId[] {
  const out: ControlTabId[] = [];
  if (!Array.isArray(values)) return ["match"];
  for (const value of values) {
    if (isTab(value) && !out.includes(value)) out.push(value);
  }
  return out.length > 0 ? out : ["match"];
}

function uniquePanels(values: unknown): MatchTabPanelId[] {
  const out: MatchTabPanelId[] = [];
  if (!Array.isArray(values)) return [];
  for (const value of values) {
    if (isMatchTabPanelId(value) && INTERFACE_PANELS.includes(value) && !out.includes(value)) out.push(value);
  }
  return out;
}

export function builtinInterfaceProfiles(): InterfaceProfile[] {
  return [
    {
      id: FULL_PROFILE_ID,
      name: "Alles",
      builtin: true,
      tabs: [...CONTROL_TABS],
      panels: [...INTERFACE_PANELS],
    },
    {
      id: SIMPLE_PROFILE_ID,
      name: "Alleen wedstrijd",
      builtin: true,
      tabs: ["match"],
      panels: ["timer", "match-live", "preview", "music"],
    },
  ];
}

export function defaultInterfaceProfileStore(): InterfaceProfileStore {
  return { activeId: FULL_PROFILE_ID, profiles: builtinInterfaceProfiles() };
}

function cleanName(value: unknown, fallback: string): string {
  const name = typeof value === "string" ? value.trim().slice(0, 32) : "";
  return name || fallback;
}

export function parseInterfaceProfileStore(raw: string | null | undefined): InterfaceProfileStore {
  const builtins = builtinInterfaceProfiles();
  if (!raw || !raw.trim()) return { activeId: FULL_PROFILE_ID, profiles: builtins };
  try {
    const parsed = JSON.parse(raw) as { activeId?: unknown; profiles?: unknown };
    const custom: InterfaceProfile[] = [];
    if (Array.isArray(parsed.profiles)) {
      for (const item of parsed.profiles) {
        if (!item || typeof item !== "object") continue;
        const row = item as Partial<InterfaceProfile>;
        if (row.builtin || row.id === FULL_PROFILE_ID || row.id === SIMPLE_PROFILE_ID) continue;
        if (typeof row.id !== "string" || !row.id.trim()) continue;
        custom.push({
          id: row.id.slice(0, 40),
          name: cleanName(row.name, "Scherm"),
          builtin: false,
          tabs: uniqueTabs(row.tabs),
          panels: uniquePanels(row.panels),
        });
        if (custom.length >= 8) break;
      }
    }
    const profiles = [...builtins, ...custom];
    const activeId =
      typeof parsed.activeId === "string" && profiles.some((profile) => profile.id === parsed.activeId)
        ? parsed.activeId
        : FULL_PROFILE_ID;
    return { activeId, profiles };
  } catch {
    return { activeId: FULL_PROFILE_ID, profiles: builtins };
  }
}

export function activeInterfaceProfile(store: InterfaceProfileStore): InterfaceProfile {
  return store.profiles.find((profile) => profile.id === store.activeId) ?? store.profiles[0]!;
}

export function newInterfaceProfile(source: InterfaceProfile, name: string): InterfaceProfile {
  return {
    id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName(name, "Scherm"),
    builtin: false,
    tabs: [...source.tabs],
    panels: [...source.panels],
  };
}

export function blankInterfaceProfile(name: string): InterfaceProfile {
  return {
    id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName(name, "Scherm"),
    builtin: false,
    tabs: [],
    panels: [],
  };
}
