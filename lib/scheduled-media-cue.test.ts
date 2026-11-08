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
  rundownPhasesForSport,
  rundownSport,
  wrapRundownElapsed,
  cueLeftClockWindow,
  pickDueScheduledCue,
  scheduledCueFiredKey,
  scheduledCueMediaKey,
  scheduledCueExpectedPlaySec,
} from "./scheduled-media-cue";

describe("rundown per sport", () => {
  it("laat een volleybalclub vooraf plannen zonder lopende wedstrijd", () => {
    expect(rundownSport(null, "VOLLEYBALL")).toBe("VOLLEYBALL");
    expect(rundownSport(undefined, null)).toBe("FOOTBALL");
    expect(rundownSport(null, "CURLING")).toBe("FOOTBALL");
  });

  it("volgt de sport van de lopende wedstrijd", () => {
    expect(rundownSport("volleyball", "FOOTBALL")).toBe("VOLLEYBALL");
    expect(rundownSport("BASKETBALL", "VOLLEYBALL")).toBe("BASKETBALL");
  });

  it("toont verlenging alleen bij sporten die verlenging kennen", () => {
    expect(rundownPhasesForSport("VOLLEYBALL")).toEqual(["PREMATCH", "FIRST_HALF", "SECOND_HALF", "POST_MATCH"]);
    expect(rundownPhasesForSport("FOOTBALL")).toContain("EXTRA_TIME");
    expect(rundownPhasesForSport("BASKETBALL")).toContain("EXTRA_TIME");
  });
});

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

describe("pickDueScheduledCue", () => {
  const cue = (id: string, triggerSec: number, endSec: number | null, extra: Record<string, unknown> = {}) => ({
    id,
    triggerSec,
    endSec,
    enabled: true,
    matchStatus: "FIRST_HALF",
    loop: true,
    media: { active: true },
    ...extra,
  });
  /** Zoals de volleybalclub ze zette: sponsorbeelden die naadloos op elkaar volgen. */
  const rundown = [cue("a", 0, 15), cue("b", 15, 30), cue("c", 30, 45)];
  const base = {
    cues: rundown,
    matchId: "m1",
    matchStatus: "FIRST_HALF",
    cycle: 0,
    timerRunning: false,
    usesLiveWallClock: true,
  };

  it("geeft de volgende cue op precies het moment dat de vorige zijn venster verlaat", () => {
    const fired = new Set([scheduledCueFiredKey("m1", "FIRST_HALF", "a", 0)]);
    expect(cueLeftClockWindow(rundown[0]!, 15)).toBe(true);
    expect(pickDueScheduledCue({ ...base, playhead: 15, fired })).toEqual({
      cue: rundown[1],
      firedKey: "m1:FIRST_HALF:b:0",
    });
  });

  it("sluit na de laatste cue aan op de eerste van de volgende doorloop", () => {
    const fired = new Set(["a", "b", "c"].map((id) => scheduledCueFiredKey("m1", "FIRST_HALF", id, 0)));
    expect(cueLeftClockWindow(rundown[2]!, 0)).toBe(true);
    expect(pickDueScheduledCue({ ...base, playhead: 0, cycle: 0, fired })).toBeNull();
    expect(pickDueScheduledCue({ ...base, playhead: 0, cycle: 1, fired })?.cue.id).toBe("a");
  });

  it("geeft niets in een gat tussen twee cues, zodat het scorebord terugkomt", () => {
    const gap = [cue("a", 0, 10), cue("b", 20, 30)];
    expect(pickDueScheduledCue({ ...base, cues: gap, playhead: 15, fired: new Set() })).toBeNull();
  });

  it("slaat uitgeschakelde, inactieve en andere fases over en neemt de vroegste starttijd", () => {
    const cues = [
      cue("late", 5, 20),
      cue("off", 0, 20, { enabled: false }),
      cue("inactive", 0, 20, { media: { active: false } }),
      cue("second-half", 0, 20, { matchStatus: "SECOND_HALF" }),
      cue("early", 2, 20),
    ];
    expect(pickDueScheduledCue({ ...base, cues, playhead: 10, fired: new Set() })?.cue.id).toBe("early");
  });

  it("start een cue zonder eindtijd alleen als de klok loopt of de wandklok telt", () => {
    const cues = [cue("trigger", 10, null)];
    const at = { ...base, cues, playhead: 11, fired: new Set<string>() };
    expect(pickDueScheduledCue({ ...at, usesLiveWallClock: false })).toBeNull();
    expect(pickDueScheduledCue({ ...at, usesLiveWallClock: false, timerRunning: true })?.cue.id).toBe("trigger");
  });

  it("deelt de gespeeld-sleutel tussen voor- en nawedstrijd-statussen", () => {
    expect(scheduledCueFiredKey("m1", "SETUP", "x", 2)).toBe("m1:PREMATCH:x:2");
    expect(scheduledCueFiredKey("m1", "FULL_TIME", "x", 0)).toBe("m1:POST_MATCH:x:0");
  });
});

describe("scheduledCueMediaKey", () => {
  it("laat opeenvolgende beelden één mediavak delen", () => {
    const a = { id: "a", media: { type: "IMAGE" } };
    const b = { id: "b", media: { type: "IMAGE" } };
    expect(scheduledCueMediaKey(a, 0)).toBe(scheduledCueMediaKey(b, 3));
  });

  it("start een video per cue en per doorloop in een nieuw vak", () => {
    const v = { id: "v", media: { type: "VIDEO" } };
    expect(scheduledCueMediaKey(v, 0)).not.toBe(scheduledCueMediaKey(v, 1));
    expect(scheduledCueMediaKey(v, 0)).not.toBe(scheduledCueMediaKey({ id: "w", media: { type: "VIDEO" } }, 0));
    expect(scheduledCueMediaKey(v, 0)).not.toBe(scheduledCueMediaKey({ id: "i", media: { type: "IMAGE" } }, 0));
  });
});

describe("scheduledCueExpectedPlaySec", () => {
  const image = { triggerSec: 15, endSec: 30, media: { durationSec: 10 } };

  it("telt het hele klokvenster als de cue op tijd start, niet de beeldduur", () => {
    expect(scheduledCueExpectedPlaySec(image, 15)).toBe(15);
    expect(scheduledCueExpectedPlaySec(image, 15.2)).toBeCloseTo(14.8);
  });

  it("telt alleen de rest van het venster als het scherm halverwege instapt", () => {
    expect(scheduledCueExpectedPlaySec(image, 22)).toBe(8);
  });

  it("blijft binnen het venster en nooit onder 1 s", () => {
    expect(scheduledCueExpectedPlaySec(image, 3)).toBe(15);
    expect(scheduledCueExpectedPlaySec(image, 29.9)).toBe(1);
    expect(scheduledCueExpectedPlaySec(image, Number.NaN)).toBe(15);
  });

  it("houdt de mediaduur aan voor een cue zonder eindtijd", () => {
    expect(scheduledCueExpectedPlaySec({ triggerSec: 15, endSec: null, media: { durationSec: 10 } }, 15)).toBe(10);
    expect(scheduledCueExpectedPlaySec({ triggerSec: 15, endSec: null, media: { durationSec: 0 } }, 15)).toBe(15);
  });
});
