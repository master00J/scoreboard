import { describe, expect, it } from "vitest";
import {
  cueEndSec,
  cueIsDueAtElapsed,
  cuePhaseMatches,
  cueUsesLiveWallClock,
  emptyLiveWallCueClock,
  liveWallCueElapsedSec,
  liveWallCueClockFromPersisted,
  liveWallCuePersistPatch,
  nextLiveWallCueClock,
  sponsorPlayWallElapsedSec,
  cueWindowExpired,
  nextRundownWindow,
  computePrematchRundownClock,
  postMatchCueElapsedSec,
  restackRundownWindows,
  rundownCycleIndex,
  rundownCycleSec,
  wrapRundownElapsed,
} from "./scheduled-media-cue";

describe("scheduled media cue window", () => {
  it("negeert eindtijd die niet na start ligt", () => {
    expect(cueEndSec({ triggerSec: 120, endSec: 120 })).toBeNull();
    expect(cueEndSec({ triggerSec: 120, endSec: 90 })).toBeNull();
    expect(cueEndSec({ triggerSec: 120, endSec: null })).toBeNull();
  });

  it("houdt een foto in het venster tot de eindtijd", () => {
    const cue = { triggerSec: 720, endSec: 735 };
    expect(cueIsDueAtElapsed(cue, 719)).toBe(false);
    expect(cueIsDueAtElapsed(cue, 720)).toBe(true);
    expect(cueIsDueAtElapsed(cue, 734)).toBe(true);
    expect(cueIsDueAtElapsed(cue, 735)).toBe(false);
    expect(cueWindowExpired(cue, 735)).toBe(true);
  });

  it("zonder eindtijd alleen het 2-seconden startvenster", () => {
    const cue = { triggerSec: 100, endSec: null };
    expect(cueIsDueAtElapsed(cue, 100)).toBe(true);
    expect(cueIsDueAtElapsed(cue, 102)).toBe(true);
    expect(cueIsDueAtElapsed(cue, 103)).toBe(false);
    expect(cueWindowExpired(cue, 200)).toBe(false);
  });

  it("koppelt post-match cues aan Einde én Na wedstrijd", () => {
    expect(cuePhaseMatches("POST_MATCH", "FULL_TIME")).toBe(true);
    expect(cuePhaseMatches("FULL_TIME", "POST_MATCH")).toBe(true);
    expect(cuePhaseMatches("POST_MATCH", "FIRST_HALF")).toBe(false);
    expect(cuePhaseMatches("FIRST_HALF", "FIRST_HALF")).toBe(true);
  });

  it("pauzeert de volleybal-cueklok in de setbreak en telt daarna door", () => {
    let clock = emptyLiveWallCueClock();
    clock = nextLiveWallCueClock(clock, {
      matchId: "m1",
      status: "FIRST_HALF",
      timerMode: "NONE",
      nowMs: 1_000_000,
    });
    expect(liveWallCueElapsedSec(clock, 1_000_000 + 120_000)).toBe(120);
    clock = nextLiveWallCueClock(clock, {
      matchId: "m1",
      status: "HALF_TIME",
      timerMode: "NONE",
      nowMs: 1_000_000 + 120_000,
    });
    expect(liveWallCueElapsedSec(clock, 1_000_000 + 180_000)).toBe(120);
    clock = nextLiveWallCueClock(clock, {
      matchId: "m1",
      status: "FIRST_HALF",
      timerMode: "NONE",
      nowMs: 1_000_000 + 180_000,
    });
    expect(liveWallCueElapsedSec(clock, 1_000_000 + 210_000)).toBe(150);
    clock = nextLiveWallCueClock(clock, {
      matchId: "m1",
      status: "SECOND_HALF",
      timerMode: "NONE",
      nowMs: 1_000_000 + 210_000,
    });
    expect(liveWallCueElapsedSec(clock, 1_000_000 + 210_000)).toBe(0);
  });

  it("rondt een opgeslagen cue-klok hetzelfde af als de live-teller", () => {
    const origin = new Date(1_700_000_000_000);
    const clock = liveWallCueClockFromPersisted({
      matchId: "m1",
      block: "FIRST_HALF",
      origin,
      frozenSec: 0,
    });
    expect(liveWallCueElapsedSec(clock, origin.getTime() + 45_000)).toBe(45);
    const patch = liveWallCuePersistPatch(clock);
    expect(patch.liveWallCueBlock).toBe("FIRST_HALF");
    expect(patch.liveWallCueOrigin?.getTime()).toBe(origin.getTime());
  });

  it("gebruikt wandklok voor live volleybal-cues", () => {
    expect(cueUsesLiveWallClock("FIRST_HALF", "NONE")).toBe(true);
    expect(cueUsesLiveWallClock("SECOND_HALF", "NONE")).toBe(true);
    expect(cueUsesLiveWallClock("PREMATCH", "NONE")).toBe(false);
    expect(cueUsesLiveWallClock("FIRST_HALF", "COUNT_UP")).toBe(false);
  });

  it("deelt de volleybal-wandklok tussen HUD en LED", () => {
    const origin = new Date(1_000_000);
    expect(
      sponsorPlayWallElapsedSec({
        state: {
          matchId: "m1",
          liveWallCueBlock: "FIRST_HALF",
          liveWallCueOrigin: origin,
          liveWallCueFrozenSec: 0,
        },
        localEpochMs: 0,
        nowMs: origin.getTime() + 45_000,
      }),
    ).toBe(45);
    expect(
      sponsorPlayWallElapsedSec({
        state: null,
        localEpochMs: 1_000,
        nowMs: 4_000,
      }),
    ).toBe(3);
  });

  it("koppelt prematch-cues aan Setup én Voor wedstrijd", () => {
    expect(cuePhaseMatches("PREMATCH", "SETUP")).toBe(true);
    expect(cuePhaseMatches("SETUP", "PREMATCH")).toBe(true);
    expect(cuePhaseMatches("PREMATCH", "FIRST_HALF")).toBe(false);
  });

  it("telt prematch vanaf de geplande aftrap", () => {
    const kickoffAt = "2030-01-01T20:00:00.000Z";
    const ko = new Date(kickoffAt).getTime();
    const match = { kickoffAt, prematchSpreadWindowSec: 0 };
    expect(computePrematchRundownClock(match, 120, null, ko - 180_000).beforeWindow).toBe(true);
    expect(computePrematchRundownClock(match, 120, null, ko - 120_000).elapsedSec).toBe(0);
    expect(computePrematchRundownClock(match, 120, null, ko - 60_000).elapsedSec).toBe(60);
    expect(computePrematchRundownClock(match, 120, null, ko).pastKickoff).toBe(true);
    expect(computePrematchRundownClock({ kickoffAt, prematchSpreadWindowSec: 1800 }, 120, null, ko - 1800_000).elapsedSec).toBe(0);
    expect(computePrematchRundownClock({ kickoffAt: null }, 120, "2030-01-01T19:00:00.000Z", ko - 3300_000).elapsedSec).toBe(300);
  });

  it("telt post-match vanaf het gedeelde startmoment", () => {
    const started = new Date("2026-09-05T00:00:00.000Z");
    expect(postMatchCueElapsedSec(started.toISOString(), started.getTime() + 90_000)).toBe(90);
    expect(postMatchCueElapsedSec(null, Date.now())).toBe(0);
  });

  it("plakt een nieuwe clip achter de rundown", () => {
    expect(
      nextRundownWindow(
        [
          { triggerSec: 0, endSec: 15 },
          { triggerSec: 15, endSec: 40 },
        ],
        12,
      ),
    ).toEqual({ triggerSec: 40, endSec: 52 });
    expect(nextRundownWindow([], 10)).toEqual({ triggerSec: 0, endSec: 10 });
  });

  it("stapelt cues opnieuw na herschikken", () => {
    expect(
      restackRundownWindows([
        { id: "b", triggerSec: 15, endSec: 30, media: { durationSec: 15 } },
        { id: "a", triggerSec: 0, endSec: 15, media: { durationSec: 15 } },
      ]),
    ).toEqual([
      { id: "b", triggerSec: 0, endSec: 15 },
      { id: "a", triggerSec: 15, endSec: 30 },
    ]);
  });

  it("loopt de rundown-speelkop terug naar het begin", () => {
    const cues = [
      { triggerSec: 0, endSec: 30 },
      { triggerSec: 30, endSec: 90 },
    ];
    expect(rundownCycleSec(cues)).toBe(90);
    expect(wrapRundownElapsed(90, 90, true)).toBe(0);
    expect(wrapRundownElapsed(91, 90, true)).toBe(1);
    expect(wrapRundownElapsed(91, 90, false)).toBe(91);
    expect(rundownCycleIndex(89, 90, true)).toBe(0);
    expect(rundownCycleIndex(90, 90, true)).toBe(1);
    expect(cueIsDueAtElapsed(cues[0]!, wrapRundownElapsed(90, 90, true))).toBe(true);
    expect(cueIsDueAtElapsed(cues[1]!, wrapRundownElapsed(90, 90, true))).toBe(false);
  });
});
