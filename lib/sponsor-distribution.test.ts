import { describe, expect, it } from "vitest";
import type { MediaItem, Sponsor } from "./types";
import {
  buildSponsorAppearancePlan,
  buildSponsorSlotMap,
  buildSponsorSecondQueue,
  catchUpSponsorSchedule,
  halfWindowElapsedOpenEnded,
  MAX_SPONSOR_SECOND_QUEUE,
  sectionSpreadClock,
  sectionPlayheadExhausted,
  holdSecondsCappedBySlotRun,
  lookupSponsorAtSecond,
  postmatchSpreadTimelineSeconds,
  resolveSponsorSpreadPhase,
  sponsorAppearanceIndexAt,
  sponsorSectionBudgetSeconds,
  sponsorScreenSecondsConsumed,
  type SponsorPhaseHangRef,
} from "./sponsor-distribution";
import { sectionForStatus } from "./sponsor-display-helpers";
import { createSponsorScheduleClock, sponsorScheduleTime } from "./sponsor-schedule-clock";

function media(id: string, durationSec: number): MediaItem {
  return {
    id,
    sponsorId: "sp",
    type: "VIDEO",
    url: `/${id}.mp4`,
    durationSec,
    active: true,
    createdAt: `2026-01-01T00:00:${id.padStart(2, "0")}.000Z`,
  } as unknown as MediaItem;
}

function sponsor(prematchSeconds: number, clips: number[]): Sponsor {
  return {
    id: "sp",
    name: "Matchsponsor",
    active: true,
    prematchSeconds,
    halftimeSeconds: 0,
    matchSeconds: 0,
    imageDefaultSec: 10,
    media: clips.map((sec, i) => media(String(i + 1), sec)),
    sponsorPlaybackOrderJson: null,
    sponsorPlaybackRepeatsJson: null,
  } as unknown as Sponsor;
}

describe("sponsor appearance plan — één vertoning = één clip", () => {
  it("vult het budget met opeenvolgende clips uit de rotatie", () => {
    // 3 clips van 20s, budget 120s → 6 vertoningen van 20s, samen precies 120s.
    const plan = buildSponsorAppearancePlan([sponsor(120, [20, 20, 20])], "prematch");
    expect(plan).toHaveLength(1);
    expect(plan[0]!.appearances).toBe(6);
    expect(plan[0]!.appearanceSecs).toEqual([20, 20, 20, 20, 20, 20]);
    expect(plan[0]!.appearanceSecs.reduce((a, b) => a + b, 0)).toBe(120);
  });

  it("kapt nooit een clip af: de laatste mag over het budget uitlopen", () => {
    // 30,20,10,30 = 90 < 100 → er is nog budget, dus clip 5 (20s) start ook en speelt
    // helemaal uit → 110. Afkappen op 100 mag niet.
    const plan = buildSponsorAppearancePlan([sponsor(100, [30, 20, 10])], "prematch");
    expect(plan[0]!.appearanceSecs).toEqual([30, 20, 10, 30, 20]);
    expect(plan[0]!.appearanceSecs.reduce((a, b) => a + b, 0)).toBe(110);
  });

  it("start geen nieuwe clip meer zodra het budget precies op is", () => {
    // 20+20+20 = 60 = budget → stoppen, niet nog een vierde clip starten.
    const plan = buildSponsorAppearancePlan([sponsor(60, [20, 20, 20])], "prematch");
    expect(plan[0]!.appearanceSecs).toEqual([20, 20, 20]);
  });

  it("toont een geboekte sponsor volledig ook als het budget kleiner is dan de clip", () => {
    const plan = buildSponsorAppearancePlan([sponsor(5, [20])], "prematch");
    expect(plan[0]!.appearanceSecs).toEqual([20]);
  });
});

