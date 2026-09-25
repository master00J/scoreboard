import test from "node:test";
import assert from "node:assert/strict";
import { applyCommandToMatch, basketballLateTimeoutBlocked, basketballLateTimeoutCounts, clockAdjustDelta, clockSetSeconds, cloudMatchesFromState, computeBreakSeconds, computeElapsedSeconds, computePenaltySeconds, computeShotClockSeconds, computeTimeoutSeconds, describePeriod, extractMatchId, formatClock, formatCountdown, formatShotClock, formatSportClock, hasStoredCredentials, liveElapsedSeconds, maxPeriodForMatch, mergeLiveMatch, nextOvertimePeriod, normalizeSnapshot, parseClockInput, periodDurationSecFor, periodStartElapsedSec, readCloudState, regularPeriodCount, splitFieldAndBench, sportClockSeconds, sportProfile, timeoutDurationSecForMatch, timeoutLimitForMatch } from "../lib/match-state.js";

test("repeated cloud telemetry samples keep their timer and freshness anchors", () => {
  const raw = { matchId: "match-a", timerElapsedAtMs: 9_000_000, timerElapsedSec: 60, timerRunning: true, shotClockRemainingSec: 24, shotClockRunning: true };
  const first = normalizeSnapshot(raw, null, 1_000);
  const repeated = normalizeSnapshot({ ...raw }, first, 3_500);
  assert.equal(repeated._receivedAtMs, 1_000);
  assert.equal(repeated._sampleReceivedAtMs, 1_000);
  assert.equal(computeElapsedSeconds(repeated, 4_000), 63);
  assert.equal(computeShotClockSeconds(repeated, 4_000), 21);
  assert.equal(raw._receivedAtMs, undefined);
});

test("new samples and different matches establish new anchors", () => {
  const first = normalizeSnapshot({ matchId: "a", timerElapsedAtMs: 500, timerElapsedSec: 30, timerRunning: true }, null, 1_000);
  const next = normalizeSnapshot({ matchId: "a", timerElapsedAtMs: 2_000, timerElapsedSec: 31.5, timerRunning: true }, first, 2_500);
  assert.equal(next._sampleReceivedAtMs, 2_500);
  assert.equal(computeElapsedSeconds(next, 3_000), 32);
  const differentMatch = normalizeSnapshot({ matchId: "b", timerElapsedAtMs: 2_000 }, next, 3_000);
  assert.equal(differentMatch._receivedAtMs, 3_000);
});

test("paused clocks stay stable and backwards local clock drift cannot invert time", () => {
  const paused = normalizeSnapshot({ timerElapsedSec: 20.9, timerRunning: false, shotClockRemainingSec: 14, shotClockRunning: false }, null, 1_000);
  assert.equal(computeElapsedSeconds(paused, 999_000), 20);
  assert.equal(computeShotClockSeconds(paused, 999_000), 14);
  const running = { ...paused, timerRunning: true, shotClockRunning: true };
  assert.equal(computeElapsedSeconds(running, -20_000), 20);
  assert.equal(computeShotClockSeconds(running, -20_000), 14);
  assert.equal(computeShotClockSeconds(running, 100_000), 0);
});

test("legacy state uses server timestamps without assuming phone clock synchronization", () => {
  const state = normalizeSnapshot({ timerRunning: true, timerBaseSec: 10, timerStartedAt: "2026-09-05T10:00:00Z", updatedAt: "2026-09-05T10:00:12Z", shotClockRunning: true, shotClockBaseSec: 24, shotClockStartedAt: "2026-09-05T10:00:00Z" }, null, 100);
  assert.equal(state.timerElapsedSec, 22);
  assert.equal(state.shotClockRemainingSec, 12);
  assert.equal(computeElapsedSeconds(state, 2_100), 24);
  assert.equal(computeShotClockSeconds(state, 2_100), 10);
});

