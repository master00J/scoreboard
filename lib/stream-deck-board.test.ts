import { describe, expect, it } from "vitest";
import { parseStreamDeckPath } from "./stream-deck";
import {
  BOARD_DECK_PATHS,
  DECK_QUICK_SLOTS,
  boardDeckPlan,
  nextDeckPeriod,
  parseBoardDeckPath,
  type DeckLive,
  type DeckMatch,
  type DeckState,
} from "./stream-deck-board";
import { deckMatch, deckState } from "./stream-deck-board.fixtures";

function live(match: Partial<DeckMatch> | null = {}, state: Partial<DeckState> = {}): DeckLive {
  return { state: deckState(state), match: match ? deckMatch(match) : null };
}

function plan(path: string, context: DeckLive) {
  const action = parseBoardDeckPath(path);
  if (!action) throw new Error(`geen scorebordpad: ${path}`);
  return boardDeckPlan(action, context);
}

describe("parseBoardDeckPath", () => {
  it("kent elk pad uit de keuzelijst, als bestaande of als nieuwe knop", () => {
    for (const path of BOARD_DECK_PATHS) {
      expect(parseStreamDeckPath(path) ?? parseBoardDeckPath(path), path).not.toBeNull();
    }
  });

  it("laat de bestaande paden met rust", () => {
    expect(parseBoardDeckPath("/timer/toggle")).toBeNull();
    expect(parseBoardDeckPath("/score/home/up")).toBeNull();
    expect(parseBoardDeckPath("/blackout")).toBeNull();
  });

  it("leest kant, punten en seconden", () => {
    expect(parseBoardDeckPath("/score/away/plus3")).toEqual({ id: "points", side: "away", points: 3 });
    expect(parseBoardDeckPath("/shotclock/reset/14/")).toEqual({ id: "shotclock", mode: "reset", seconds: 14 });
    expect(parseBoardDeckPath("/foul/home/down")).toEqual({ id: "foul", side: "home", delta: -1 });
    expect(parseBoardDeckPath("/score/home/plus4")).toBeNull();
    expect(parseBoardDeckPath("/shotclock/reset/0")).toBeNull();
    expect(parseBoardDeckPath("/timeout/both")).toBeNull();
  });

  it("kent de snelle mediaknoppen 1 tot en met het aantal toetsen dat ervoor is", () => {
    expect(parseBoardDeckPath("/quick/1")).toEqual({ id: "quick", index: 1 });
    expect(parseBoardDeckPath(`/quick/${DECK_QUICK_SLOTS}`)).toEqual({ id: "quick", index: DECK_QUICK_SLOTS });
    expect(parseBoardDeckPath("/quick/0")).toBeNull();
    expect(parseBoardDeckPath(`/quick/${DECK_QUICK_SLOTS + 1}`)).toBeNull();
    expect(parseBoardDeckPath("/quick/12")).toBeNull();
    expect(BOARD_DECK_PATHS.filter((path) => path.startsWith("/quick/"))).toHaveLength(DECK_QUICK_SLOTS);
  });
});

