import { describe, expect, it } from "vitest";
import {
  cueEndSec,
  cueIsDueAtElapsed,
  cuePhaseMatches,
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
