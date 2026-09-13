import type { Sponsor, SponsorSection } from "./types";
import {
  getSportProfile,
  lifecycleStatusForPeriod,
  normalizeSport,
  SPORT_TYPES,
  type SportType,
} from "./sports";
import { mediaAllowedForSponsorPhase } from "./sponsor-media-phases";
import {
  halfWindowElapsed,
  matchPlayBudgetSeconds,
  postmatchSpreadTimelineSeconds,
  prematchSpreadTimelineSeconds,
  sponsorSectionBudgetSeconds,
} from "./sponsor-distribution";
import { sectionForStatus } from "./sponsor-display-helpers";

export const SPONSOR_LAYOUT_IDS = ["two_blocks", "per_period", "inplay_plus_breaks"] as const;
export type SponsorLayoutId = (typeof SPONSOR_LAYOUT_IDS)[number];

export type SponsorWindowId =
  | "prematch"
  | "play"
  | "play1"
  | "play2"
  | "extraTime"
  | "periodBreak"
  | "halftime"
  | "postmatch"
  | `period:${number}`;

export type SponsorClockKind = "football_half" | "period" | "block_accum" | "wall";

export type SponsorWindowDef = {
  id: SponsorWindowId;
  section: SponsorSection;
  clock: SponsorClockKind;
  periods?: number[];
};

export type SponsorMatchClock = {
  sport: string;
  status: string;
  currentPeriod: number;
  halfDurationSec: number;
  periodDurationSec: number;
  halfBreakSec: number;
  prematchSpreadWindowSec?: number | null;
};

export type ResolvedSponsorWindow = {
  id: SponsorWindowId;
  section: SponsorSection;
  matchStatus: string;
  clock: SponsorClockKind;
  H: number;
  footballEngine: boolean;
  mediaStatus: string | undefined;
};

export type SportBudgetsMap = Partial<Record<SportType, Partial<Record<string, number>>>>;

export function defaultSponsorLayoutId(sport: unknown): SponsorLayoutId {
  const id = normalizeSport(sport);
  if (id === "FOOTBALL" || id === "FUTSAL") return "two_blocks";
  if (id === "VOLLEYBALL") return "inplay_plus_breaks";
  return "per_period";
}