describe("volgende periode", () => {
  it("begint vóór de aftrap bij periode 1", () => {
    expect(nextDeckPeriod(deckMatch({ status: "PREMATCH", currentPeriod: 2 }))).toBe(1);
    expect(plan("/period/next", live({ status: "SETUP" }))).toEqual({
      ok: true,
      commands: [{ type: "sport:setPeriod", period: 1 }],
    });
  });

  it("gaat tijdens het spel en in de pauze naar de periode erna", () => {
    expect(nextDeckPeriod(deckMatch({ status: "FIRST_HALF", currentPeriod: 1 }))).toBe(2);
    expect(nextDeckPeriod(deckMatch({ status: "HALF_TIME", currentPeriod: 1 }))).toBe(2);
    expect(nextDeckPeriod(deckMatch({ sport: "BASKETBALL", status: "SECOND_HALF", currentPeriod: 3 }))).toBe(4);
  });

  it("biedt verlenging aan waar de sport die kent en stopt bij de laatste periode", () => {
    expect(nextDeckPeriod(deckMatch({ status: "SECOND_HALF", currentPeriod: 2 }))).toBe(3);
    expect(nextDeckPeriod(deckMatch({ status: "EXTRA_TIME", currentPeriod: 4 }))).toBeNull();
    expect(nextDeckPeriod(deckMatch({ sport: "HOCKEY", status: "SECOND_HALF", currentPeriod: 4 }))).toBeNull();
    expect(plan("/period/next", live({ sport: "HOCKEY", status: "SECOND_HALF", currentPeriod: 4 }))).toEqual({
      ok: false,
      issue: "noNextPeriod",
    });
  });

  it("doet niets meer na het einde van de wedstrijd", () => {
    expect(nextDeckPeriod(deckMatch({ status: "FULL_TIME", currentPeriod: 1 }))).toBeNull();
  });

  it("telt bij volleybal tot het aantal sets van de wedstrijd", () => {
    expect(nextDeckPeriod(deckMatch({ sport: "VOLLEYBALL", currentPeriod: 3, setsToWin: 2 }))).toBeNull();
    expect(nextDeckPeriod(deckMatch({ sport: "VOLLEYBALL", currentPeriod: 3, setsToWin: 3 }))).toBe(4);
  });
});

