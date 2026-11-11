/**
 * Scorebordknoppen voor Stream Deck: periode, rust, schermkeuze, snelle mediaknoppen, shotclock,
 * time-outs, fouten en extra tijd. Staat naast de studio-knoppen in `stream-deck.ts`; die blijven
 * zoals ze waren.
 *
 * Elke knop is één localhost-pad. Wat de knop doet hangt af van de wedstrijd die loopt, dus de
 * vertaling naar commando's gebeurt hier, met de live toestand erbij, en is zo te testen.
 */
import { getSportProfile, sportMaxPeriodForMatch, timeoutLimitForMatch } from "./sports";
import type { SerializedDisplayState } from "./timer";
import type { Command } from "./validation/commands";

export type DeckSide = "home" | "away";

/** Zoveel snelle mediaknoppen uit de regie kun je op de Stream Deck zetten. */
export const DECK_QUICK_SLOTS = 8;

/** Een snelle mediaknop uit de regie: welk media-item hij start en wat erop staat. */
export type DeckQuickButton = { id: string; label: string };

export type BoardDeckAction =
  | { id: "points"; side: DeckSide; points: 2 | 3 }
  | { id: "period"; step: "next" }
  | { id: "break" }
  | { id: "fulltime" }
  | { id: "display"; mode: "board" | "sponsors" }
  | { id: "quick"; index: number }
  | { id: "shotclock"; mode: "toggle" }
  | { id: "shotclock"; mode: "reset"; seconds: number }
  | { id: "timeout"; side: DeckSide | "clear" }
  | { id: "foul"; side: DeckSide; delta: 1 | -1 }
  | { id: "addedtime"; delta: 1 | -1 };

/** Wat een knop van de schermtoestand nodig heeft. */
export type DeckState = Pick<
  SerializedDisplayState,
  | "mode"
  | "activeMediaId"
  | "timerRunning"
  | "timerStartedAt"
  | "timerBaseSec"
  | "shotClockRunning"
  | "shotClockStartedAt"
  | "shotClockBaseSec"
  | "shotClockOff"
  | "shotClockDisabled"
  | "timeoutRunning"
  | "timeoutStartedAt"
  | "timeoutBaseSec"
  | "timeoutSide"
  | "breakRunning"
  | "breakStartedAt"
  | "breakBaseSec"
  | "addedTimeMinutes"
>;

/** Wat een knop van de actieve wedstrijd nodig heeft. */
export type DeckMatch = {
  sport: string;
  status: string;
  currentPeriod: number;
  periodDurationSec: number;
  homeScore: number;
  awayScore: number;
  homeFouls: number;
  awayFouls: number;
  homeTimeouts: number;
  awayTimeouts: number;
  setsToWin?: number | null;
  timeoutsPerSet?: number | null;
  /** Korte ploegnaam voor op de knop; leeg valt terug op Thuis/Uit. */
  homeName: string;
  awayName: string;
};

export type DeckLive = {
  state: DeckState | null;
  match: DeckMatch | null;
  /** De snelle mediaknoppen van de regie, in haar volgorde. Zonder lijst zijn er geen. */
  quick?: DeckQuickButton[];
};

/** Waarom een knop nu niets kan doen. */
export type DeckIssue = "noMatch" | "notForSport" | "noNextPeriod" | "noQuickButton";

export type BoardDeckPlan = { ok: true; commands: Command[] } | { ok: false; issue: DeckIssue };

const SIDE = "(home|away)";

export function parseBoardDeckPath(pathname: string): BoardDeckAction | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  const points = new RegExp(`^/score/${SIDE}/plus([23])$`).exec(p);
  if (points) return { id: "points", side: points[1] as DeckSide, points: Number(points[2]) as 2 | 3 };
  if (p === "/period/next") return { id: "period", step: "next" };
  if (p === "/break") return { id: "break" };
  if (p === "/fulltime") return { id: "fulltime" };
  if (p === "/display/board") return { id: "display", mode: "board" };
  if (p === "/display/sponsors") return { id: "display", mode: "sponsors" };
  const quick = /^\/quick\/([1-9])$/.exec(p);
  if (quick && Number(quick[1]) <= DECK_QUICK_SLOTS) return { id: "quick", index: Number(quick[1]) };
  if (p === "/shotclock/toggle") return { id: "shotclock", mode: "toggle" };
  const reset = /^\/shotclock\/reset\/([1-9][0-9]?)$/.exec(p);
  if (reset) return { id: "shotclock", mode: "reset", seconds: Number(reset[1]) };
  const timeout = /^\/timeout\/(home|away|clear)$/.exec(p);
  if (timeout) return { id: "timeout", side: timeout[1] as DeckSide | "clear" };
  const foul = new RegExp(`^/foul/${SIDE}/(up|down)$`).exec(p);
  if (foul) return { id: "foul", side: foul[1] as DeckSide, delta: foul[2] === "up" ? 1 : -1 };
  if (p === "/addedtime/up") return { id: "addedtime", delta: 1 };
  if (p === "/addedtime/down") return { id: "addedtime", delta: -1 };
  return null;
}

/**
 * Alle paden waarmee je het scorebord bedient, in de volgorde van de keuzelijst in Stream Deck.
 * De eerste groep (klok, score ±1, zwart) bestond al; die paden zijn dezelfde gebleven.
 */
