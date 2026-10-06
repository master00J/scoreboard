import { describe, expect, it } from "vitest";
import { formatSportClock } from "../sports";
import { computeElapsedSeconds, computeShotClockSeconds, pauseShotClockAt, runFrom, stopAt } from "../timer";
import {
  gameSyncHasWork,
  planGameClockSync,
  planShotClockSync,
  type GameSyncPlan,
  type GameSyncState,
  type ShotSyncState,
  type SyncMatch,
} from "./sync";
import { ClockTracker, type ClockEstimate } from "./tracker";

const BASKET: SyncMatch = { sport: "BASKETBALL", currentPeriod: 1, periodDurationSec: 600 };
const FOOTBALL: SyncMatch = { sport: "FOOTBALL", currentPeriod: 1, periodDurationSec: 2700 };
const T0 = Date.parse("2026-10-06T19:00:00Z");

const stoppedAt = (elapsed: number): GameSyncState => ({ ...stopAt(elapsed) });
const runningFrom = (elapsed: number, atMs: number): GameSyncState => ({ ...runFrom(elapsed, new Date(atMs)) });

function official(partial: Partial<ClockEstimate> & { shown: number }): ClockEstimate {
  return { running: false, resolution: 1, direction: "down", value: partial.shown, feedLagSec: 0.2, ageSec: 0, ...partial };
}

/** Voert een plan uit zoals de app dat doet: stand, dan het commando, dan de fijnafstelling. */
function applyGame(state: GameSyncState, plan: GameSyncPlan, nowMs: number): GameSyncState {
  let next = state;
  if (plan.before) next = { ...next, ...plan.before };
  if (plan.command === "timer:start") next = { ...next, ...runFrom(computeElapsedSeconds(next, nowMs), new Date(nowMs)) };
  if (plan.command === "timer:pause") next = { ...next, ...stopAt(computeElapsedSeconds(next, nowMs)) };
  if (plan.after) next = { ...next, ...plan.after };
  return next;
}

