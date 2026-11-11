/**
 * Wat er op een Stream Deck-knop staat: de klok die loopt, de stand, welke periode volgt, of een
 * knop voor deze sport iets doet. De app tekent de knop; de plug-in zet alleen het beeld neer.
 */
import {
  boardDeckPlan,
  nextDeckPeriod,
  parseBoardDeckPath,
  type BoardDeckAction,
  type DeckLive,
  type DeckMatch,
  type DeckSide,
} from "./stream-deck-board";
import {
  parseStreamDeckPath,
  streamDeckActionPath,
  type StreamDeckAction,
  type StreamDeckSlot,
} from "./stream-deck";
import {
  describePeriod,
  formatShotClock,
  formatSportClock,
  getSportProfile,
  sportClockSeconds,
  timeoutLimitForMatch,
} from "./sports";
import {
  computeBreakSeconds,
  computeElapsedSeconds,
  computeShotClockSeconds,
  computeTimeoutSeconds,
} from "./timer";

export type DeckLocale = "nl" | "en" | "fr" | "it" | "de";
export const DECK_LOCALES: DeckLocale[] = ["nl", "en", "fr", "it", "de"];

export function normalizeDeckLocale(value: unknown): DeckLocale {
  const short = String(value ?? "").trim().toLowerCase().slice(0, 2);
  return (DECK_LOCALES as string[]).includes(short) ? (short as DeckLocale) : "nl";
}

/**
 * Tekst op de knoppen (kort, in hoofdletters) en in de keuzelijst van Stream Deck (`pi…`).
 * `{n}` wordt een nummer.
 */
export type DeckTexts = {
  clock: string;
  home: string;
  away: string;
  next: string;
  break: string;
  resume: string;
  fulltime: string;
  board: string;
  sponsors: string;
  blackout: string;
  shot: string;
  timeout: string;
  timeoutStop: string;
  foul: string;
  penalty: string;
  added: string;
  half1: string;
  half2: string;
  quarter: string;
  set: string;
  overtime: string;
  period: string;
  source: string;
  key: string;
  piAction: string;
  piActionTooltip: string;
  piFunction: string;
  piClock: string;
  piScore: string;
  piHome: string;
  piAway: string;
  piPeriodNext: string;
  piBreak: string;
  piFulltime: string;
  piBoard: string;
  piSponsors: string;
  piBlackout: string;
  piShotToggle: string;
  piShotReset: string;
  piTimeout: string;
  piTimeoutStop: string;
  piFoul: string;
  piAdded: string;
};