export function parseSponsorLayoutsJson(
  raw: string | null | undefined,
): Partial<Record<SportType, SponsorLayoutId>> {
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Partial<Record<SportType, SponsorLayoutId>> = {};
    for (const sport of SPORT_TYPES) {
      if (sport === "FOOTBALL") continue;
      const value = parsed[sport];
      if (typeof value === "string" && (SPONSOR_LAYOUT_IDS as readonly string[]).includes(value)) {
        out[sport] = value as SponsorLayoutId;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeSponsorLayoutsJson(
  layouts: Partial<Record<SportType, SponsorLayoutId>>,
): string {
  const clean: Partial<Record<SportType, SponsorLayoutId>> = {};
  for (const sport of SPORT_TYPES) {
    if (sport === "FOOTBALL") continue;
    const value = layouts[sport];
    if (value && value !== defaultSponsorLayoutId(sport)) clean[sport] = value;
  }
  return JSON.stringify(clean);
}

export function resolveSponsorLayoutId(
  sport: unknown,
  layouts?: Partial<Record<SportType, SponsorLayoutId>> | null,
): SponsorLayoutId {
  const id = normalizeSport(sport);
  if (id === "FOOTBALL") return "two_blocks";
  const picked = layouts?.[id];
  if (picked && (SPONSOR_LAYOUT_IDS as readonly string[]).includes(picked)) return picked;
  return defaultSponsorLayoutId(id);
}

export function usesFootballSponsorEngine(sport: unknown, layoutId: SponsorLayoutId): boolean {
  const id = normalizeSport(sport);
  if (id === "FOOTBALL") return true;
  const profile = getSportProfile(id);
  return layoutId === "two_blocks" && profile.periodCount <= 2 && profile.timerMode !== "NONE";
}

export function sportSponsorWindows(sport: unknown, layoutId: SponsorLayoutId): SponsorWindowDef[] {
  const profile = getSportProfile(sport);
  const windows: SponsorWindowDef[] = [{ id: "prematch", section: "prematch", clock: "wall" }];
  const wallPlay = profile.timerMode === "NONE";

  if (layoutId === "per_period") {
    for (let period = 1; period <= profile.periodCount; period += 1) {
      windows.push({
        id: `period:${period}`,
        section: "match",
        clock: wallPlay ? "wall" : "period",
        periods: [period],
      });
    }
    windows.push({ id: "periodBreak", section: "halftime", clock: "wall" });
    windows.push({ id: "halftime", section: "halftime", clock: "wall" });
  } else if (layoutId === "inplay_plus_breaks") {
    windows.push({
      id: "play",
      section: "match",
      clock: wallPlay ? "wall" : "block_accum",
      periods: Array.from({ length: profile.periodCount }, (_, i) => i + 1),
    });
    windows.push({ id: "periodBreak", section: "halftime", clock: "wall" });
    windows.push({ id: "halftime", section: "halftime", clock: "wall" });
  } else {
    const mid = Math.max(1, Math.ceil(profile.periodCount / 2));
    const first = Array.from({ length: mid }, (_, i) => i + 1);
    const second = Array.from({ length: Math.max(0, profile.periodCount - mid) }, (_, i) => mid + 1 + i);
    const clock: SponsorClockKind = usesFootballSponsorEngine(sport, "two_blocks")
      ? "football_half"
      : "block_accum";
    windows.push({ id: "play1", section: "match", clock, periods: first });
    windows.push({ id: "halftime", section: "halftime", clock: "wall" });
    if (second.length) windows.push({ id: "play2", section: "match", clock, periods: second });
    windows.push({ id: "extraTime", section: "match", clock: "football_half" });
  }

  windows.push({ id: "postmatch", section: "postmatch", clock: "wall" });
  return windows;
}

function footballWindow(match: SponsorMatchClock): ResolvedSponsorWindow {
  const section = sectionForStatus(match.status);
  const status = match.status;
  if (section === "prematch") {
    return {
      id: "prematch",
      section,
      matchStatus: status,
      clock: "wall",
      H: 60,
      footballEngine: true,
      mediaStatus: undefined,
    };
  }
  if (section === "halftime") {
    return {
      id: "halftime",
      section,
      matchStatus: status,
      clock: "wall",
      H: Math.max(60, match.halfBreakSec),
      footballEngine: true,
      mediaStatus: undefined,
    };
  }
  if (section === "postmatch") {
    return {
      id: "postmatch",
      section,
      matchStatus: status,
      clock: "wall",
      H: 60,
      footballEngine: true,
      mediaStatus: undefined,
    };
  }
  const id =
    status === "SECOND_HALF" ? "play2" : status === "EXTRA_TIME" ? "extraTime" : "play1";
  return {
    id,
    section: "match",
    matchStatus: status,
    clock: "football_half",
    H: Math.max(60, match.halfDurationSec),
    footballEngine: true,
    mediaStatus: status,
  };
}

export function shouldUsePeriodBreak(input: {
  sport: unknown;
  status: string;
  timerRunning: boolean;
  periodBreakPending?: boolean;
  layoutId: SponsorLayoutId;
}): boolean {
  if (normalizeSport(input.sport) === "FOOTBALL") return false;
  if (getSportProfile(input.sport).timerMode === "NONE") return false;
  if (input.layoutId === "two_blocks") return false;
  if (input.status !== "FIRST_HALF" && input.status !== "SECOND_HALF") return false;
  return !input.timerRunning && !!input.periodBreakPending;
}

export function resolveSponsorWindow(input: {
  match: SponsorMatchClock;
  timerRunning: boolean;
  periodBreakPending?: boolean;
  layouts?: Partial<Record<SportType, SponsorLayoutId>> | null;
}): ResolvedSponsorWindow {
  const sport = normalizeSport(input.match.sport);
  const layoutId = resolveSponsorLayoutId(sport, input.layouts);
  if (usesFootballSponsorEngine(sport, layoutId)) {
    return footballWindow(input.match);
  }

  const status = input.match.status;
  const period = Math.max(1, Math.floor(input.match.currentPeriod || 1));
  const profile = getSportProfile(sport);
  const periodSec = Math.max(
    60,
    Number(input.match.periodDurationSec) > 0
      ? Number(input.match.periodDurationSec)
      : profile.defaultPeriodDurationSec || 60,
  );

  if (status === "SETUP" || status === "PREMATCH") {
    return {
      id: "prematch",
      section: "prematch",
      matchStatus: status,
      clock: "wall",
      H: 60,
      footballEngine: false,
      mediaStatus: undefined,
    };
  }
  if (status === "FULL_TIME" || status === "POST_MATCH") {
    return {
      id: "postmatch",
      section: "postmatch",
      matchStatus: status,
      clock: "wall",
      H: 60,
      footballEngine: false,
      mediaStatus: undefined,
    };
  }
  if (status === "HALF_TIME") {
    return {
      id: "halftime",
      section: "halftime",
      matchStatus: status,
      clock: "wall",
      H: Math.max(60, input.match.halfBreakSec),
      footballEngine: false,
      mediaStatus: undefined,
    };
  }
  if (status === "EXTRA_TIME") {
    return {
      id: "extraTime",
      section: "match",
      matchStatus: status,
      clock: "football_half",
      H: Math.max(60, input.match.halfDurationSec),
      footballEngine: false,
      mediaStatus: status,
    };
  }

  if (
    shouldUsePeriodBreak({
      sport,
      status,
      timerRunning: input.timerRunning,
      periodBreakPending: input.periodBreakPending,
      layoutId,
    })
  ) {
    return {
      id: "periodBreak",
      section: "halftime",
      matchStatus: "HALF_TIME",
      clock: "wall",
      H: Math.max(60, input.match.halfBreakSec),
      footballEngine: false,
      mediaStatus: undefined,
    };
  }

  if (layoutId === "per_period") {
    const liveStatus = lifecycleStatusForPeriod(sport, period);
    return {
      id: `period:${period}`,
      section: "match",
      matchStatus: liveStatus,
      clock: profile.timerMode === "NONE" ? "wall" : "period",
      H: periodSec,
      footballEngine: false,
      mediaStatus: liveStatus,
    };
  }

  if (layoutId === "inplay_plus_breaks") {
    const liveStatus = lifecycleStatusForPeriod(sport, period);
    return {
      id: "play",
      section: "match",
      matchStatus: liveStatus,
      clock: profile.timerMode === "NONE" ? "wall" : "block_accum",
      H: Math.max(60, periodSec * profile.periodCount),
      footballEngine: false,
      mediaStatus: liveStatus,
    };
  }

  const mid = Math.max(1, Math.ceil(profile.periodCount / 2));
  const inFirst = period <= mid;
  const blockLen = inFirst ? mid : Math.max(1, profile.periodCount - mid);
  return {
    id: inFirst ? "play1" : "play2",
    section: "match",
    matchStatus: inFirst ? "FIRST_HALF" : "SECOND_HALF",
    clock: "block_accum",
    H: Math.max(60, periodSec * blockLen),
    footballEngine: false,
    mediaStatus: inFirst ? "FIRST_HALF" : "SECOND_HALF",
  };
}

export function blockAccumulatedElapsed(input: {
  elapsedSec: number;
  currentPeriod: number;
  periodDurationSec: number;
  periodCount: number;
  windowId: SponsorWindowId;
}): number {
  const periodSec = Math.max(0, input.periodDurationSec);
  const mid = Math.max(1, Math.ceil(input.periodCount / 2));
  let firstInBlock = 1;
  if (input.windowId === "play2") firstInBlock = mid + 1;
  else if (input.windowId.startsWith("period:")) {
    firstInBlock = Number(input.windowId.slice(7)) || 1;
  }
  const completed = Math.max(0, input.currentPeriod - firstInBlock);
  return completed * periodSec + Math.max(0, input.elapsedSec);
}

export function windowPlayElapsed(input: {
  window: ResolvedSponsorWindow;
  elapsedSec: number;
  status: string;
  halfDurationSec: number;
  periodDurationSec: number;
  currentPeriod: number;
  periodCount: number;
  wallElapsedSec: number;
}): number {
  const w = input.window;
  if (w.clock === "football_half") {
    return halfWindowElapsed(input.elapsedSec, input.status, input.halfDurationSec);
  }
  if (w.clock === "period") {
    return Math.min(Math.max(0, input.elapsedSec), w.H);
  }
  if (w.clock === "block_accum") {
    return Math.min(
      blockAccumulatedElapsed({
        elapsedSec: input.elapsedSec,
        currentPeriod: input.currentPeriod,
        periodDurationSec: input.periodDurationSec,
        periodCount: input.periodCount,
        windowId: w.id,
      }),
      w.H,
    );
  }
  const cap = Math.max(1, w.H);
  return Math.min(Math.max(0, input.wallElapsedSec), cap - 1);
}

export function parseSportBudgetsJson(raw: string | null | undefined): SportBudgetsMap {
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: SportBudgetsMap = {};
    for (const sport of SPORT_TYPES) {
      const row = parsed[sport];
      if (!row || typeof row !== "object") continue;
      const mapped: Partial<Record<string, number>> = {};
      for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) mapped[key] = Math.floor(n);
      }
      out[sport] = mapped;
    }
    return out;
  } catch {
    return {};
  }
}