describe("hold per vertoning volgt de rotatie", () => {
  it("geeft clip 1, dan clip 2, dan clip 3 terug voor opeenvolgende slots", () => {
    const s = sponsor(120, [30, 20, 10]);
    const map = buildSponsorSlotMap([s], "prematch", 120);

    // Startseconden van de eerste drie vertoningen op de slotmap.
    const starts: number[] = [];
    let prev: string | null = null;
    for (let i = 0; i < map.length; i++) {
      const cur = map[i] ?? null;
      if (cur === "sp" && prev !== "sp") starts.push(i);
      prev = cur;
    }
    expect(starts.length).toBeGreaterThanOrEqual(3);

    expect(sponsorAppearanceIndexAt(map, "sp", starts[0]!)).toBe(0);
    expect(sponsorAppearanceIndexAt(map, "sp", starts[1]!)).toBe(1);
    expect(sponsorAppearanceIndexAt(map, "sp", starts[2]!)).toBe(2);

    expect(holdSecondsCappedBySlotRun([s], "prematch", undefined, "sp", map, starts[0]!)).toBe(30);
    expect(holdSecondsCappedBySlotRun([s], "prematch", undefined, "sp", map, starts[1]!)).toBe(20);
    expect(holdSecondsCappedBySlotRun([s], "prematch", undefined, "sp", map, starts[2]!)).toBe(10);
  });

  it("geeft bij elke vertoning door welke clip het rooster inplande", () => {
    const s = sponsor(120, [30, 20, 10]);
    const map = buildSponsorSlotMap([s], "prematch", 120);
    const starts: number[] = [];
    let prev: string | null = null;
    for (let i = 0; i < map.length; i++) {
      const cur = map[i] ?? null;
      if (cur === "sp" && prev !== "sp") starts.push(i);
      prev = cur;
    }

    const hangRef: SponsorPhaseHangRef = { current: null };
    let nowMs = 0;
    for (const [n, startSec] of starts.slice(0, 3).entries()) {
      nowMs = startSec * 1000;
      const view = resolveSponsorSpreadPhase(
        { phase: "sponsor", sponsorId: "sp" },
        [s],
        "prematch",
        undefined,
        nowMs,
        hangRef,
        { slotMap: map, slotT: startSec },
      );
      expect(view.appearanceIndex).toBe(n);
      // Halverwege de clip is het nog steeds dezelfde vertoning, ook al is het slot al voorbij.
      const midway = resolveSponsorSpreadPhase(
        { phase: "scoreboard", sponsorId: null },
        [s],
        "prematch",
        undefined,
        nowMs + 5_000,
        hangRef,
        { slotMap: map, slotT: startSec + 5 },
      );
      expect(midway.sponsorFilterId).toBe("sp");
      expect(midway.appearanceIndex).toBe(n);
      expect(midway.appearanceStartedAtMs).toBe(nowMs);
      hangRef.current = null;
    }
  });
});

describe("rustklok stopt in plaats van te wrappen", () => {
  it("loopt één keer over de pauzeduur en meldt dan klaar", () => {
    expect(sectionSpreadClock(0, 900)).toEqual({ t: 0, timelineComplete: false });
    expect(sectionSpreadClock(450, 900)).toEqual({ t: 450, timelineComplete: false });
    // Regressie: hier begon het rooster vroeger opnieuw (`% H` → t = 0).
    expect(sectionSpreadClock(900, 900)).toEqual({ t: 899, timelineComplete: true });
    expect(sectionSpreadClock(1200, 900)).toEqual({ t: 899, timelineComplete: true });
  });

  it("blijft doorlopen met de instelling «budget-cycli herhalen»", () => {
    expect(sectionSpreadClock(900, 900, true)).toEqual({ t: 0, timelineComplete: false });
    expect(sectionSpreadClock(1050, 900, true)).toEqual({ t: 150, timelineComplete: false });
  });

  it("gebruikt de bevroren speelkop, niet de ruwe wandtijd", () => {
    expect(sectionPlayheadExhausted(50, 60)).toBe(false);
    expect(sectionPlayheadExhausted(60, 60)).toBe(true);
    expect(sectionPlayheadExhausted(90, 60, true)).toBe(false);
  });
});

describe("na-wedstrijd sectie", () => {
  function postmatchSponsor(seconds: number, clips: number[]): Sponsor {
    return { ...sponsor(0, clips), postmatchSeconds: seconds } as unknown as Sponsor;
  }

  it("FULL_TIME en POST_MATCH horen bij de postmatch-sectie", () => {
    expect(sectionForStatus("FULL_TIME")).toBe("postmatch");
    expect(sectionForStatus("POST_MATCH")).toBe("postmatch");
    // Regressie: deze vielen door naar "prematch", waardoor het rooster nooit liep.
    expect(sectionForStatus("PREMATCH")).toBe("prematch");
    expect(sectionForStatus("HALF_TIME")).toBe("halftime");
  });

  it("gebruikt het eigen postmatch-budget, niet dat van de wedstrijd", () => {
    const s = postmatchSponsor(90, [30]);
    expect(sponsorSectionBudgetSeconds(s, "postmatch")).toBe(90);
    expect(sponsorSectionBudgetSeconds(s, "prematch")).toBe(0);
  });

  it("plant vertoningen binnen het postmatch-budget", () => {
    const s = postmatchSponsor(90, [30, 20]);
    const plan = buildSponsorAppearancePlan([s], "postmatch");
    // 30,20,30 = 80 < 90 → nog budget, dus clip 4 (20s) start ook en loopt uit → 100.
    expect(plan[0]!.appearanceSecs).toEqual([30, 20, 30, 20]);
  });

  it("tijdlijn is zo lang als de geboekte postmatch-tijd", () => {
    expect(postmatchSpreadTimelineSeconds([postmatchSponsor(300, [30])])).toBe(300);
    // Ondergrens zodat een klein budget nog steeds een bruikbaar rooster geeft.
    expect(postmatchSpreadTimelineSeconds([postmatchSponsor(10, [30])])).toBe(60);
  });
});