export const DECK_TEXTS: Record<DeckLocale, DeckTexts> = {
  nl: {
    clock: "KLOK",
    home: "THUIS",
    away: "UIT",
    next: "VOLGENDE",
    break: "RUST",
    resume: "HERVAT",
    fulltime: "EINDE",
    board: "SCOREBORD",
    sponsors: "SPONSORS",
    blackout: "ZWART",
    shot: "SHOT",
    timeout: "T-O",
    timeoutStop: "T-O STOP",
    foul: "FOUT",
    penalty: "STRAF",
    added: "EXTRA",
    half1: "1E HELFT",
    half2: "2E HELFT",
    quarter: "Q{n}",
    set: "SET {n}",
    overtime: "VERL. {n}",
    period: "P{n}",
    source: "BRON",
    key: "KNOP",
    piAction: "Scorebord-knop",
    piActionTooltip: "Bedien het scorebord: klok, score, periode, rust, sponsors en meer",
    piFunction: "Functie",
    piClock: "Klok start / pauze",
    piScore: "Score",
    piHome: "thuis",
    piAway: "uit",
    piPeriodNext: "Volgende periode",
    piBreak: "Rust aan / uit",
    piFulltime: "Einde wedstrijd",
    piBoard: "Alleen scorebord",
    piSponsors: "Scorebord + sponsors",
    piBlackout: "Scherm zwart aan / uit",
    piShotToggle: "Shotclock start / pauze",
    piShotReset: "Shotclock naar {n}",
    piTimeout: "Time-out",
    piTimeoutStop: "Time-out stoppen",
    piFoul: "Fout",
    piAdded: "Extra tijd",
  },
  en: {
    clock: "CLOCK",
    home: "HOME",
    away: "AWAY",
    next: "NEXT",
    break: "BREAK",
    resume: "RESUME",
    fulltime: "FULL TIME",
    board: "SCOREBOARD",
    sponsors: "SPONSORS",
    blackout: "BLACK",
    shot: "SHOT",
    timeout: "T-O",
    timeoutStop: "T-O STOP",
    foul: "FOUL",
    penalty: "PENALTY",
    added: "ADDED",
    half1: "1ST HALF",
    half2: "2ND HALF",
    quarter: "Q{n}",
    set: "SET {n}",
    overtime: "OT {n}",
    period: "P{n}",
    source: "SOURCE",
    key: "KEY",
    piAction: "Scoreboard key",
    piActionTooltip: "Run the scoreboard: clock, score, period, break, sponsors and more",
    piFunction: "Function",
    piClock: "Clock start / pause",
    piScore: "Score",
    piHome: "home",
    piAway: "away",
    piPeriodNext: "Next period",
    piBreak: "Break on / off",
    piFulltime: "End of match",
    piBoard: "Scoreboard only",
    piSponsors: "Scoreboard + sponsors",
    piBlackout: "Screen black on / off",
    piShotToggle: "Shot clock start / pause",
    piShotReset: "Shot clock to {n}",
    piTimeout: "Time-out",
    piTimeoutStop: "Stop time-out",
    piFoul: "Foul",
    piAdded: "Added time",
  },
  fr: {
    clock: "CHRONO",
    home: "DOM.",
    away: "EXT.",
    next: "SUIVANT",
    break: "PAUSE",
    resume: "REPRISE",
    fulltime: "FIN",
    board: "TABLEAU",
    sponsors: "SPONSORS",
    blackout: "NOIR",
    shot: "SHOT",
    timeout: "T-M",
    timeoutStop: "T-M STOP",
    foul: "FAUTE",
    penalty: "PÉNALITÉ",
    added: "ARRÊTS",
    half1: "MI-TEMPS 1",
    half2: "MI-TEMPS 2",
    quarter: "QT {n}",
    set: "SET {n}",
    overtime: "PROL. {n}",
    period: "P{n}",
    source: "SOURCE",
    key: "TOUCHE",
    piAction: "Touche tableau de score",
    piActionTooltip: "Pilotez le tableau de score : chrono, score, période, pause, sponsors et plus",
    piFunction: "Fonction",
    piClock: "Chrono démarrer / pause",
    piScore: "Score",
    piHome: "domicile",
    piAway: "extérieur",
    piPeriodNext: "Période suivante",
    piBreak: "Pause oui / non",
    piFulltime: "Fin du match",
    piBoard: "Tableau de score seul",
    piSponsors: "Tableau de score + sponsors",
    piBlackout: "Écran noir oui / non",
    piShotToggle: "Chrono des tirs démarrer / pause",
    piShotReset: "Chrono des tirs à {n}",
    piTimeout: "Temps mort",
    piTimeoutStop: "Arrêter le temps mort",
    piFoul: "Faute",
    piAdded: "Temps additionnel",
  },
  it: {
    clock: "CRONO",
    home: "CASA",
    away: "OSPITI",
    next: "AVANTI",
    break: "PAUSA",
    resume: "RIPRENDI",
    fulltime: "FINE",
    board: "TABELLONE",
    sponsors: "SPONSOR",
    blackout: "NERO",
    shot: "SHOT",
    timeout: "T-O",
    timeoutStop: "T-O STOP",
    foul: "FALLO",
    penalty: "PENALITÀ",
    added: "RECUPERO",
    half1: "1° TEMPO",
    half2: "2° TEMPO",
    quarter: "Q{n}",
    set: "SET {n}",
    overtime: "SUPPL. {n}",
    period: "P{n}",
    source: "FONTE",
    key: "TASTO",
    piAction: "Tasto tabellone",
    piActionTooltip: "Comanda il tabellone: cronometro, punteggio, periodo, pausa, sponsor e altro",
    piFunction: "Funzione",
    piClock: "Cronometro avvia / pausa",
    piScore: "Punteggio",
    piHome: "casa",
    piAway: "ospiti",
    piPeriodNext: "Periodo successivo",
    piBreak: "Pausa sì / no",
    piFulltime: "Fine partita",
    piBoard: "Solo tabellone",
    piSponsors: "Tabellone + sponsor",
    piBlackout: "Schermo nero sì / no",
    piShotToggle: "Cronometro di tiro avvia / pausa",
    piShotReset: "Cronometro di tiro a {n}",
    piTimeout: "Time-out",
    piTimeoutStop: "Ferma il time-out",
    piFoul: "Fallo",
    piAdded: "Recupero",
  },
  de: {
    clock: "UHR",
    home: "HEIM",
    away: "GAST",
    next: "WEITER",
    break: "PAUSE",
    resume: "FORTSETZEN",
    fulltime: "ENDE",
    board: "SCOREBOARD",
    sponsors: "SPONSOREN",
    blackout: "SCHWARZ",
    shot: "SHOT",
    timeout: "AUSZEIT",
    timeoutStop: "AUSZEIT STOP",
    foul: "FOUL",
    penalty: "STRAFE",
    added: "NACHSP.",
    half1: "1. HALBZEIT",
    half2: "2. HALBZEIT",
    quarter: "Q{n}",
    set: "SATZ {n}",
    overtime: "VERL. {n}",
    period: "P{n}",
    source: "QUELLE",
    key: "TASTE",
    piAction: "Scoreboard-Taste",
    piActionTooltip: "Scoreboard bedienen: Uhr, Spielstand, Abschnitt, Pause, Sponsoren und mehr",
    piFunction: "Funktion",
    piClock: "Uhr Start / Pause",
    piScore: "Spielstand",
    piHome: "Heim",
    piAway: "Gast",
    piPeriodNext: "Nächster Abschnitt",
    piBreak: "Pause an / aus",
    piFulltime: "Spielende",
    piBoard: "Nur Scoreboard",
    piSponsors: "Scoreboard + Sponsoren",
    piBlackout: "Bildschirm schwarz an / aus",
    piShotToggle: "Shotclock Start / Pause",
    piShotReset: "Shotclock auf {n}",
    piTimeout: "Auszeit",
    piTimeoutStop: "Auszeit beenden",
    piFoul: "Foul",
    piAdded: "Nachspielzeit",
  },
};

