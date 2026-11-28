/**
 * Strafschoppenreeks (voetbal, futsal) of shoot-out (hockey) na een gelijkspel.
 *
 * Bewaard als JSON in `Match.shootoutJson`; `null` = geen reeks. De doelpunten van de reeks
 * tellen niet mee in `homeScore`/`awayScore`: de wedstrijd blijft bv. 2–2, de reeks wordt 4–3.
 *
 * Volgorde is altijd A-B-A-B (IFAB Wet 10, FIH shoot-out): het team dat begint, trapt als eerste
 * in elke ronde. Na de reguliere rondes volgt sudden death, ronde per ronde.
 */

import { normalizeSport } from "./sports";

export type ShootoutSide = "home" | "away";

export type ShootoutKick = { side: ShootoutSide; scored: boolean };

export type PenaltyShootout = {
  firstSide: ShootoutSide;
  /** Reguliere rondes per team vóór sudden death (5 volgens IFAB/FIH; jeugd soms 3). */
  rounds: number;
  kicks: ShootoutKick[];
  /** Overlay op het stadionscherm tonen. */
  onScreen: boolean;
};

export const SHOOTOUT_DEFAULT_ROUNDS = 5;
export const SHOOTOUT_MIN_ROUNDS = 1;
export const SHOOTOUT_MAX_ROUNDS = 10;
/** Bovengrens zodat een kapotte of extreme reeks het scherm en de database niet laat ontsporen. */
export const SHOOTOUT_MAX_KICKS = 200;

function normalizeSide(value: unknown): ShootoutSide | null {
  return value === "home" || value === "away" ? value : null;
}

export function normalizeShootoutRounds(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return SHOOTOUT_DEFAULT_ROUNDS;
  return Math.min(SHOOTOUT_MAX_ROUNDS, Math.max(SHOOTOUT_MIN_ROUNDS, Math.floor(n)));
}

/**
 * Leest `Match.shootoutJson`. Onleesbare of lege waarden worden `null` (geen reeks), zodat een
 * kapotte kolom het stadionscherm nooit laat crashen. Trappen buiten de beurtvolgorde worden
 * afgekapt op de eerste fout.
 */
export function parseShootout(raw: unknown): PenaltyShootout | null {
  if (raw == null || raw === "") return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const firstSide = normalizeSide(obj.firstSide);
  if (!firstSide) return null;
  const base: PenaltyShootout = {
    firstSide,
    rounds: normalizeShootoutRounds(obj.rounds),
    kicks: [],
    onScreen: obj.onScreen !== false,
  };
  const rawKicks = Array.isArray(obj.kicks) ? obj.kicks : [];
  let current = base;
  for (const item of rawKicks.slice(0, SHOOTOUT_MAX_KICKS)) {
    if (!item || typeof item !== "object") break;
    const side = normalizeSide((item as Record<string, unknown>).side);
    if (!side) break;
    const next = addShootoutKick(current, side, (item as Record<string, unknown>).scored === true);
    if (!next.ok) break;
    current = next.shootout;
  }
  return current;
}

export function serializeShootout(shootout: PenaltyShootout | null): string | null {
  if (!shootout) return null;
  return JSON.stringify({
    firstSide: shootout.firstSide,
    rounds: shootout.rounds,
    kicks: shootout.kicks.map((kick) => ({ side: kick.side, scored: kick.scored })),
    onScreen: shootout.onScreen,
  });
}

export function createShootout(firstSide: ShootoutSide, rounds: unknown = SHOOTOUT_DEFAULT_ROUNDS): PenaltyShootout {
  return { firstSide, rounds: normalizeShootoutRounds(rounds), kicks: [], onScreen: true };
}

export type ShootoutTally = {
  homeScored: number;
  awayScored: number;
  homeTaken: number;
  awayTaken: number;
};

export function shootoutTally(shootout: PenaltyShootout): ShootoutTally {
  const tally: ShootoutTally = { homeScored: 0, awayScored: 0, homeTaken: 0, awayTaken: 0 };
  for (const kick of shootout.kicks) {
    if (kick.side === "home") {
      tally.homeTaken += 1;
      if (kick.scored) tally.homeScored += 1;
    } else {
      tally.awayTaken += 1;
      if (kick.scored) tally.awayScored += 1;
    }
  }
  return tally;
}

/**
 * Winnaar zodra die vaststaat. In de reguliere rondes stopt de reeks zodra het andere team de
 * achterstand niet meer kan goedmaken met de trappen die het nog heeft; in sudden death na elke
 * volledige ronde met een verschil.
 */