describe("planGameClockSync", () => {
  it("leaves a clock alone that already shows what the console shows", () => {
    const plan = planGameClockSync({ state: stoppedAt(0), match: BASKET, official: official({ shown: 600 }), nowMs: T0 });
    expect(gameSyncHasWork(plan)).toBe(false);
    expect(plan.hold).toBeNull();
  });

  it("sets a stopped clock to the console's value without a command", () => {
    const plan = planGameClockSync({ state: stoppedAt(0), match: BASKET, official: official({ shown: 485 }), nowMs: T0 });
    expect(plan).toMatchObject({ before: null, command: null, after: stopAt(115) });
  });

  it("keeps the fraction of a second ArenaCue already had when both are stopped", () => {
    // Console toont 8:05, ArenaCue staat stil op 8:04,6: dat is ook 8:05 op het scherm.
    const plan = planGameClockSync({ state: stoppedAt(115.4), match: BASKET, official: official({ shown: 485 }), nowMs: T0 });
    expect(gameSyncHasWork(plan)).toBe(false);
  });

  it("starts through the real command, after aligning the value", () => {
    const plan = planGameClockSync({
      state: stoppedAt(0),
      match: BASKET,
      official: official({ shown: 480, running: true }),
      nowMs: T0,
    });
    expect(plan.before).toEqual(stopAt(120));
    expect(plan.command).toBe("timer:start");
  });

  it("pauses through the real command and takes back what it ran on unnoticed", () => {
    // ArenaCue staat op 120,4 s verstreken; de console stond al stil toen het bericht vertrok, dus
    // hooguit één berichtinterval (0,2 s) daarvan was te veel.
    const state = runningFrom(120, T0 - 400);
    const plan = planGameClockSync({ state, match: BASKET, official: official({ shown: 480 }), nowMs: T0 });
    expect(plan).toMatchObject({ before: null, command: "timer:pause" });
    expect(plan.after?.timerRunning).toBe(false);
    expect(plan.after?.timerBaseSec).toBeCloseTo(120.2, 3);
  });

  it("pauses and steps back when ArenaCue ran past what the console shows", () => {
    // Console staat stil op 8:00; ArenaCue liep door tot 7:58,8.
    const state = runningFrom(120, T0 - 1200);
    const plan = planGameClockSync({ state, match: BASKET, official: official({ shown: 480 }), nowMs: T0 });
    expect(plan.command).toBe("timer:pause");
    expect(plan.after).toEqual(stopAt(120.95));
  });

  it("corrects at once when ArenaCue still shows a second the console already left", () => {
    const state = runningFrom(119.5, T0);
    const estimate = official({ shown: 480, running: true, value: 479.9 });
    const plan = planGameClockSync({ state, match: BASKET, official: estimate, nowMs: T0 });
    expect(plan.command).toBeNull();
    expect(plan.after?.timerRunning).toBe(true);
    expect(plan.after?.timerBaseSec).toBeCloseTo(120.1, 3);
  });

  it("tolerates running slightly ahead, but not by much", () => {
    const estimate = official({ shown: 480, running: true, value: 479.2 });
    const slightly = planGameClockSync({ state: runningFrom(121.2, T0), match: BASKET, official: estimate, nowMs: T0 });
    expect(gameSyncHasWork(slightly)).toBe(false);
    const far = planGameClockSync({ state: runningFrom(123, T0), match: BASKET, official: estimate, nowMs: T0 });
    expect(far.after?.timerBaseSec).toBeCloseTo(120.8, 3);
  });

  it("keeps counting through a gap in the feed instead of holding the clock back", () => {
    // Laatste bericht 0,9 s geleden: de console toonde toen 8:00 en liep. ArenaCue staat intussen op 7:58,6.
    const stale = official({ shown: 480, running: true, value: 479.001, ageSec: 0.9 });
    const plan = planGameClockSync({ state: runningFrom(121.4, T0), match: BASKET, official: stale, nowMs: T0 });
    expect(gameSyncHasWork(plan)).toBe(false);
    const shot = planShotClockSync({
      state: shotState({ shotClockRunning: true, shotClockStartedAt: new Date(T0), shotClockBaseSec: 12.4 }),
      sport: "BASKETBALL",
      official: official({ shown: 14, running: true, value: 13.001, ageSec: 0.9 }),
      nowMs: T0,
    });
    expect(shot).toBeNull();
  });

  it("follows the console into the next period before the operator switched period", () => {
    // ArenaCue staat nog op 00:00 van de vorige periode; de jurytafel zet 10:00 klaar en start.
    const ready = planGameClockSync({ state: stoppedAt(600), match: BASKET, official: official({ shown: 600 }), nowMs: T0 });
    expect(ready).toMatchObject({ hold: null, command: null, after: stopAt(0) });
    const started = planGameClockSync({
      state: stoppedAt(600),
      match: BASKET,
      official: official({ shown: 598, running: true, value: 597.6 }),
      nowMs: T0,
    });
    expect(started.command).toBe("timer:start");
    expect(started.before?.timerBaseSec).toBeCloseTo(2.4, 3);
  });

  it("does not restart a period ArenaCue just closed for the console's last tenths", () => {
    const lastTenths = official({ shown: 0.2, resolution: 0.1, running: true, value: 0.15 });
    const plan = planGameClockSync({ state: stoppedAt(600), match: BASKET, official: lastTenths, nowMs: T0 });
    expect(gameSyncHasWork(plan)).toBe(false);
    // Staat de console daarna op nul, dan is er ook niets meer te doen.
    const zero = planGameClockSync({ state: stoppedAt(600), match: BASKET, official: official({ shown: 0, resolution: 0.1 }), nowMs: T0 });
    expect(gameSyncHasWork(zero)).toBe(false);
  });

  it("does not take a break countdown for game time", () => {
    const plan = planGameClockSync({ state: stoppedAt(300), match: BASKET, official: official({ shown: 870 }), nowMs: T0 });
    expect(plan.hold).toBe("longer_than_period");
    expect(gameSyncHasWork(plan)).toBe(false);
  });

  it("lets ArenaCue close the period itself when the console reaches zero", () => {
    const zero = official({ shown: 0, resolution: 0.1 });
    // ArenaCue is er bijna: niets doen, de periode loopt vanzelf af.
    const nearly = planGameClockSync({ state: runningFrom(599.9, T0), match: BASKET, official: zero, nowMs: T0 });
    expect(gameSyncHasWork(nearly)).toBe(false);
    // ArenaCue heeft nog twee seconden: nu laten aflopen in plaats van pauzeren.
    const late = planGameClockSync({ state: runningFrom(598, T0), match: BASKET, official: zero, nowMs: T0 });
    expect(late.command).toBeNull();
    expect(late.after).toMatchObject({ timerRunning: true, timerBaseSec: 599.98 });
  });

  it("has nothing to follow without a match or for a sport without a clock", () => {
    const o = official({ shown: 100, running: true });
    expect(planGameClockSync({ state: stoppedAt(0), match: null, official: o, nowMs: T0 }).hold).toBe("no_match_clock");
    const volley: SyncMatch = { sport: "VOLLEYBALL", currentPeriod: 1, periodDurationSec: 0 };
    expect(planGameClockSync({ state: stoppedAt(0), match: volley, official: o, nowMs: T0 }).hold).toBe("no_match_clock");
  });

  it("follows a clock that counts up", () => {
    const up = official({ shown: 754, direction: "up" });
    const plan = planGameClockSync({ state: stoppedAt(0), match: FOOTBALL, official: up, nowMs: T0 });
    expect(plan.after).toEqual(stopAt(754));
    const running = planGameClockSync({
      state: runningFrom(754.4, T0),
      match: FOOTBALL,
      official: { ...up, running: true, value: 754.4 },
      nowMs: T0,
    });
    expect(gameSyncHasWork(running)).toBe(false);
  });

  it("converts a console that counts down for a sport ArenaCue counts up", () => {
    const plan = planGameClockSync({ state: stoppedAt(0), match: FOOTBALL, official: official({ shown: 2400 }), nowMs: T0 });
    expect(plan.after).toEqual(stopAt(300));
  });
});