describe("boardDeckPlan", () => {
  it("weigert wedstrijdknoppen zonder actieve wedstrijd", () => {
    for (const path of ["/period/next", "/break", "/fulltime", "/score/home/plus2", "/foul/home/up", "/addedtime/up"]) {
      expect(plan(path, live(null)), path).toEqual({ ok: false, issue: "noMatch" });
    }
  });

  it("zet rust aan en hervat het spel met dezelfde knop", () => {
    expect(plan("/break", live({ status: "FIRST_HALF" }))).toEqual({
      ok: true,
      commands: [{ type: "match:setStatus", status: "HALF_TIME" }],
    });
    expect(plan("/break", live({ status: "HALF_TIME" }))).toEqual({
      ok: true,
      commands: [{ type: "sport:resumePlay" }],
    });
  });

  it("kiest het scherm en onthoudt die keuze, ook zonder wedstrijd", () => {
    expect(plan("/display/sponsors", live(null))).toEqual({
      ok: true,
      commands: [
        {
          type: "display:setMode",
          mode: "SPONSOR_ROTATION",
          meta: { persistSponsorPreference: true, activeMediaId: null },
        },
      ],
    });
    const board = plan("/display/board", live());
    expect(board.ok && board.commands[0]).toMatchObject({ type: "display:setMode", mode: "MATCH" });
  });

  it("start de snelle mediaknop van de regie die op die plaats staat, ook zonder wedstrijd", () => {
    const quick = [
      { id: "m-hymne", label: "Clublied" },
      { id: "m-brand", label: "Evacuatie" },
    ];
    expect(plan("/quick/2", { ...live(null), quick })).toEqual({
      ok: true,
      commands: [{ type: "display:setMode", mode: "SPONSOR", meta: { activeMediaId: "m-brand" } }],
    });
    // Nog eens drukken terwijl de clip loopt start hem opnieuw, net als in de regie.
    expect(plan("/quick/1", { ...live({}, { mode: "SPONSOR", activeMediaId: "m-hymne" }), quick })).toEqual({
      ok: true,
      commands: [{ type: "display:setMode", mode: "SPONSOR", meta: { activeMediaId: "m-hymne" } }],
    });
  });

  it("weigert een snelle knop waar de regie er geen heeft", () => {
    expect(plan("/quick/3", { ...live(), quick: [{ id: "m-hymne", label: "Clublied" }] })).toEqual({
      ok: false,
      issue: "noQuickButton",
    });
    expect(plan("/quick/1", live())).toEqual({ ok: false, issue: "noQuickButton" });
  });

  it("geeft +2 en +3 alleen waar de sport zo telt", () => {
    expect(plan("/score/home/plus3", live({ sport: "BASKETBALL" }))).toEqual({
      ok: true,
      commands: [{ type: "score:adjust", side: "home", delta: 3 }],
    });
    expect(plan("/score/home/plus2", live({ sport: "FOOTBALL" }))).toEqual({ ok: false, issue: "notForSport" });
  });

  it("start of pauzeert de shotclock naargelang hij loopt", () => {
    const basket = { sport: "BASKETBALL" };
    expect(plan("/shotclock/toggle", live(basket, { shotClockRunning: false }))).toEqual({
      ok: true,
      commands: [{ type: "shotclock:start" }],
    });
    expect(plan("/shotclock/toggle", live(basket, { shotClockRunning: true }))).toEqual({
      ok: true,
      commands: [{ type: "shotclock:pause" }],
    });
    expect(plan("/shotclock/reset/14", live(basket))).toEqual({
      ok: true,
      commands: [{ type: "shotclock:reset", seconds: 14 }],
    });
  });

  it("kent geen shotclock bij voetbal en geen waarde buiten de presets", () => {
    expect(plan("/shotclock/toggle", live())).toEqual({ ok: false, issue: "notForSport" });
    expect(plan("/shotclock/reset/30", live({ sport: "BASKETBALL" }))).toEqual({ ok: false, issue: "notForSport" });
  });

  it("start een time-out alleen waar de sport er nu een toelaat", () => {
    expect(plan("/timeout/away", live({ sport: "BASKETBALL" }))).toEqual({
      ok: true,
      commands: [{ type: "timeout:start", side: "away" }],
    });
    expect(plan("/timeout/home", live({ sport: "FOOTBALL" }))).toEqual({ ok: false, issue: "notForSport" });
    // Futsal: geen time-outs in de verlenging.
    expect(plan("/timeout/home", live({ sport: "FUTSAL", status: "EXTRA_TIME", currentPeriod: 3 }))).toEqual({
      ok: false,
      issue: "notForSport",
    });
  });

  it("stopt een time-out: volleybal hervat het spel, de rest stopt de time-outklok", () => {
    expect(plan("/timeout/clear", live({ sport: "VOLLEYBALL" }))).toEqual({
      ok: true,
      commands: [{ type: "sport:resumePlay" }],
    });
    expect(plan("/timeout/clear", live({ sport: "BASKETBALL" }))).toEqual({
      ok: true,
      commands: [{ type: "timeout:clear" }],
    });
    expect(plan("/timeout/clear", live(null))).toEqual({ ok: true, commands: [{ type: "timeout:clear" }] });
  });

  it("telt fouten waar de sport ze bijhoudt", () => {
    expect(plan("/foul/away/up", live({ sport: "FUTSAL" }))).toEqual({
      ok: true,
      commands: [{ type: "sport:statAdjust", stat: "foul", side: "away", delta: 1 }],
    });
    expect(plan("/foul/away/up", live({ sport: "FOOTBALL" }))).toEqual({ ok: false, issue: "notForSport" });
  });

  it("zet extra tijd een minuut hoger of lager, tussen 0 en 30", () => {
    expect(plan("/addedtime/up", live({}, { addedTimeMinutes: 2 }))).toEqual({
      ok: true,
      commands: [{ type: "timer:setAddedTime", minutes: 3 }],
    });
    expect(plan("/addedtime/down", live({}, { addedTimeMinutes: 0 }))).toEqual({
      ok: true,
      commands: [{ type: "timer:setAddedTime", minutes: 0 }],
    });
    expect(plan("/addedtime/up", live({}, { addedTimeMinutes: 30 }))).toEqual({
      ok: true,
      commands: [{ type: "timer:setAddedTime", minutes: 30 }],
    });
    expect(plan("/addedtime/up", live({ sport: "BASKETBALL" }))).toEqual({ ok: false, issue: "notForSport" });
  });
});