test("invalid fields and malformed snapshots never create NaN clocks", () => {
  for (const value of [null, undefined, [], "broken", 123]) assert.equal(normalizeSnapshot(value), null);
  const state = normalizeSnapshot({ timerElapsedSec: NaN, timerBaseSec: Infinity, timerStartedAt: "bad", timerRunning: true, shotClockRemainingSec: -5, shotClockBaseSec: NaN, shotClockRunning: true }, null, 1_000);
  assert.equal(computeElapsedSeconds(state, 1_000), 0);
  assert.equal(computeShotClockSeconds(state, 1_000), 0);
  assert.equal(formatClock(Infinity), "00:00");
  assert.equal(formatClock(-10), "00:00");
  assert.equal(formatClock(3_661.9), "61:01");
});

test("readCloudState understands wrappers and empty or failed cloud responses", () => {
  const state = { matchId: "active" };
  assert.equal(readCloudState({ ok: true, state }), state);
  assert.equal(readCloudState({ displayState: state }), state);
  assert.equal(readCloudState(state), state);
  for (const payload of [{ ok: true, state: null }, { state: [] }, { ok: false, state }, null]) assert.equal(readCloudState(payload), null);
});

test("match extraction rejects invalid IDs and cloud summaries prefer active details", () => {
  assert.equal(extractMatchId({ matchId: "", activeMatch: { id: "active" } }), "active");
  assert.equal(extractMatchId({ matchId: 1, match: { id: "fallback" } }), "fallback");
  const matches = cloudMatchesFromState({ matches: [{ id: "one", homeScore: 1 }, null, { id: "two", homeScore: Infinity }], activeMatch: { id: "one", homeScore: 3, sport: "BASKETBALL", currentPeriod: 2 } });
  assert.equal(matches.length, 2);
  assert.equal(matches[0].homeScore, 3);
  assert.equal(matches[0].sport, "BASKETBALL");
  assert.equal(matches[1].homeScore, 0);
  assert.equal(cloudMatchesFromState({ matchId: "legacy", homeScore: 2 })[0].homeScore, 2);
});

test("live match merge keeps roster while taking desktop score and phase", () => {
  const merged = mergeLiveMatch(
    { id: "m1", homeScore: 0, awayScore: 1, status: "FIRST_HALF", homeTeam: { id: "h", players: [{ id: "p1" }] }, awayTeam: { id: "a" } },
    { id: "m1", homeScore: 2, awayScore: 1, status: "SECOND_HALF", currentPeriod: 2, homeTeam: { id: "h", players: [{ id: "p1" }, { id: "p2" }] } },
  );
  assert.equal(merged.homeScore, 2);
  assert.equal(merged.status, "SECOND_HALF");
  assert.equal(merged.currentPeriod, 2);
  assert.equal(merged.homeTeam.players.length, 2);
  assert.equal(mergeLiveMatch({ id: "old" }, { id: "new", homeScore: 3 }).id, "new");
  const kept = mergeLiveMatch(
    { id: "m1", homeTeam: { id: "h", players: [{ id: "p1" }] }, homeFieldPlayerIds: ["p1"] },
    { id: "m1", homeTeam: { id: "h", name: "Genk" }, homeScore: 1 },
  );
  assert.equal(kept.homeTeam.players.length, 1);
  assert.deepEqual(kept.homeFieldPlayerIds, ["p1"]);
});

test("substitutions split stored field ids from the bench", () => {
  const team = { players: [
    { id: "a", number: 1 }, { id: "b", number: 2 }, { id: "c", number: 3, isCoach: true }, { id: "d", number: 9 },
  ] };
  const split = splitFieldAndBench(team, ["b", "d"], 11);
  assert.deepEqual(split.onField.map((player) => player.id), ["b", "d"]);
  assert.deepEqual(split.bench.map((player) => player.id), ["a"]);
  const fallback = splitFieldAndBench(team, [], 2);
  assert.deepEqual(fallback.onField.map((player) => player.id), ["a", "b"]);
  assert.deepEqual(fallback.bench.map((player) => player.id), ["d"]);
});