const shotState = (partial: Partial<ShotSyncState>): ShotSyncState => ({
  ...pauseShotClockAt(24),
  shotClockOff: false,
  shotClockDisabled: false,
  ...partial,
});

describe("planShotClockSync", () => {
  it("stays away when the operator switched the shot clock off or the sport has none", () => {
    const o = official({ shown: 14, running: true });
    expect(planShotClockSync({ state: shotState({ shotClockDisabled: true }), sport: "BASKETBALL", official: o, nowMs: T0 })).toBeNull();
    expect(planShotClockSync({ state: shotState({}), sport: "FOOTBALL", official: o, nowMs: T0 })).toBeNull();
    expect(planShotClockSync({ state: shotState({}), sport: null, official: o, nowMs: T0 })).toBeNull();
  });

  it("blanks and restores the shot clock with the console", () => {
    const blank = planShotClockSync({ state: shotState({}), sport: "BASKETBALL", official: "off", nowMs: T0 });
    expect(blank).toMatchObject({ shotClockOff: true, shotClockRunning: false });
    expect(planShotClockSync({ state: shotState({ shotClockOff: true }), sport: "BASKETBALL", official: "off", nowMs: T0 })).toBeNull();
    const back = planShotClockSync({
      state: shotState({ shotClockOff: true, shotClockBaseSec: 0 }),
      sport: "BASKETBALL",
      official: official({ shown: 24 }),
      nowMs: T0,
    });
    expect(back).toMatchObject({ shotClockOff: false, shotClockRunning: false, shotClockBaseSec: 24 });
  });

  it("follows a reset and a start", () => {
    const reset = planShotClockSync({ state: shotState({ shotClockBaseSec: 9.4 }), sport: "BASKETBALL", official: official({ shown: 14 }), nowMs: T0 });
    expect(reset).toMatchObject({ shotClockRunning: false, shotClockBaseSec: 14 });
    const start = planShotClockSync({
      state: shotState({ shotClockBaseSec: 14 }),
      sport: "BASKETBALL",
      official: official({ shown: 14, running: true }),
      nowMs: T0,
    });
    expect(start).toMatchObject({ shotClockRunning: true, shotClockBaseSec: 14 });
    expect(start?.shotClockStartedAt?.getTime()).toBe(T0);
  });

  it("stops inside what the console shows", () => {
    const running = shotState({ shotClockRunning: true, shotClockStartedAt: new Date(T0 - 600), shotClockBaseSec: 14 });
    const kept = planShotClockSync({ state: running, sport: "BASKETBALL", official: official({ shown: 14 }), nowMs: T0 });
    // 13,4 op de klok van ArenaCue, waarvan hooguit 0,2 s na de stop is weggetikt.
    expect(kept).toMatchObject({ shotClockRunning: false, shotClockBaseSec: 13.6 });
    // Doorgelopen tot 12,8 terwijl de console op 14 staat: terug naar net boven 13.
    const overran = planShotClockSync({
      state: { ...running, shotClockStartedAt: new Date(T0 - 1200) },
      sport: "BASKETBALL",
      official: official({ shown: 14 }),
      nowMs: T0,
    });
    expect(overran).toMatchObject({ shotClockRunning: false, shotClockBaseSec: 13.05 });
  });

  it("does nothing while ArenaCue shows the same number", () => {
    const running = shotState({ shotClockRunning: true, shotClockStartedAt: new Date(T0 - 300), shotClockBaseSec: 14 });
    const o = official({ shown: 14, running: true, value: 13.7 });
    expect(planShotClockSync({ state: running, sport: "BASKETBALL", official: o, nowMs: T0 })).toBeNull();
    expect(planShotClockSync({ state: shotState({ shotClockBaseSec: 13.4 }), sport: "BASKETBALL", official: official({ shown: 14 }), nowMs: T0 })).toBeNull();
  });

  it("stops at zero when the console shows zero", () => {
    const running = shotState({ shotClockRunning: true, shotClockStartedAt: new Date(T0), shotClockBaseSec: 0.6 });
    const zero = planShotClockSync({ state: running, sport: "BASKETBALL", official: official({ shown: 0 }), nowMs: T0 });
    expect(zero).toMatchObject({ shotClockRunning: false, shotClockBaseSec: 0, shotClockOff: false });
    expect(planShotClockSync({ state: shotState({ shotClockBaseSec: 0 }), sport: "BASKETBALL", official: official({ shown: 0 }), nowMs: T0 })).toBeNull();
  });
});