describe("verbruikte schermtijd blijft in de buurt van het budget", () => {
  it("overschrijdt het budget niet meer met een veelvoud bij meerdere clips", () => {
    // Regressie: hold was een volledige pass (60s) terwijl het rooster met 20s rekende,
    // waardoor deze sponsor 3× zijn geboekte schermtijd kreeg.
    const s = sponsor(120, [20, 20, 20]);
    const map = buildSponsorSlotMap([s], "prematch", 120);
    const consumed = sponsorScreenSecondsConsumed(map, [s], "prematch", undefined, 120, "sp");
    expect(consumed).toBeGreaterThan(0);
    // Hoogstens één lopende clip overschot — nooit een veelvoud van het budget.
    expect(consumed).toBeLessThanOrEqual(120 + 20);
  });
});

describe("resolveSponsorSpreadPhase — gap na hang", () => {
  it("start de volgende clip meteen als die al gepland is, zonder scorebordflits", () => {
    const s = sponsor(60, [10]);
    const hangRef: SponsorPhaseHangRef = {
      current: {
        sponsorId: "sp",
        untilMs: 1_000,
        startedAtMs: 0,
        startedAtSlotIdx: 0,
        lastSeenAtMs: 1_000,
      },
    };
    const afterHang = resolveSponsorSpreadPhase(
      { phase: "sponsor", sponsorId: "sp" },
      [s],
      "prematch",
      undefined,
      1_500,
      hangRef,
      { slotMap: Array(60).fill("sp"), slotT: 15 },
    );
    expect(afterHang.phase).toBe("sponsor");
    expect(afterHang.sponsorFilterId).toBe("sp");
    expect(afterHang.appearanceStartedAtMs).toBe(1_500);
    expect(hangRef.current?.sponsorId).toBe("sp");
    expect(hangRef.current?.startedAtMs).toBe(1_500);
  });

  it("slaat een te korte scorebordspleet over en speelt de volgende clip", () => {
    const s = sponsor(60, [10]);
    const map: (string | null)[] = Array(60).fill(null);
    map[12] = "sp";
    map[13] = "sp";
    const hangRef: SponsorPhaseHangRef = {
      current: {
        sponsorId: "sp",
        untilMs: 1_000,
        startedAtMs: 0,
        startedAtSlotIdx: 0,
        lastSeenAtMs: 1_000,
      },
    };
    const afterHang = resolveSponsorSpreadPhase(
      { phase: "scoreboard", sponsorId: null },
      [s],
      "prematch",
      undefined,
      1_500,
      hangRef,
      { slotMap: map, slotT: 11 },
    );
    expect(afterHang.phase).toBe("sponsor");
    expect(afterHang.sponsorFilterId).toBe("sp");
  });

  it("houdt een leesbare scorebordpauze tussen clips", () => {
    const s = sponsor(60, [10]);
    const map: (string | null)[] = Array(60).fill(null);
    map[20] = "sp";
    const hangRef: SponsorPhaseHangRef = {
      current: {
        sponsorId: "sp",
        untilMs: 1_000,
        startedAtMs: 0,
        startedAtSlotIdx: 0,
        lastSeenAtMs: 1_000,
      },
    };
    const afterHang = resolveSponsorSpreadPhase(
      { phase: "scoreboard", sponsorId: null },
      [s],
      "prematch",
      undefined,
      1_500,
      hangRef,
      { slotMap: map, slotT: 11 },
    );
    expect(afterHang).toEqual({ phase: "scoreboard", sponsorFilterId: null });
    expect(hangRef.current).toBeNull();
  });

  it("herstart dezelfde vertoning niet als de klok op hetzelfde slot stilstaat", () => {
    const s = sponsor(60, [10]);
    const hangRef: SponsorPhaseHangRef = {
      current: {
        sponsorId: "sp",
        untilMs: 1_000,
        startedAtMs: 0,
        startedAtSlotIdx: 15,
        lastSeenAtMs: 1_000,
      },
    };
    const afterHang = resolveSponsorSpreadPhase(
      { phase: "sponsor", sponsorId: "sp" },
      [s],
      "prematch",
      undefined,
      1_500,
      hangRef,
      { slotMap: Array(60).fill("sp"), slotT: 15 },
    );
    expect(afterHang).toEqual({ phase: "scoreboard", sponsorFilterId: null });
    expect(hangRef.current).toBeNull();
  });
});