test("optimistic commands update score, phase and sport stats without going negative", () => {
  const match = { id: "m1", homeScore: 1, awayScore: 0, status: "FIRST_HALF", currentPeriod: 1, homeFouls: 2, awayTimeouts: 1 };
  assert.equal(applyCommandToMatch(match, { type: "goal:trigger", side: "home" }).homeScore, 2);
  assert.equal(applyCommandToMatch(match, { type: "score:adjust", side: "away", delta: -3 }).awayScore, 0);
  assert.equal(applyCommandToMatch(match, { type: "match:setStatus", status: "HALF_TIME" }).status, "HALF_TIME");
  assert.equal(applyCommandToMatch(match, { type: "sport:setPeriod", period: 2 }).currentPeriod, 2);
  assert.equal(applyCommandToMatch(match, { type: "sport:statAdjust", side: "home", stat: "foul", delta: 1 }).homeFouls, 3);
  assert.equal(applyCommandToMatch(match, { type: "timer:start" }).homeScore, 1);
});

test("stored credentials require a pairing secret for operators but not viewers", () => {
  assert.equal(hasStoredCredentials({ baseUrl: "http://192.168.1.10:17890", connectionMode: "local", pairingCode: "123456", operatorPin: "654321", role: "operator" }), true);
  assert.equal(hasStoredCredentials({ baseUrl: "http://192.168.1.10:17890", connectionMode: "local", pairingCode: "123456", operatorPin: "", role: "operator" }), false);
  assert.equal(hasStoredCredentials({ baseUrl: "http://192.168.1.10:17890", connectionMode: "local", pairingCode: "123456", role: "viewer" }), true);
  assert.equal(hasStoredCredentials({ baseUrl: "https://arenacue.be", connectionMode: "cloud", venueId: "genk-a" }), true);
  assert.equal(hasStoredCredentials({ baseUrl: "", connectionMode: "local", pairingCode: "123456" }), false);
});

test("all sport profiles match desktop clock durations and available actions", () => {
  const expected = { FOOTBALL: [2700, "up", 2], FUTSAL: [1200, "down", 2], BASKETBALL: [600, "down", 4], VOLLEYBALL: [0, "none", 5], HOCKEY: [900, "down", 4] };
  for (const [sport, values] of Object.entries(expected)) {
    const profile = sportProfile(sport);
    assert.deepEqual([profile.defaultPeriodDurationSec, profile.timer, profile.periods], values);
  }
  assert.equal(sportProfile("unknown").id, "FOOTBALL");
  assert.equal(sportProfile(" basketball ").timeoutLimitForPeriod(2), 2);
  assert.equal(sportProfile("BASKETBALL").timeoutLimitForPeriod(3), 3);
  assert.deepEqual(sportProfile("BASKETBALL").shot, [24, 14]);
  assert.deepEqual(sportProfile("BASKETBALL").increments, [1, 2, 3]);
  assert.equal(sportProfile("VOLLEYBALL").hasSets, true);
});

const basketball = sportProfile("BASKETBALL");

test("basketball clock counts down with tenths in the last minute, like the stadium display", () => {
  assert.equal(formatSportClock(basketball, 600), "10:00");
  assert.equal(formatSportClock(basketball, 61.2), "01:02");
  assert.equal(formatSportClock(basketball, 60), "01:00");
  assert.equal(formatSportClock(basketball, 59.9), "59.9");
  assert.equal(formatSportClock(basketball, 7.04), "7.1");
  assert.equal(formatSportClock(basketball, 0), "0.0");
  assert.equal(formatSportClock(sportProfile("FOOTBALL"), 61.9), "01:01");
  assert.equal(formatSportClock(sportProfile("HOCKEY"), 59.2), "01:00");
  const running = normalizeSnapshot({ timerElapsedSec: 540.25, timerRunning: true }, null, 1_000);
  assert.equal(liveElapsedSeconds(running, 1_500), 540.75);
  assert.equal(computeElapsedSeconds(running, 1_500), 540);
  assert.equal(formatSportClock(basketball, sportClockSeconds(basketball, liveElapsedSeconds(running, 1_500), 600, 3)), "59.3");
});