/** Wat de livestream-knoppen van de studio nodig hebben. */
export type DeckStream = {
  running: boolean;
  recording: boolean;
  scenes: { name: string; program: boolean; preview: boolean }[];
  slots: StreamDeckSlot[];
};

export type DeckFaceContext = {
  live: DeckLive;
  stream: DeckStream | null;
  texts: DeckTexts;
  now: number;
};

/**
 * Kleur van de knop: `go` loopt of staat aan, `stop` staat stil of is een harde ingreep die actief is,
 * `warn` is een pauze of time-out, `off` doet voor deze wedstrijd niets.
 */
export type DeckTone = "idle" | "info" | "go" | "stop" | "warn" | "home" | "away" | "off";

export type DeckFace = { label: string; value: string; tone: DeckTone };

const NONE = "—";
const MINUS = "−";

function withNumber(template: string, n: number): string {
  return template.replace("{n}", String(n));
}

function teamLabel(match: DeckMatch | null, side: DeckSide, texts: DeckTexts): string {
  const name = (side === "home" ? match?.homeName : match?.awayName)?.trim() ?? "";
  // Een korte clubcode past op de knop; een volledige naam niet.
  if (name && name.length <= 5) return name.toUpperCase();
  return side === "home" ? texts.home : texts.away;
}

export function deckPeriodName(sport: unknown, period: number, texts: DeckTexts): string {
  const d = describePeriod(sport, period);
  if (d.kind === "half") return d.index === 1 ? texts.half1 : texts.half2;
  if (d.kind === "quarter") return withNumber(texts.quarter, d.index);
  if (d.kind === "set") return withNumber(texts.set, d.index);
  if (d.kind === "overtime") return withNumber(texts.overtime, d.index);
  return withNumber(texts.period, d.index);
}

