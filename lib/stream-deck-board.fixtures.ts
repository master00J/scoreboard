/** Testgegevens voor de Stream Deck-knoppen: een voetbalwedstrijd in de eerste helft, klok stil. */
import type { DeckMatch, DeckState } from "./stream-deck-board";

export function deckMatch(patch: Partial<DeckMatch> = {}): DeckMatch {
  return {
    sport: "FOOTBALL",
    status: "FIRST_HALF",
    currentPeriod: 1,
    periodDurationSec: 2700,
    homeScore: 0,
    awayScore: 0,
    homeFouls: 0,
    awayFouls: 0,
    homeTimeouts: 0,
    awayTimeouts: 0,
    homeName: "",
    awayName: "",
    ...patch,
  };
}

export function deckState(patch: Partial<DeckState> = {}): DeckState {
  return {
    mode: "MATCH",
    activeMediaId: null,
    timerRunning: false,
    timerStartedAt: null,
    timerBaseSec: 0,
    shotClockRunning: false,
    shotClockStartedAt: null,
    shotClockBaseSec: 24,
    shotClockOff: false,
    shotClockDisabled: false,
    timeoutRunning: false,
    timeoutStartedAt: null,
    timeoutBaseSec: 0,
    timeoutSide: null,
    breakRunning: false,
    breakStartedAt: null,
    breakBaseSec: 0,
    addedTimeMinutes: 0,
    ...patch,
  };
}