test("overtime periods use the 5-minute overtime length instead of the quarter length", () => {
  assert.equal(periodDurationSecFor(basketball, 4, 480), 480);
  assert.equal(periodDurationSecFor(basketball, 5, 480), 300);
  assert.equal(periodDurationSecFor(basketball, 2, null), 600);
  assert.equal(sportClockSeconds(basketball, 100, 600, 5), 200);
  assert.equal(sportClockSeconds(basketball, 700, 600, 1), 0);
  assert.equal(sportClockSeconds(sportProfile("FOOTBALL"), 2710, 2700, 2), 2710);
  assert.equal(nextOvertimePeriod(basketball, 4), 5);
  assert.equal(nextOvertimePeriod(basketball, 6), 7);
  assert.equal(nextOvertimePeriod(basketball, 9), 9);
  assert.equal(maxPeriodForMatch(basketball, {}), 9);
  assert.equal(maxPeriodForMatch(sportProfile("HOCKEY"), {}), 4);
  assert.equal(maxPeriodForMatch(sportProfile("VOLLEYBALL"), { setsToWin: 2 }), 3);
  assert.equal(regularPeriodCount(sportProfile("VOLLEYBALL"), { setsToWin: 3 }), 5);
  assert.deepEqual(describePeriod(basketball, 2), { kind: "quarter", index: 2 });
  assert.deepEqual(describePeriod(basketball, 6), { kind: "overtime", index: 2, numbered: true });
  assert.deepEqual(describePeriod(sportProfile("FUTSAL"), 2), { kind: "half", index: 2 });
  assert.deepEqual(describePeriod(sportProfile("VOLLEYBALL"), 5), { kind: "set", index: 5 });
});

test("shot clock shows tenths below five seconds and rounds up above", () => {
  assert.equal(formatShotClock(24), "24");
  assert.equal(formatShotClock(13.2), "14");
  assert.equal(formatShotClock(5), "5");
  assert.equal(formatShotClock(4.95), "5.0");
  assert.equal(formatShotClock(3.21), "3.3");
  assert.equal(formatShotClock(0), "0.0");
  assert.equal(formatShotClock(-1), "0.0");
});

test("time-out, break and penalty clocks follow desktop telemetry and derive the break from its start time", () => {
  const raw = {
    timerElapsedAtMs: Date.parse("2026-09-24T10:00:30Z"),
    timeoutRunning: true, timeoutRemainingSec: 42.5, timeoutBaseSec: 60,
    breakRunning: true, breakBaseSec: 120, breakStartedAt: "2026-09-24T10:00:00Z",
    homePenaltyRunning: false, homePenaltyBaseSec: 95,
  };
  const state = normalizeSnapshot(raw, null, 5_000);
  assert.equal(state.breakRemainingSec, 90);
  assert.equal(computeBreakSeconds(state, 15_000), 80);
  assert.equal(computeTimeoutSeconds(state, 7_000), 40.5);
  assert.equal(computePenaltySeconds(state, "home", 60_000), 95);
  assert.equal(computePenaltySeconds(state, "away", 60_000), 0);
  const ended = normalizeSnapshot({ breakRunning: false, breakBaseSec: 0, timeoutRunning: false, timeoutBaseSec: 0 }, null, 1_000);
  assert.equal(computeBreakSeconds(ended, 9_000), 0);
  assert.equal(computeTimeoutSeconds(ended, 9_000), 0);
  assert.equal(formatCountdown(89.2), "1:30");
  assert.equal(formatCountdown(0), "0:00");
});