describe("onderbreking die het beeld vervangt (goal, kaart, cue)", () => {
  function clip(id: string, sponsorId: string, durationSec: number): MediaItem {
    return {
      id,
      sponsorId,
      type: "VIDEO",
      url: `/${id}.mp4`,
      durationSec,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    } as unknown as MediaItem;
  }
  function named(id: string, clipSec: number): Sponsor {
    return {
      id,
      name: id,
      active: true,
      prematchSeconds: clipSec * 2,
      halftimeSeconds: 0,
      matchSeconds: 0,
      imageDefaultSec: 10,
      media: [clip(`${id}-clip`, id, clipSec)],
      sponsorPlaybackOrderJson: null,
      sponsorPlaybackRepeatsJson: null,
    } as unknown as Sponsor;
  }

  /** Loopt het rooster af zoals het scherm dat doet en geeft elke vertoning met haar duur terug. */
  function run(goal: { fromMs: number; toMs: number } | null, restartsClip: boolean) {
    const sponsors = [named("circus", 15), named("cristal", 15), named("port", 10), named("stanno", 15)];
    const H = 240;
    const map = buildSponsorSlotMap(sponsors, "prematch", H);
    const clockRef = { current: createSponsorScheduleClock() };
    const hangRef: SponsorPhaseHangRef = { current: null };
    const shown: { id: string; startMs: number; endMs: number }[] = [];
    let resumed = false;
    for (let ms = 0; ms <= 170_000; ms += 250) {
      const interrupted = !!goal && ms >= goal.fromMs && ms < goal.toMs;
      if (interrupted) resumed = true;
      const t = sponsorScheduleTime(clockRef, "half", ms / 1000, interrupted, H);
      const view = resolveSponsorSpreadPhase(
        lookupSponsorAtSecond(map, t),
        sponsors,
        "prematch",
        undefined,
        ms,
        hangRef,
        { slotMap: map, slotT: t, interrupted, restartsClip: interrupted && restartsClip, scheduleClock: clockRef.current },
      );
      if (interrupted || view.phase !== "sponsor" || !view.sponsorFilterId) continue;
      const last = shown[shown.length - 1];
      const startMs = view.appearanceStartedAtMs ?? ms;
      /** Liep de clip door (alleen klok stil), dan is het na de pauze nog dezelfde vertoning. */
      const continuesAfterPause = resumed && !restartsClip;
      resumed = false;
      if (last && last.id === view.sponsorFilterId && (startMs === last.startMs || continuesAfterPause)) {
        last.startMs = startMs;
        last.endMs = ms;
      } else {
        shown.push({ id: view.sponsorFilterId, startMs, endMs: ms });
      }
    }
    return shown.map((s) => ({ id: s.id, sec: Math.round((s.endMs - s.startMs) / 1000) }));
  }

  it("zonder onderbreking: elke sponsor zijn volle clip, in roostervolgorde", () => {
    expect(run(null, true).slice(0, 4)).toEqual([
      { id: "circus", sec: 15 },
      { id: "cristal", sec: 15 },
      { id: "port", sec: 10 },
      { id: "stanno", sec: 15 },
    ]);
  });

  it("na een goal speelt de onderbroken sponsor opnieuw volledig en valt er niemand weg", () => {
    const quiet = run(null, true);
    const firstStartMs = 1000 * buildSponsorSlotMap(
      [named("circus", 15), named("cristal", 15), named("port", 10), named("stanno", 15)],
      "prematch",
      240,
    ).findIndex((id) => id != null);
    // Goal 9,5 s in de clip van Circus, 20 s lang: langer dan de 15 s die de klok als sprong ziet.
    const goal = { fromMs: firstStartMs + 9_500, toMs: firstStartMs + 29_500 };
    const withGoal = run(goal, true);
    // Eerst het stuk van Circus tot de goal, daarna opnieuw de hele ronde in dezelfde volgorde.
    expect(withGoal[0]!.id).toBe("circus");
    expect(withGoal.slice(1, 5)).toEqual(quiet.slice(0, 4));
    // Ook daarna dezelfde volgorde; het rooster loopt alleen later (het venster eindigt eerder).
    const after = withGoal.slice(1).map((s) => s.id);
    expect(after.length).toBeGreaterThanOrEqual(4);
    expect(after).toEqual(quiet.map((s) => s.id).slice(0, after.length));
  });

  it("staat alleen de klok stil, dan loopt de vertoning verder met de resterende tijd", () => {
    const quiet = run(null, false);
    const firstStartMs = 1000 * buildSponsorSlotMap(
      [named("circus", 15), named("cristal", 15), named("port", 10), named("stanno", 15)],
      "prematch",
      240,
    ).findIndex((id) => id != null);
    const pause = { fromMs: firstStartMs + 9_500, toMs: firstStartMs + 29_500 };
    const paused = run(pause, false);
    // Geen herhaling: dezelfde reeks vertoningen als zonder pauze, en Circus krijgt zijn 15 s.
    expect(paused[0]).toEqual({ id: "circus", sec: 15 });
    const ids = paused.map((s) => s.id);
    expect(ids).toEqual(quiet.map((s) => s.id).slice(0, ids.length));
  });

  it("laat een vertoning die al voorbij was voorbij", () => {
    const s = sponsor(60, [10]);
    const hangRef: SponsorPhaseHangRef = {
      current: { sponsorId: "sp", untilMs: 1_000, startedAtMs: 0, startedAtSlotIdx: 4, lastSeenAtMs: 1_200 },
    };
    const clock = { adjustedT: 14 };
    resolveSponsorSpreadPhase({ phase: "scoreboard", sponsorId: null }, [s], "prematch", undefined, 9_000, hangRef, {
      slotMap: Array(60).fill(null),
      slotT: 14,
      interrupted: true,
      restartsClip: true,
      scheduleClock: clock,
    });
    expect(hangRef.current?.untilMs).toBeLessThan(9_000);
    expect(clock.adjustedT).toBe(14);
  });
});