/**
 * Speelt een stuk wedstrijd na: een "echte" klok aan de jurytafel, een console die hem een paar keer
 * per seconde doorstuurt met wat vertraging, en ArenaCue dat volgt. Elke 10 ms meten we hoeveel het
 * stadionscherm voor- of achterloopt op het officiële bord.
 */
function simulate(opts: {
  totalMs: number;
  /** Tijdstippen (ms) waarop de jurytafel de klok start of stopt, te beginnen met een start. */
  toggles: number[];
  startRemaining: number;
  withRunningFlag: boolean;
  frameEveryMs: number;
}) {
  const duration = 120;
  const match: SyncMatch = { sport: "BASKETBALL", currentPeriod: 1, periodDurationSec: duration };
  const tracker = new ClockTracker();
  let local: GameSyncState = stoppedAt(duration - opts.startRemaining);

  let remaining = opts.startRemaining;
  let running = false;
  let stoppedSinceMs = 0;
  let toggleIndex = 0;
  let seed = 42;
  const jitter = () => 15 + ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 45);
  const shownOnBoard = (value: number) => (value < 60 ? Math.ceil(value * 10 - 1e-9) / 10 : Math.ceil(value - 1e-9));
  const pending: Array<{ at: number; seconds: number; resolution: number; running: boolean }> = [];

  /** Scherm toont minder tijd dan het bord: het loopt voor. */
  let maxAheadSec = 0;
  /** Scherm toont meer tijd dan het bord: het loopt achter. */
  let maxBehindSec = 0;
  /** Tijd waarin het bord al een halve seconde stilstaat en het scherm toch iets anders toont. */
  let settledMismatchMs = 0;
  let writes = 0;
  let commands = 0;

  for (let t = 0; t <= opts.totalMs; t += 10) {
    const now = T0 + t;
    if (toggleIndex < opts.toggles.length && t >= opts.toggles[toggleIndex]) {
      running = !running;
      toggleIndex += 1;
      if (!running) stoppedSinceMs = t;
    }
    if (running) remaining = Math.max(0, Math.round((remaining - 0.01) * 1000) / 1000);
    if (running && remaining <= 0) {
      running = false;
      stoppedSinceMs = t;
    }

    if (t % opts.frameEveryMs === 0) {
      pending.push({ at: now + jitter(), seconds: shownOnBoard(remaining), resolution: remaining < 60 ? 0.1 : 1, running });
    }
    while (pending.length > 0 && pending[0].at <= now) {
      const frame = pending.shift()!;
      tracker.update(
        { seconds: frame.seconds, resolution: frame.resolution, running: opts.withRunningFlag ? frame.running : undefined },
        now,
        "down",
      );
    }

    // De tick-loop van de app: aftellende klok stopt op nul.
    if (local.timerRunning && computeElapsedSeconds(local, now) >= duration) local = { ...local, ...stopAt(duration) };

    const estimate = tracker.estimate(now);
    if (estimate && t % 50 === 0) {
      const plan = planGameClockSync({ state: local, match, official: estimate, nowMs: now });
      if (gameSyncHasWork(plan)) {
        writes += 1;
        if (plan.command) commands += 1;
        local = applyGame(local, plan, now);
      }
    }

    if (t < 600) continue;
    const screenRemaining = duration - computeElapsedSeconds(local, now);
    maxAheadSec = Math.max(maxAheadSec, remaining - screenRemaining);
    maxBehindSec = Math.max(maxBehindSec, screenRemaining - remaining);
    const settled = !running && t - stoppedSinceMs >= 500;
    if (settled && formatSportClock("BASKETBALL", remaining) !== formatSportClock("BASKETBALL", screenRemaining)) {
      settledMismatchMs += 10;
    }
  }
  return {
    maxAheadSec,
    maxBehindSec,
    settledMismatchMs,
    writes,
    commands,
    finalElapsed: computeElapsedSeconds(local, T0 + opts.totalMs),
  };
}