test("FIBA time-out budgets per half and overtime plus the last-two-minutes rule", () => {
  assert.equal(timeoutLimitForMatch(basketball, { currentPeriod: 1 }), 2);
  assert.equal(timeoutLimitForMatch(basketball, { currentPeriod: 4 }), 3);
  assert.equal(timeoutLimitForMatch(basketball, { currentPeriod: 5 }), 1);
  assert.equal(timeoutLimitForMatch(sportProfile("FUTSAL"), { currentPeriod: 3 }), 0);
  assert.equal(timeoutLimitForMatch(sportProfile("VOLLEYBALL"), { currentPeriod: 1, timeoutsPerSet: 1 }), 1);
  assert.equal(timeoutLimitForMatch(sportProfile("VOLLEYBALL"), { currentPeriod: 1, timeoutsPerSet: null }), 2);
  assert.equal(timeoutDurationSecForMatch(basketball, {}), 60);
  assert.equal(timeoutDurationSecForMatch(sportProfile("VOLLEYBALL"), { timeoutDurationSec: 45 }), 45);
  assert.equal(basketballLateTimeoutCounts(basketball, 4, 120), true);
  assert.equal(basketballLateTimeoutCounts(basketball, 4, 121), false);
  assert.equal(basketballLateTimeoutCounts(basketball, 3, 30), false);
  assert.equal(basketballLateTimeoutBlocked(basketball, 4, 90, 2), true);
  assert.equal(basketballLateTimeoutBlocked(basketball, 4, 90, 1), false);
  assert.equal(basketballLateTimeoutBlocked(sportProfile("FUTSAL"), 2, 30, 5), false);
});

test("clock corrections work on the displayed clock for count-down and count-up sports", () => {
  assert.equal(clockAdjustDelta(basketball, 1), -1);
  assert.equal(clockAdjustDelta(basketball, -60), 60);
  assert.equal(clockAdjustDelta(sportProfile("FOOTBALL"), 60), 60);
  assert.equal(clockSetSeconds(basketball, { currentPeriod: 2, periodDurationSec: 600 }, 125), 475);
  assert.equal(clockSetSeconds(basketball, { currentPeriod: 5, periodDurationSec: 600 }, 125), 175);
  assert.equal(clockSetSeconds(basketball, { currentPeriod: 1, periodDurationSec: 600 }, 900), 0);
  assert.equal(clockSetSeconds(sportProfile("FOOTBALL"), { currentPeriod: 2 }, 2850), 2850);
  assert.equal(periodStartElapsedSec(sportProfile("FOOTBALL"), { periodDurationSec: 2700 }, 2), 2700);
  assert.equal(periodStartElapsedSec(sportProfile("FOOTBALL"), { periodDurationSec: 2700 }, 4), 6300);
  assert.equal(periodStartElapsedSec(basketball, { periodDurationSec: 600 }, 3), 0);
  assert.equal(parseClockInput("7:30"), 450);
  assert.equal(parseClockInput(" 07:05 "), 425);
  assert.equal(parseClockInput("105:00"), 6300);
  assert.equal(parseClockInput("45"), 45);
  for (const value of ["", "7:75", "abc", "1:2:3", "-5"]) assert.equal(parseClockInput(value), null);
});

test("optimistic basketball commands update time-outs, possession and serving", () => {
  const match = { id: "m1", homeTimeouts: 1, awayTimeouts: 0, possessionArrow: null };
  assert.equal(applyCommandToMatch(match, { type: "timeout:start", side: "home" }).homeTimeouts, 2);
  assert.equal(applyCommandToMatch(match, { type: "timeout:start", side: "technical" }), match);
  assert.equal(applyCommandToMatch(match, { type: "timeout:start", side: "away", countAgainstTeam: false }), match);
  assert.equal(applyCommandToMatch(match, { type: "sport:setPossession", side: "away" }).possessionArrow, "away");
  assert.equal(applyCommandToMatch(match, { type: "sport:setServing", side: "home" }).servingSide, "home");
});

test("sport profiles mirror the desktop rules for extras per sport", () => {
  assert.deepEqual([basketball.foulBonusFrom, basketball.statLimit, basketball.tenthsUnderMinute, basketball.possessionArrow], [4, 4, true, true]);
  assert.deepEqual(basketball.cards, []);
  assert.deepEqual(sportProfile("HOCKEY").cards, ["GREEN", "YELLOW", "RED"]);
  assert.deepEqual(sportProfile("HOCKEY").penalty, [120, 300]);
  assert.equal(sportProfile("FUTSAL").timeoutLimitForPeriod(1), 1);
  assert.equal(sportProfile("FOOTBALL").injuryTime, true);
  assert.equal(Object.isFrozen(basketball), true);
});