describe("catchUpSponsorSchedule — achterstand inhalen met scorebordtijd", () => {
  const map: (string | null)[] = Array(200).fill(null);
  map[100] = "sp";
  map[101] = "sp";
  map[102] = "sp";
  const base = { frozen: false, hang: null, nowMs: 0, slotMap: map, maxT: 200 };

  it("springt door de scorebordpauze tot 5 s voor de volgende vertoning", () => {
    const clock = { adjustedT: 40 };
    expect(catchUpSponsorSchedule({ ...base, clock, rawT: 130 })).toBe(95);
    expect(clock.adjustedT).toBe(95);
  });

  it("loopt nooit vóór op de klok", () => {
    const clock = { adjustedT: 40 };
    expect(catchUpSponsorSchedule({ ...base, clock, rawT: 52 })).toBe(52);
  });

  it("doet niets zonder achterstand, tijdens een vertoning, of terwijl het rooster stilstaat", () => {
    expect(catchUpSponsorSchedule({ ...base, clock: { adjustedT: 40 }, rawT: 40 })).toBe(40);
    const hang = { sponsorId: "sp", untilMs: 10_000, startedAtMs: 0 };
    expect(catchUpSponsorSchedule({ ...base, clock: { adjustedT: 40 }, rawT: 130, hang })).toBe(40);
    expect(catchUpSponsorSchedule({ ...base, clock: { adjustedT: 40 }, rawT: 130, frozen: true })).toBe(40);
  });

  it("slaat geen vertoning over die net begint", () => {
    expect(catchUpSponsorSchedule({ ...base, clock: { adjustedT: 100.4 }, rawT: 190 })).toBe(100.4);
    expect(catchUpSponsorSchedule({ ...base, clock: { adjustedT: 97 }, rawT: 190 })).toBe(97);
  });

  it("loopt na de laatste vertoning door tot het einde van de tijdlijn", () => {
    expect(catchUpSponsorSchedule({ ...base, clock: { adjustedT: 150 }, rawT: 260 })).toBe(200);
  });
});