describe("following a console through a stretch of play", () => {
  it("stays within one feed interval of the board when the console reports start and stop", () => {
    // 1:20 op de klok: eerst hele seconden, dan tienden. Start, twee keer fluiten, tot het einde.
    // De console stuurt om de 0,2 s en elk bericht is 15 tot 60 ms onderweg.
    const result = simulate({
      totalMs: 95_000,
      toggles: [1000, 13_370, 16_000, 41_250, 44_000],
      startRemaining: 80,
      withRunningFlag: true,
      frameEveryMs: 200,
    });
    // Achterlopen: hooguit één berichtinterval plus de reistijd en onze eigen controle om de 50 ms.
    expect(result.maxBehindSec).toBeLessThanOrEqual(0.35);
    // Voorlopen kan alleen in het ogenblik tussen een fluitsignaal en het bericht dat het meldt.
    expect(result.maxAheadSec).toBeLessThanOrEqual(0.35);
    // Staat het bord stil, dan toont het scherm exact hetzelfde.
    expect(result.settledMismatchMs).toBe(0);
    expect(result.commands).toBe(5);
    expect(result.finalElapsed).toBe(120);
    // Bijsturen is een uitzondering, geen doorlopende stroom schrijfacties.
    expect(result.writes).toBeLessThan(40);
  });

  it("is tighter with a console that sends ten times a second", () => {
    const result = simulate({
      totalMs: 30_000,
      toggles: [1000, 7430, 9000, 21_990, 23_000],
      startRemaining: 110,
      withRunningFlag: true,
      frameEveryMs: 100,
    });
    expect(result.maxBehindSec).toBeLessThanOrEqual(0.25);
    expect(result.maxAheadSec).toBeLessThanOrEqual(0.25);
    expect(result.settledMismatchMs).toBe(0);
    expect(result.commands).toBe(5);
  });

  it("also follows a console that does not say whether the clock runs", () => {
    const result = simulate({
      totalMs: 18_000,
      toggles: [1000, 7430, 9000],
      startRemaining: 110,
      withRunningFlag: false,
      frameEveryMs: 100,
    });
    // Zonder vlag merken we een stop pas als de volgende tik uitblijft: het scherm kan dan ruim een
    // seconde doorlopen voor het terugspringt. Daarna staat het weer gelijk met het bord.
    expect(result.maxAheadSec).toBeLessThanOrEqual(1.5);
    expect(result.settledMismatchMs).toBeLessThanOrEqual(1000);
    // Starten merken we pas bij de eerste tik: tot een seconde achter, daarna gelijk.
    expect(result.maxBehindSec).toBeLessThanOrEqual(1.2);
  });
});