export function shootoutWinner(shootout: PenaltyShootout): ShootoutSide | null {
  const { homeScored, awayScored, homeTaken, awayTaken } = shootoutTally(shootout);
  const rounds = shootout.rounds;
  if (homeTaken <= rounds && awayTaken <= rounds) {
    const homeLeft = rounds - homeTaken;
    const awayLeft = rounds - awayTaken;
    if (homeScored > awayScored + awayLeft) return "home";
    if (awayScored > homeScored + homeLeft) return "away";
    return null;
  }
  if (homeTaken === awayTaken && homeScored !== awayScored) {
    return homeScored > awayScored ? "home" : "away";
  }
  return null;
}

export function shootoutIsSuddenDeath(shootout: PenaltyShootout): boolean {
  const { homeTaken, awayTaken } = shootoutTally(shootout);
  return Math.min(homeTaken, awayTaken) >= shootout.rounds;
}

/** Wie trapt nu, of `null` als de reeks beslist is. */
export function shootoutNextSide(shootout: PenaltyShootout): ShootoutSide | null {
  if (shootoutWinner(shootout)) return null;
  const { homeTaken, awayTaken } = shootoutTally(shootout);
  if (homeTaken === awayTaken) return shootout.firstSide;
  return homeTaken < awayTaken ? "home" : "away";
}

export type AddKickResult =
  | { ok: true; shootout: PenaltyShootout }
  | { ok: false; reason: "decided" | "wrongSide" | "tooManyKicks" };

export function addShootoutKick(shootout: PenaltyShootout, side: ShootoutSide, scored: boolean): AddKickResult {
  if (shootout.kicks.length >= SHOOTOUT_MAX_KICKS) return { ok: false, reason: "tooManyKicks" };
  const next = shootoutNextSide(shootout);
  if (!next) return { ok: false, reason: "decided" };
  if (next !== side) return { ok: false, reason: "wrongSide" };
  return { ok: true, shootout: { ...shootout, kicks: [...shootout.kicks, { side, scored }] } };
}

export function undoShootoutKick(shootout: PenaltyShootout): PenaltyShootout {
  if (shootout.kicks.length === 0) return shootout;
  return { ...shootout, kicks: shootout.kicks.slice(0, -1) };
}

export type ShootoutMark = "scored" | "missed" | "pending";

/**
 * Bolletjes per team voor het scherm: altijd minstens de reguliere rondes, in sudden death
 * aangevuld tot de lopende ronde. `maxMarks` toont alleen de laatste rondes, zodat een lange
 * sudden death op een smal LED-scherm leesbaar blijft.
 */
export function shootoutMarks(
  shootout: PenaltyShootout,
  maxMarks = SHOOTOUT_MAX_ROUNDS,
): { home: ShootoutMark[]; away: ShootoutMark[] } {
  const home: ShootoutMark[] = [];
  const away: ShootoutMark[] = [];
  for (const kick of shootout.kicks) {
    (kick.side === "home" ? home : away).push(kick.scored ? "scored" : "missed");
  }
  const slots = Math.max(shootout.rounds, home.length, away.length);
  while (home.length < slots) home.push("pending");
  while (away.length < slots) away.push("pending");
  const limit = Math.max(1, Math.floor(maxMarks));
  const start = Math.max(0, slots - limit);
  return { home: home.slice(start), away: away.slice(start) };
}

/** Sporten waar een wedstrijd met een strafschoppenreeks of shoot-out kan eindigen. */
export function sportSupportsShootout(sport: unknown): boolean {
  const id = normalizeSport(sport);
  return id === "FOOTBALL" || id === "FUTSAL" || id === "HOCKEY";
}

/**
 * Waarom de reeks nu niet op het stadionscherm staat, of null als hij er wel staat.
 * - "hidden": de operator zette "Op stadionscherm" uit.
 * - "playing": er loopt nog een speelperiode; de reeks hoort na het eindsignaal.
 * - "screenMode": het scherm toont iets anders dan het scorebord (bv. sponsors); de reeks
 *   verschijnt alleen over het scorebord, zodat hij geen sponsorclip afdekt die zendtijd telt.
 */
export type ShootoutScreenBlock = "hidden" | "playing" | "screenMode";

export function shootoutScreenBlock(opts: {
  onScreen: boolean;
  displayMode: string | null | undefined;
  /** Eerste/tweede helft of verlenging: dan staan er sponsorclips naast het scorebord. */
  periodPlaying: boolean;
}): ShootoutScreenBlock | null {
  if (!opts.onScreen) return "hidden";
  if (opts.periodPlaying) return "playing";
  if (opts.displayMode !== "MATCH" && opts.displayMode !== "FULLTIME") return "screenMode";
  return null;
}