describe("halfWindowElapsedOpenEnded", () => {
  it("telt door in de blessuretijd van beide helften", () => {
    expect(halfWindowElapsedOpenEnded(2760, "FIRST_HALF", 2700)).toBe(2760);
    expect(halfWindowElapsedOpenEnded(5500, "SECOND_HALF", 2700)).toBe(2800);
    expect(halfWindowElapsedOpenEnded(1200, "FIRST_HALF", 2700)).toBe(1200);
  });
});

describe("resolveSponsorSpreadPhase — de vertoning wacht op haar clip", () => {
  const s = sponsor(60, [10]);
  const map: (string | null)[] = Array(60).fill(null);

  it("houdt de vertoning aan zolang haar clip nog op het scherm staat", () => {
    const hangRef: SponsorPhaseHangRef = {
      current: { sponsorId: "sp", untilMs: 10_000, startedAtMs: 0, startedAtSlotIdx: 5, lastSeenAtMs: 9_900 },
    };
    const view = resolveSponsorSpreadPhase({ phase: "scoreboard", sponsorId: null }, [s], "prematch", undefined, 10_200, hangRef, {
      slotMap: map,
      slotT: 15.2,
      liveClipSponsorId: "sp",
    });
    expect(view.phase).toBe("sponsor");
    expect(view.appearanceStartedAtMs).toBe(0);
    expect(hangRef.current?.sponsorId).toBe("sp");
  });

  it("laat haar los zodra de clip klaar is", () => {
    const hangRef: SponsorPhaseHangRef = {
      current: { sponsorId: "sp", untilMs: 10_000, startedAtMs: 0, startedAtSlotIdx: 5, lastSeenAtMs: 9_900 },
    };
    const view = resolveSponsorSpreadPhase({ phase: "scoreboard", sponsorId: null }, [s], "prematch", undefined, 10_200, hangRef, {
      slotMap: map,
      slotT: 15.2,
      liveClipSponsorId: null,
    });
    expect(view).toEqual({ phase: "scoreboard", sponsorFilterId: null });
    expect(hangRef.current).toBeNull();
  });

  it("start een vertoning waarvan het startvenster net voorbij is toch nog, en zet het rooster terug", () => {
    const late: (string | null)[] = Array(60).fill(null);
    late[20] = "volgende";
    late[21] = "volgende";
    late[22] = "volgende";
    const next = { ...sponsor(60, [10]), id: "volgende" } as Sponsor;
    const hangRef: SponsorPhaseHangRef = {
      current: { sponsorId: "sp", untilMs: 10_000, startedAtMs: 0, startedAtSlotIdx: 10, lastSeenAtMs: 9_900 },
    };
    const clock = { adjustedT: 23.6 };
    const view = resolveSponsorSpreadPhase({ phase: "scoreboard", sponsorId: null }, [s, next], "prematch", undefined, 13_600, hangRef, {
      slotMap: late,
      slotT: 23.6,
      scheduleClock: clock,
    });
    expect(view.sponsorFilterId).toBe("volgende");
    expect(clock.adjustedT).toBeLessThanOrEqual(22);
  });
});

describe("buildSponsorSlotMap — geen flitsgaten", () => {
  it("zet resttijd niet in spleten van 1 s tussen elke ronde", () => {
    const s = sponsor(50, [5]);
    const map = buildSponsorSlotMap([s], "prematch", 60);
    const starts: number[] = [];
    let prev: string | null = null;
    for (let i = 0; i < map.length; i++) {
      const cur = map[i] ?? null;
      if (cur === "sp" && prev !== "sp") starts.push(i);
      prev = cur;
    }
    expect(starts[0]).toBe(0);
    const deltas = starts.slice(1).map((at, i) => at - starts[i]!);
    // 10 clips van 5 s + 10 s rest: aaneen, niet 1 s scorebord tussen elke clip.
    expect(deltas.every((d) => d === 5)).toBe(true);
  });
});

describe("buildSponsorSecondQueue", () => {
  it("stopt bij het veiligheidsplafond", () => {
    const huge = {
      id: "sp",
      name: "Huge",
      active: true,
      prematchSeconds: MAX_SPONSOR_SECOND_QUEUE + 5_000,
      halftimeSeconds: 0,
      matchSeconds: 0,
      imageDefaultSec: 10,
      media: [media("1", 10)],
    } as Sponsor;
    const q = buildSponsorSecondQueue([huge], "prematch");
    expect(q.length).toBe(MAX_SPONSOR_SECOND_QUEUE);
  });
});