function countdownText(seconds: number): string {
  const s = Math.ceil(Math.max(0, seconds) - 1e-9);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function clockFace(ctx: DeckFaceContext): DeckFace {
  const { state, match } = ctx.live;
  const label = ctx.texts.clock;
  if (!state) return { label, value: NONE, tone: "off" };
  const sport = match?.sport ?? "FOOTBALL";
  if (match && getSportProfile(sport).timerMode === "NONE") return { label, value: NONE, tone: "off" };
  const elapsed = computeElapsedSeconds(state, ctx.now);
  const shown = match
    ? sportClockSeconds(sport, elapsed, match.periodDurationSec, match.currentPeriod)
    : elapsed;
  return { label, value: formatSportClock(sport, shown), tone: state.timerRunning ? "go" : "stop" };
}

function scoreFace(side: DeckSide, step: string, tone: DeckTone, ctx: DeckFaceContext, usable = true): DeckFace {
  const match = ctx.live.match;
  const label = `${teamLabel(match, side, ctx.texts)} ${step}`;
  if (!match || !usable) return { label, value: NONE, tone: "off" };
  return { label, value: String(side === "home" ? match.homeScore : match.awayScore), tone };
}

function studioFace(action: StreamDeckAction, ctx: DeckFaceContext, depth: number): DeckFace {
  const { texts, stream } = ctx;
  if (action.id === "timer") return clockFace(ctx);
  if (action.id === "score") {
    return action.delta === 1
      ? scoreFace(action.side, "+1", action.side, ctx)
      : scoreFace(action.side, `${MINUS}1`, "idle", ctx);
  }
  if (action.id === "blackout") {
    return { label: texts.blackout, value: "", tone: ctx.live.state?.mode === "BLACKOUT" ? "stop" : "idle" };
  }
  if (action.id === "cut") return { label: "CUT", value: "", tone: stream ? "idle" : "off" };
  if (action.id === "stream") {
    if (!stream) return { label: "LIVE", value: "", tone: "off" };
    return { label: stream.running ? "ON AIR" : "LIVE", value: "", tone: stream.running ? "stop" : "idle" };
  }
  if (action.id === "record") {
    if (!stream) return { label: "REC", value: "", tone: "off" };
    return { label: "REC", value: stream.recording ? "●" : "", tone: stream.recording ? "stop" : "idle" };
  }
  if (action.id === "input" || action.id === "preview") {
    const scene = stream?.scenes[action.index - 1];
    const fallback = `${texts.source} ${action.index}`;
    if (!scene) return { label: fallback, value: "", tone: "off" };
    const name = (scene.name.trim() || fallback).slice(0, 12);
    if (scene.program) return { label: "PGM", value: name, tone: "stop" };
    if (scene.preview) return { label: "NEXT", value: name, tone: "go" };
    return { label: action.id === "preview" ? "CUE" : "", value: name, tone: "idle" };
  }
  // Een eigen studio-knop toont de functie die erachter zit, met het eigen label als dat er is.
  const slot = stream?.slots[action.index - 1];
  if (!slot || slot.action.id === "key" || depth > 0) {
    return { label: `${texts.key} ${action.index}`, value: "", tone: "off" };
  }
  const face = studioFace(slot.action, ctx, depth + 1);
  const title = slot.title.trim();
  return title ? { ...face, label: title.toUpperCase() } : face;
}

function boardFace(action: BoardDeckAction, ctx: DeckFaceContext): DeckFace {
  const { texts, live, now } = ctx;
  const { match, state } = live;
  const usable = boardDeckPlan(action, live).ok;
  const mode = state?.mode;

  if (action.id === "display") {
    const wanted = action.mode === "sponsors" ? "SPONSOR_ROTATION" : "MATCH";
    return {
      label: action.mode === "sponsors" ? texts.sponsors : texts.board,
      value: "",
      tone: mode === wanted ? "go" : "idle",
    };
  }
  if (action.id === "points") return scoreFace(action.side, `+${action.points}`, action.side, ctx, usable);
  if (action.id === "period") {
    const next = match ? nextDeckPeriod(match) : null;
    if (!match || next == null) return { label: texts.next, value: NONE, tone: "off" };
    return { label: texts.next, value: deckPeriodName(match.sport, next, texts), tone: "info" };
  }
  if (action.id === "break") {
    if (!match) return { label: texts.break, value: "", tone: "off" };
    if (match.status !== "HALF_TIME") return { label: texts.break, value: "", tone: "idle" };
    const left = state?.breakRunning ? computeBreakSeconds(state, now) : 0;
    return { label: texts.break, value: left > 0 ? countdownText(left) : texts.resume, tone: "warn" };
  }
  if (action.id === "fulltime") {
    if (!match) return { label: texts.fulltime, value: "", tone: "off" };
    const over = match.status === "FULL_TIME" || match.status === "POST_MATCH";
    return { label: texts.fulltime, value: "", tone: over ? "stop" : "idle" };
  }
  if (action.id === "shotclock") {
    if (!usable || !state) {
      return { label: texts.shot, value: action.mode === "reset" ? String(action.seconds) : NONE, tone: "off" };
    }
    if (action.mode === "reset") return { label: texts.shot, value: String(action.seconds), tone: "info" };
    if (state.shotClockOff || state.shotClockDisabled) return { label: texts.shot, value: NONE, tone: "idle" };
    return {
      label: texts.shot,
      value: formatShotClock(computeShotClockSeconds(state, now)),
      tone: state.shotClockRunning ? "go" : "stop",
    };
  }
  if (action.id === "timeout") {
    const left = state?.timeoutRunning ? computeTimeoutSeconds(state, now) : 0;
    if (action.side === "clear") {
      return { label: texts.timeoutStop, value: left > 0 ? countdownText(left) : "", tone: left > 0 ? "warn" : "idle" };
    }
    const label = `${texts.timeout} ${teamLabel(match, action.side, texts)}`;
    if (!match || !usable) return { label, value: NONE, tone: "off" };
    if (left > 0 && state?.timeoutSide === action.side) return { label, value: countdownText(left), tone: "warn" };
    const used = action.side === "home" ? match.homeTimeouts : match.awayTimeouts;
    return { label, value: `${used}/${timeoutLimitForMatch(match)}`, tone: "idle" };
  }
  if (action.id === "foul") {
    const word = match && getSportProfile(match.sport).id === "HOCKEY" ? texts.penalty : texts.foul;
    const label = `${word} ${teamLabel(match, action.side, texts)} ${action.delta === 1 ? "+" : MINUS}`;
    if (!match || !usable) return { label, value: NONE, tone: "off" };
    return { label, value: String(action.side === "home" ? match.homeFouls : match.awayFouls), tone: "idle" };
  }
  const label = `${texts.added} ${action.delta === 1 ? "+" : MINUS}1`;
  if (!usable) return { label, value: NONE, tone: "off" };
  return { label, value: `+${Math.max(0, Math.floor(state?.addedTimeMinutes ?? 0))}'`, tone: "idle" };
}

/** Het gezicht van de knop achter een localhost-pad. Een onbekend pad geeft een dode knop met "?". */
export function deckFace(path: string, ctx: DeckFaceContext): DeckFace {
  const studio = parseStreamDeckPath(path);
  if (studio) return studioFace(studio, ctx, 0);
  const board = parseBoardDeckPath(path);
  if (board) return boardFace(board, ctx);
  return { label: "?", value: "", tone: "off" };
}

/** Naam van een scorebordknop in de keuzelijst van Stream Deck. */
export function deckPathName(path: string, texts: DeckTexts): string {
  const side = (s: DeckSide) => (s === "home" ? texts.piHome : texts.piAway);
  const studio = parseStreamDeckPath(path);
  if (studio?.id === "timer") return texts.piClock;
  if (studio?.id === "score") return `${texts.piScore} ${side(studio.side)} ${studio.delta === 1 ? "+1" : `${MINUS}1`}`;
  if (studio?.id === "blackout") return texts.piBlackout;
  if (studio) return streamDeckActionPath(studio);
  const board = parseBoardDeckPath(path);
  if (!board) return path;
  if (board.id === "points") return `${texts.piScore} ${side(board.side)} +${board.points}`;
  if (board.id === "period") return texts.piPeriodNext;
  if (board.id === "break") return texts.piBreak;
  if (board.id === "fulltime") return texts.piFulltime;
  if (board.id === "display") return board.mode === "sponsors" ? texts.piSponsors : texts.piBoard;
  if (board.id === "shotclock") {
    return board.mode === "reset" ? withNumber(texts.piShotReset, board.seconds) : texts.piShotToggle;
  }
  if (board.id === "timeout") {
    return board.side === "clear" ? texts.piTimeoutStop : `${texts.piTimeout} ${side(board.side)}`;
  }
  if (board.id === "foul") return `${texts.piFoul} ${side(board.side)} ${board.delta === 1 ? "+1" : `${MINUS}1`}`;
  return `${texts.piAdded} ${board.delta === 1 ? "+1" : `${MINUS}1`}`;
}

const TONES: Record<DeckTone, { bg: string; text: string; label: string }> = {
  idle: { bg: "#262a33", text: "#ffffff", label: "#c3c9d4" },
  info: { bg: "#3b4658", text: "#ffffff", label: "#d5dae3" },
  go: { bg: "#15803d", text: "#ffffff", label: "#dcfce7" },
  stop: { bg: "#b91c1c", text: "#ffffff", label: "#fee2e2" },
  warn: { bg: "#b45309", text: "#ffffff", label: "#fef3c7" },
  home: { bg: "#1d4ed8", text: "#ffffff", label: "#dbeafe" },
  away: { bg: "#c2410c", text: "#ffffff", label: "#ffedd5" },
  off: { bg: "#141518", text: "#5d636e", label: "#5d636e" },
};

function xml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Grootste lettergrootte waarbij de tekst nog binnen de knop valt (vette hoofdletters ≈ 0,62 em breed). */
function fit(text: string, max: number): number {
  return Math.max(12, Math.min(max, Math.floor(128 / (Math.max(1, text.length) * 0.62))));
}

function splitLabel(label: string): string[] {
  if (label.length <= 8 || !label.includes(" ")) return [label];
  const middle = label.length / 2;
  let cut = -1;
  for (let i = 0; i < label.length; i += 1) {
    if (label[i] === " " && (cut < 0 || Math.abs(i - middle) < Math.abs(cut - middle))) cut = i;
  }
  return [label.slice(0, cut), label.slice(cut + 1)];
}

/** De knop als SVG van 144×144, het formaat van een Stream Deck-toets. */
export function deckFaceSvg(face: DeckFace): string {
  const tone = TONES[face.tone];
  const text = (value: string, y: number, size: number, fill: string) =>
    `<text x="72" y="${y}" font-size="${size}" fill="${fill}">${xml(value)}</text>`;
  const lines: string[] = [];
  if (face.value) {
    if (face.label) lines.push(text(face.label, 40, fit(face.label, 25), tone.label));
    const size = fit(face.value, 62);
    lines.push(text(face.value, (face.label ? 92 : 72) + Math.round(size * 0.36), size, tone.text));
  } else {
    const parts = splitLabel(face.label);
    const size = fit(parts.reduce((a, b) => (b.length > a.length ? b : a), ""), parts.length > 1 ? 30 : 34);
    if (parts.length > 1) {
      lines.push(text(parts[0]!, 64, size, tone.text), text(parts[1]!, 64 + Math.round(size * 1.2), size, tone.text));
    } else {
      lines.push(text(parts[0]!, 72 + Math.round(size * 0.36), size, tone.text));
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
    `<rect width="144" height="144" rx="18" fill="${tone.bg}"/>` +
    `<g font-family="Segoe UI, Arial, sans-serif" font-weight="700" text-anchor="middle">${lines.join("")}</g>` +
    `</svg>`
  );
}

/** Korte vingerafdruk: de plug-in stuurt hem terug en krijgt pas antwoord als er iets veranderde. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export const DECK_FACES_MAX_PATHS = 64;

export type DeckFaces = { etag: string; faces: Record<string, { svg: string }> };

/** De knoppen voor alle paden die de plug-in nu toont. */
export function deckFaces(paths: string[], ctx: DeckFaceContext): DeckFaces {
  // Zonder prototype: een pad als "/constructor" is dan gewoon een onbekende knop.
  const faces: Record<string, { svg: string }> = Object.create(null);
  for (const path of paths.slice(0, DECK_FACES_MAX_PATHS)) {
    if (!(path in faces)) faces[path] = { svg: deckFaceSvg(deckFace(path, ctx)) };
  }
  return { etag: fingerprint(JSON.stringify(faces)), faces };
}
