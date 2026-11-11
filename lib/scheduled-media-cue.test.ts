import { describe, expect, it } from "vitest";
import {
  cueEndSec,
  cueExpectedPlaySec,
  cueIsDueAtElapsed,
  cueLeftClockWindow,
  cueResumesAfterInterruption,
  cueClipSessionId,
  pickDueScheduledCue,
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

describe("sponsorwissel in een rundown", () => {
  /** Drie sponsorfoto's van 10 s, elk in een venster van 15 s, in een rundown die herhaalt. */
  const photo = (id: string, triggerSec: number, patch: Record<string, unknown> = {}) => ({
    id,
    enabled: true,
    matchStatus: "FIRST_HALF",
    triggerSec,
    endSec: triggerSec + 15,
    loop: true,
    media: { active: true, durationSec: 10 },
    ...patch,
  });
  const rundown = [photo("b", 15), photo("c", 30), photo("a", 0)];
  const cycleSec = rundownCycleSec(rundown);

  /** Zoals het scherm het doet: per doorloop start elke cue één keer. */
  function pickAt(elapsedSec: number, started: Set<string>, cues = rundown) {
    const cycle = rundownCycleIndex(elapsedSec, cycleSec, true);
    const cue = pickDueScheduledCue(cues, {
      matchStatus: "FIRST_HALF",
      playheadSec: wrapRundownElapsed(elapsedSec, cycleSec, true),
      clockRuns: true,
      alreadyStarted: (candidate) => started.has(`${candidate.id}:${cycle}`),
    });
    if (cue) started.add(`${cue.id}:${cycle}`);
    return cue?.id ?? null;
  }

  it("heeft de volgende sponsor klaar op het moment dat het venster van de vorige om is", () => {
    const started = new Set<string>();
    expect(pickAt(0.1, started)).toBe("a");
    // Venster van a loopt tot 15 s: op dat moment is b aan de beurt, zonder tussenstap zonder clip.
    expect(cueLeftClockWindow(rundown[2]!, 15)).toBe(true);
    expect(pickAt(15, started)).toBe("b");
    expect(pickAt(30.2, started)).toBe("c");
  });

  it("begint na de laatste sponsor opnieuw bij de eerste", () => {
    const started = new Set<string>();
    for (const t of [0.1, 15, 30]) pickAt(t, started);
    expect(cueLeftClockWindow(rundown[1]!, wrapRundownElapsed(45.1, cycleSec, true))).toBe(true);
    expect(pickAt(45.1, started)).toBe("a");
  });

  it("start een cue niet twee keer in dezelfde doorloop", () => {
    const started = new Set<string>();
    expect(pickAt(16, started)).toBe("b");
    expect(pickAt(17, started)).toBeNull();
  });

  /** Zoals het scherm het doet als een losse clip, goal of kaart de sponsor van het scherm haalt. */
  function interrupt(cue: (typeof rundown)[number], elapsedSec: number, started: Set<string>) {
    if (cueResumesAfterInterruption(cue)) {
      started.delete(`${cue.id}:${rundownCycleIndex(elapsedSec, cycleSec, true)}`);
    }
  }

  it("brengt een onderbroken sponsor terug zolang zijn venster loopt", () => {
    const started = new Set<string>();
    expect(pickAt(16, started)).toBe("b");
    interrupt(rundown[0]!, 18, started);
    // De losse clip is na 5 s klaar: het venster van b loopt nog tot 30 s.
    expect(pickAt(23, started)).toBe("b");
  });

  it("gaat na een lange onderbreking verder met de sponsor die dan aan de beurt is", () => {
    const started = new Set<string>();
    expect(pickAt(16, started)).toBe("b");
    interrupt(rundown[0]!, 18, started);
    expect(pickAt(31, started)).toBe("c");
  });

  it("herhaalt na een onderbreking geen cue zonder venster", () => {
    const los = photo("los", 20, { endSec: null });
    const started = new Set<string>();
    expect(pickAt(21, started, [los])).toBe("los");
    interrupt(los, 21.5, started);
    expect(pickAt(21.8, started, [los])).toBeNull();
  });

  it("telt de schermtijd na een onderbreking als een apart stuk voor de sponsor", () => {
    const eerste = cueClipSessionId({ cueId: "b", cycle: 2, mediaId: "m1" });
    // Zelfde naam als vóór deze wijziging: lopende rapportage blijft aansluiten.
    expect(eerste).toBe("cue:b:2:m1");
    expect(cueClipSessionId({ cueId: "b", cycle: 2, mediaId: "m1", stint: 0 })).toBe(eerste);
    const terug = cueClipSessionId({ cueId: "b", cycle: 2, mediaId: "m1", stint: 1 });
    expect(terug).not.toBe(eerste);
    expect(cueClipSessionId({ cueId: "b", cycle: 2, mediaId: "m1", stint: 2 })).not.toBe(terug);
  });

  it("slaat cues over die uit staan, zonder actieve media of van een andere fase", () => {
    const started = new Set<string>();
    const cues = [
      photo("uit", 0, { enabled: false }),
      photo("inactief", 0, { media: { active: false, durationSec: 10 } }),
      photo("tweede-helft", 0, { matchStatus: "SECOND_HALF" }),
      photo("goed", 0),
    ];
    expect(pickAt(1, started, cues)).toBe("goed");
  });

  it("start een cue zonder venster alleen terwijl de klok loopt", () => {
    const cue = photo("los", 20, { endSec: null });
    const pick = (clockRuns: boolean) =>
      pickDueScheduledCue([cue], {
        matchStatus: "FIRST_HALF",
        playheadSec: 21,
        clockRuns,
        alreadyStarted: () => false,
      });
    expect(pick(false)).toBeNull();
    expect(pick(true)).toBe(cue);
  });

  it("verwacht een foto zo lang in beeld als haar venster duurt, niet haar eigen duur", () => {
    expect(cueExpectedPlaySec(photo("a", 90))).toBe(15);
    expect(cueExpectedPlaySec(photo("a", 90), 90.2)).toBeCloseTo(14.8);
  });

  it("verwacht alleen de rest van het venster als de cue halverwege start", () => {
    expect(cueExpectedPlaySec(photo("a", 90), 98)).toBe(7);
    // Speelkop van vóór de wrap of al voorbij het venster: nooit negatief of langer dan het venster.
    expect(cueExpectedPlaySec(photo("a", 90), 3)).toBe(15);
    expect(cueExpectedPlaySec(photo("a", 90), 200)).toBe(1);
  });

  it("verwacht zonder venster de duur van de clip", () => {
    expect(cueExpectedPlaySec({ triggerSec: 20, endSec: null, media: { durationSec: 12 } })).toBe(12);
    expect(cueExpectedPlaySec({ triggerSec: 20, media: { durationSec: 0 } })).toBe(15);
    expect(cueExpectedPlaySec({ triggerSec: 20, media: null }, 21)).toBe(15);
  });
});