export const BOARD_DECK_PATHS = [
  "/timer/toggle",
  "/score/home/up",
  "/score/home/down",
  "/score/away/up",
  "/score/away/down",
  "/score/home/plus2",
  "/score/home/plus3",
  "/score/away/plus2",
  "/score/away/plus3",
  "/period/next",
  "/break",
  "/fulltime",
  "/display/board",
  "/display/sponsors",
  "/blackout",
  "/shotclock/toggle",
  "/shotclock/reset/24",
  "/shotclock/reset/14",
  "/timeout/home",
  "/timeout/away",
  "/timeout/clear",
  "/foul/home/up",
  "/foul/home/down",
  "/foul/away/up",
  "/foul/away/down",
  "/addedtime/up",
  "/addedtime/down",
  ...Array.from({ length: DECK_QUICK_SLOTS }, (_, i) => `/quick/${i + 1}`),
] as const;

/** De snelle mediaknop op plaats `index` (vanaf 1), of null als de regie er daar geen heeft. */
export function deckQuickButton(live: DeckLive, index: number): DeckQuickButton | null {
  return live.quick?.[index - 1] ?? null;
}

/** Staat het media-item van deze snelle knop nu als eenmalige clip op het scherm? */
export function deckQuickPlaying(state: DeckState | null, button: DeckQuickButton): boolean {
  return state?.mode === "SPONSOR" && state.activeMediaId === button.id;
}

function matchIsOver(match: DeckMatch): boolean {
  return match.status === "FULL_TIME" || match.status === "POST_MATCH";
}

/**
 * De periode waar "Volgende periode" naartoe gaat, of null als er geen meer volgt.
 * Vóór de aftrap is dat periode 1; tijdens het spel en in de pauze de periode erna.
 */
export function nextDeckPeriod(match: DeckMatch): number | null {
  if (matchIsOver(match)) return null;
  if (match.status === "SETUP" || match.status === "PREMATCH") return 1;
  const next = Math.max(1, Math.floor(match.currentPeriod || 1)) + 1;
  return next <= sportMaxPeriodForMatch(match) ? next : null;
}

/** Welke commando's een scorebordknop nu stuurt, of waarom hij niets kan doen. */
export function boardDeckPlan(action: BoardDeckAction, live: DeckLive): BoardDeckPlan {
  const { match, state } = live;

  if (action.id === "display") {
    return {
      ok: true,
      commands: [
        {
          type: "display:setMode",
          mode: action.mode === "sponsors" ? "SPONSOR_ROTATION" : "MATCH",
          meta: { persistSponsorPreference: true, activeMediaId: null },
        },
      ],
    };
  }
  if (action.id === "quick") {
    // Zelfde commando als de snelle knop in de regie. Het scherm keert na de clip zelf terug naar
    // wat er stond; nog eens drukken start de clip opnieuw.
    const button = deckQuickButton(live, action.index);
    if (!button) return { ok: false, issue: "noQuickButton" };
    return {
      ok: true,
      commands: [{ type: "display:setMode", mode: "SPONSOR", meta: { activeMediaId: button.id } }],
    };
  }
  if (action.id === "timeout" && action.side === "clear" && !match) {
    return { ok: true, commands: [{ type: "timeout:clear" }] };
  }
  if (!match) return { ok: false, issue: "noMatch" };
  const profile = getSportProfile(match.sport);

  if (action.id === "points") {
    if (!profile.scoreIncrements.includes(action.points)) return { ok: false, issue: "notForSport" };
    return { ok: true, commands: [{ type: "score:adjust", side: action.side, delta: action.points }] };
  }
  if (action.id === "period") {
    const period = nextDeckPeriod(match);
    if (period == null) return { ok: false, issue: "noNextPeriod" };
    return { ok: true, commands: [{ type: "sport:setPeriod", period }] };
  }
  if (action.id === "break") {
    return {
      ok: true,
      commands: [
        match.status === "HALF_TIME"
          ? { type: "sport:resumePlay" }
          : { type: "match:setStatus", status: "HALF_TIME" },
      ],
    };
  }
  if (action.id === "fulltime") {
    return { ok: true, commands: [{ type: "match:setStatus", status: "FULL_TIME" }] };
  }
  if (action.id === "shotclock") {
    if (profile.shotClockPresets.length === 0) return { ok: false, issue: "notForSport" };
    if (action.mode === "reset") {
      if (!profile.shotClockPresets.includes(action.seconds)) return { ok: false, issue: "notForSport" };
      return { ok: true, commands: [{ type: "shotclock:reset", seconds: action.seconds }] };
    }
    return {
      ok: true,
      commands: [{ type: state?.shotClockRunning ? "shotclock:pause" : "shotclock:start" }],
    };
  }
  if (action.id === "timeout") {
    if (action.side === "clear") {
      // Volleybal hervat het spel na een time-out; de andere sporten stoppen alleen de time-outklok.
      return { ok: true, commands: [profile.hasSets ? { type: "sport:resumePlay" } : { type: "timeout:clear" }] };
    }
    if (timeoutLimitForMatch(match) <= 0) return { ok: false, issue: "notForSport" };
    return { ok: true, commands: [{ type: "timeout:start", side: action.side }] };
  }
  if (action.id === "foul") {
    if (!profile.statLabel) return { ok: false, issue: "notForSport" };
    return {
      ok: true,
      commands: [{ type: "sport:statAdjust", stat: "foul", side: action.side, delta: action.delta }],
    };
  }
  // Extra tijd: de stand op het scherm plus of min één minuut.
  if (!profile.supportsInjuryTime) return { ok: false, issue: "notForSport" };
  const current = Math.max(0, Math.floor(state?.addedTimeMinutes ?? 0));
  const minutes = Math.max(0, Math.min(30, current + action.delta));
  return { ok: true, commands: [{ type: "timer:setAddedTime", minutes }] };
}