export function mergeSportBudgetsJson(
  raw: string | null | undefined,
  sport: unknown,
  patch: Partial<Record<string, number>>,
): string {
  const all = parseSportBudgetsJson(raw);
  const id = normalizeSport(sport);
  all[id] = { ...(all[id] ?? {}), ...patch };
  return JSON.stringify(all);
}

export function sponsorWindowBudgetSeconds(
  sponsor: Sponsor,
  window: Pick<ResolvedSponsorWindow, "id" | "section" | "matchStatus" | "footballEngine">,
  sport: unknown,
): number {
  const sportId = normalizeSport(sport);
  if (window.footballEngine || sportId === "FOOTBALL") {
    return sponsorSectionBudgetSeconds(sponsor, window.section, window.matchStatus);
  }
  const fromJson = parseSportBudgetsJson(sponsor.sportBudgetsJson)?.[sportId]?.[window.id];
  if (typeof fromJson === "number") return Math.max(0, fromJson);

  if (window.id === "prematch" || window.section === "prematch") return Math.max(0, sponsor.prematchSeconds);
  if (window.id === "postmatch" || window.section === "postmatch") {
    return Math.max(0, sponsor.postmatchSeconds ?? 0);
  }
  if (window.id === "halftime" || window.id === "periodBreak") {
    return Math.max(0, sponsor.halftimeSeconds);
  }
  if (window.id === "play2" || window.id === "extraTime") {
    return matchPlayBudgetSeconds(sponsor, "SECOND_HALF");
  }
  if (window.id.startsWith("period:")) {
    const n = Number(window.id.slice(7)) || 1;
    const mid = Math.ceil(getSportProfile(sportId).periodCount / 2);
    return matchPlayBudgetSeconds(sponsor, n > mid ? "SECOND_HALF" : "FIRST_HALF");
  }
  return matchPlayBudgetSeconds(sponsor, window.matchStatus);
}