describe("following a shot clock without a running flag", () => {
  it("never shows a number the board does not show, apart from the feed delay", () => {
    const tracker = new ClockTracker();
    let local: ShotSyncState = shotState({});
    let remaining = 24;
    let running = false;
    let gameRunning = false;
    const pending: Array<{ at: number; seconds: number }> = [];
    let mismatchMs = 0;
    let longest = 0;
    let current = 0;

    for (let t = 0; t <= 30_000; t += 10) {
      const now = T0 + t;
      // Spelverloop: start, na 9,4 s fluit (alles stil), hervat, reset naar 14 die pas na 1,3 s gaat lopen.
      if (t === 1000) running = gameRunning = true;
      if (t === 10_400) running = gameRunning = false;
      if (t === 13_000) running = gameRunning = true;
      if (t === 17_000) {
        remaining = 14;
        running = false;
      }
      if (t === 18_300) running = true;
      if (running) remaining = Math.max(0, Math.round((remaining - 0.01) * 1000) / 1000);

      if (t % 100 === 0) pending.push({ at: now + 30, seconds: Math.ceil(remaining - 1e-9) });
      while (pending.length > 0 && pending[0].at <= now) {
        tracker.update({ seconds: pending.shift()!.seconds, resolution: 1 }, now, "down");
      }
      if (local.shotClockRunning && computeShotClockSeconds(local, now) <= 0) {
        local = { ...local, ...pauseShotClockAt(0) };
      }
      const estimate = tracker.estimate(now, { heldStopped: !gameRunning });
      if (estimate && t % 50 === 0) {
        const patch = planShotClockSync({ state: local, sport: "BASKETBALL", official: estimate, nowMs: now });
        if (patch) local = { ...local, ...patch };
      }

      const board = Math.ceil(remaining - 1e-9);
      const screen = Math.ceil(computeShotClockSeconds(local, now) - 1e-9);
      if (t > 300 && board !== screen) {
        mismatchMs += 10;
        current += 10;
        longest = Math.max(longest, current);
      } else {
        current = 0;
      }
    }
    // Het scherm loopt hooguit de vertraging van één bericht achter; nooit een tel te vroeg of te laat.
    expect(longest).toBeLessThanOrEqual(200);
    expect(mismatchMs).toBeLessThan(30_000 * 0.08);
  });
});