export function activeSponsorsForWindow(
  sponsors: Sponsor[],
  window: Pick<ResolvedSponsorWindow, "id" | "section" | "matchStatus" | "footballEngine" | "mediaStatus">,
  sport: unknown,
): Sponsor[] {
  return sponsors.filter(
    (s) =>
      s.active &&
      sponsorWindowBudgetSeconds(s, window, sport) > 0 &&
      (s.media?.some((m) => m.active && mediaAllowedForSponsorPhase(m, window.section, window.mediaStatus)) ??
        false),
  );
}

export function windowTimelineSeconds(
  window: ResolvedSponsorWindow,
  match: SponsorMatchClock,
  sponsors: Sponsor[],
): number {
  if (window.footballEngine && window.section === "match") {
    return Math.max(60, match.halfDurationSec);
  }
  if (window.section === "halftime") return Math.max(60, match.halfBreakSec);
  if (window.section === "prematch") return prematchSpreadTimelineSeconds(match, sponsors);
  if (window.section === "postmatch") return postmatchSpreadTimelineSeconds(sponsors);
  if (window.clock === "wall") {
    const active = activeSponsorsForWindow(sponsors, window, match.sport);
    const total = active.reduce((sum, s) => sum + sponsorWindowBudgetSeconds(s, window, match.sport), 0);
    return Math.max(60, total);
  }
  return Math.max(60, window.H);
}

export function windowLabel(windowId: SponsorWindowId, sport: unknown): string {
  const profile = getSportProfile(sport);
  if (windowId === "prematch") return "Voor";
  if (windowId === "postmatch") return "Na";
  if (windowId === "halftime") return profile.id === "VOLLEYBALL" ? "Setbreak" : profile.periodCount > 2 ? "Grote rust" : "Rust";
  if (windowId === "periodBreak") {
    return profile.id === "VOLLEYBALL" ? "Tussen sets" : "Tussen periodes";
  }
  if (windowId === "play") return "Tijdens spel";
  if (windowId === "play1") return profile.periodCount <= 2 ? "1e helft" : `1e ${profile.periodLabel.toLowerCase()}en`;
  if (windowId === "play2") return profile.periodCount <= 2 ? "2e helft" : `2e ${profile.periodLabel.toLowerCase()}en`;
  if (windowId === "extraTime") return "Verlenging";
  if (windowId.startsWith("period:")) {
    const n = Number(windowId.slice(7)) || 1;
    return `${profile.periodLabel} ${n}`;
  }
  return windowId;
}
