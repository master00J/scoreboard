import { describe, expect, it } from "vitest";
import { buildSponsorSlotMap, halfWindowElapsed, sponsorSectionBudgetSeconds } from "./sponsor-distribution";
import { applySponsorBudgetCapToSpreadPhase } from "./sponsor-display-helpers";
import type { Sponsor } from "./types";
import {
  blockAccumulatedElapsed,
  defaultSponsorLayoutId,
  resolveSponsorLayoutId,
  resolveSponsorWindow,
  shouldUsePeriodBreak,
  sponsorMatchClockFrozen,
  sponsorWindowBudgetSeconds,
  usesFootballSponsorEngine,
  windowPlayElapsed,
  windowScheduleElapsed,
  sponsorWallPlayTimelineComplete,
  activeSponsorsForWindow,
  buildWindowSponsorSlotMap,
  hasSponsorsForSectionOrWindow,
  windowTimelineSeconds,
} from "./sponsor-windows";

function footballMatch(status = "FIRST_HALF") {
  return {
    sport: "FOOTBALL",
    status,
    currentPeriod: status === "SECOND_HALF" ? 2 : 1,
    halfDurationSec: 2700,
    periodDurationSec: 2700,
    halfBreakSec: 900,
  };
}

const footballSponsor = {
  prematchSeconds: 180,
  matchSeconds: 120,
  matchFirstHalfSeconds: 120,
  matchSecondHalfSeconds: 90,
  halftimeSeconds: 60,
  postmatchSeconds: 30,
} as Sponsor;

describe("voetbal-engine blijft identiek", () => {
  it("dwingt two_blocks af, ook als JSON iets anders vraagt", () => {
    expect(resolveSponsorLayoutId("FOOTBALL", { FOOTBALL: "per_period", BASKETBALL: "per_period" })).toBe(
      "two_blocks",
    );
    expect(usesFootballSponsorEngine("FOOTBALL", "per_period")).toBe(true);
  });

  it("geeft dezelfde t en H als halfWindowElapsed", () => {
    const match = footballMatch("FIRST_HALF");
    const window = resolveSponsorWindow({ match, timerRunning: true });
    expect(window.footballEngine).toBe(true);
    expect(window.section).toBe("match");
    expect(window.H).toBe(2700);
    expect(windowPlayElapsed({
      window,
      elapsedSec: 400,
      status: match.status,
      halfDurationSec: match.halfDurationSec,
      periodDurationSec: match.periodDurationSec,
      currentPeriod: match.currentPeriod,
      periodCount: 2,
      wallElapsedSec: 999,
    })).toBe(halfWindowElapsed(400, "FIRST_HALF", 2700));
  });

  it("gebruikt voetbalkolommen, nooit sportBudgetsJson", () => {
    const match = footballMatch("FIRST_HALF");
    const window = resolveSponsorWindow({ match, timerRunning: true });
    const sponsor = {
      ...footballSponsor,
      sportBudgetsJson: JSON.stringify({ FOOTBALL: { play1: 9 }, BASKETBALL: { "period:1": 40 } }),
    } as Sponsor;
    expect(sponsorWindowBudgetSeconds(sponsor, window, "FOOTBALL")).toBe(
      sponsorSectionBudgetSeconds(sponsor, "match", "FIRST_HALF"),
    );
    expect(sponsorWindowBudgetSeconds(sponsor, window, "FOOTBALL")).toBe(120);
  });

  it("toont geen periodBreak bij gepauzeerde voetbalhelft", () => {
    expect(
      shouldUsePeriodBreak({
        sport: "FOOTBALL",
        status: "FIRST_HALF",
        timerRunning: false,
        periodBreakPending: true,
        layoutId: "per_period",
      }),
    ).toBe(false);
    const window = resolveSponsorWindow({
      match: footballMatch("FIRST_HALF"),
      timerRunning: false,
      periodBreakPending: true,
      layouts: { BASKETBALL: "per_period" },
    });
    expect(window.id).toBe("play1");
    expect(window.footballEngine).toBe(true);
  });
});

describe("basketbal per_period", () => {
  it("is de default en reset de slotklok niet over quarters heen", () => {
    expect(defaultSponsorLayoutId("BASKETBALL")).toBe("per_period");
    const match = {
      sport: "BASKETBALL",
      status: "FIRST_HALF",
      currentPeriod: 2,
      halfDurationSec: 600,
      periodDurationSec: 600,
      halfBreakSec: 900,
    };
    const q2 = resolveSponsorWindow({ match, timerRunning: true });
    expect(q2.id).toBe("period:2");
    expect(q2.H).toBe(600);
    expect(q2.footballEngine).toBe(false);
    expect(
      windowPlayElapsed({
        window: q2,
        elapsedSec: 40,
        status: "FIRST_HALF",
        halfDurationSec: 600,
        periodDurationSec: 600,
        currentPeriod: 2,
        periodCount: 4,
        wallElapsedSec: 0,
      }),
    ).toBe(40);
  });

  it("telt two_blocks door over Q1+Q2", () => {
    expect(
      blockAccumulatedElapsed({
        elapsedSec: 50,
        currentPeriod: 2,
        periodDurationSec: 600,
        periodCount: 4,
        windowId: "play1",
      }),
    ).toBe(650);
    const match = {
      sport: "BASKETBALL",
      status: "FIRST_HALF",
      currentPeriod: 2,
      halfDurationSec: 600,
      periodDurationSec: 600,
      halfBreakSec: 900,
    };
    const window = resolveSponsorWindow({
      match,
      timerRunning: true,
      layouts: { BASKETBALL: "two_blocks" },
    });
    expect(window.id).toBe("play1");
    expect(window.H).toBe(1200);
    expect(
      windowPlayElapsed({
        window,
        elapsedSec: 50,
        status: "FIRST_HALF",
        halfDurationSec: 600,
        periodDurationSec: 600,
        currentPeriod: 2,
        periodCount: 4,
        wallElapsedSec: 0,
      }),
    ).toBe(650);
  });

  it("zet periodBreak alleen na een periodewissel met stilstaande klok", () => {
    const match = {
      sport: "BASKETBALL",
      status: "FIRST_HALF",
      currentPeriod: 2,
      halfDurationSec: 600,
      periodDurationSec: 600,
      halfBreakSec: 120,
    };
    expect(resolveSponsorWindow({ match, timerRunning: false, periodBreakPending: true }).id).toBe(
      "periodBreak",
    );
    expect(resolveSponsorWindow({ match, timerRunning: false, periodBreakPending: false }).id).toBe(
      "period:2",
    );
    expect(resolveSponsorWindow({ match, timerRunning: true, periodBreakPending: true }).id).toBe(
      "period:2",
    );
  });

  it("gebruikt 2 minuten tussen quarters en 15 minuten rust, ook als halfBreakSec 15 min is", () => {
    const base = {
      sport: "BASKETBALL",
      currentPeriod: 2,
      halfDurationSec: 600,
      periodDurationSec: 600,
      halfBreakSec: 900,
      shortBreakSec: 120,
    };
    expect(
      resolveSponsorWindow({
        match: { ...base, status: "FIRST_HALF" },
        timerRunning: false,
        periodBreakPending: true,
      }).H,
    ).toBe(120);
    expect(
      resolveSponsorWindow({
        match: { ...base, status: "HALF_TIME", currentPeriod: 2 },
        timerRunning: false,
      }).H,
    ).toBe(900);
    expect(
      resolveSponsorWindow({
        match: { ...base, status: "EXTRA_TIME", currentPeriod: 5 },
        timerRunning: false,
        periodBreakPending: true,
      }).id,
    ).toBe("periodBreak");
  });
});

describe("volleybal", () => {
  it("gebruikt wandklok tijdens sets en geen auto-periodBreak", () => {
    expect(defaultSponsorLayoutId("VOLLEYBALL")).toBe("inplay_plus_breaks");
    const match = {
      sport: "VOLLEYBALL",
      status: "FIRST_HALF",
      currentPeriod: 2,
      halfDurationSec: 0,
      periodDurationSec: 0,
      halfBreakSec: 180,
    };
    const window = resolveSponsorWindow({
      match,
      timerRunning: false,
      periodBreakPending: true,
    });
    expect(window.id).toBe("play");
    expect(window.clock).toBe("wall");
    expect(
      windowPlayElapsed({
        window,
        elapsedSec: 0,
        status: "FIRST_HALF",
        halfDurationSec: 0,
        periodDurationSec: 0,
        currentPeriod: 2,
        periodCount: 5,
        wallElapsedSec: 77,
      }),
    ).toBe(77);
    expect(sponsorMatchClockFrozen(window, false)).toBe(false);
    expect(sponsorMatchClockFrozen(window, true)).toBe(false);
  });

  it("plant sportBudgetsJson.play op de slotmap (niet het lege sectie-budget)", () => {
    const match = {
      sport: "VOLLEYBALL",
      status: "FIRST_HALF",
      currentPeriod: 1,
      halfDurationSec: 0,
      periodDurationSec: 0,
      halfBreakSec: 180,
    };
    const windowed = {
      id: "windowed",
      active: true,
      name: "Window",
      prematchSeconds: 0,
      halftimeSeconds: 0,
      matchSeconds: 0,
      postmatchSeconds: 0,
      matchFirstHalfSeconds: 0,
      matchSecondHalfSeconds: 0,
      imageDefaultSec: 10,
      media: [
        {
          id: "w-m1",
          type: "IMAGE",
          active: true,
          durationSec: 10,
          title: "w",
          path: "/x/w.png",
        },
      ],
      sportBudgetsJson: JSON.stringify({ VOLLEYBALL: { play: 120 } }),
    } as Sponsor;
    const legacy = {
      id: "legacy",
      active: true,
      name: "Legacy",
      prematchSeconds: 0,
      halftimeSeconds: 0,
      matchSeconds: 60,
      postmatchSeconds: 0,
      matchFirstHalfSeconds: 0,
      matchSecondHalfSeconds: 0,
      imageDefaultSec: 10,
      media: [
        {
          id: "l-m1",
          type: "IMAGE",
          active: true,
          durationSec: 10,
          title: "l",
          path: "/x/l.png",
        },
      ],
    } as Sponsor;
    const window = resolveSponsorWindow({ match, timerRunning: false });
    expect(sponsorWindowBudgetSeconds(windowed, window, "VOLLEYBALL")).toBe(120);
    expect(sponsorSectionBudgetSeconds(windowed, window.section, window.matchStatus)).toBe(0);

    const emptyLegacyPlan = buildSponsorSlotMap(
      activeSponsorsForWindow([windowed], window, "VOLLEYBALL"),
      window.section,
      windowTimelineSeconds(window, match, [windowed]),
      window.mediaStatus,
    );
    expect(emptyLegacyPlan.filter(Boolean).length).toBe(0);

    const map = buildWindowSponsorSlotMap([windowed], window, match);
    expect(map.filter(Boolean).length).toBeGreaterThan(0);
    expect(hasSponsorsForSectionOrWindow([windowed], "match", "FIRST_HALF", window, "VOLLEYBALL")).toBe(true);

    const mixed = buildWindowSponsorSlotMap([legacy, windowed], window, match);
    const counts: Record<string, number> = {};
    for (const id of mixed) {
      if (id) counts[id] = (counts[id] ?? 0) + 1;
    }
    expect(counts.windowed).toBeGreaterThan(0);
    expect(counts.legacy).toBeGreaterThan(0);

    const capped = applySponsorBudgetCapToSpreadPhase(
      { phase: "sponsor", sponsorFilterId: "windowed" },
      {
        cycleBudgetForever: false,
        sponsors: [windowed],
        section: "match",
        matchStatus: "FIRST_HALF",
        slotMap: map,
        slotT: 1,
        sponsorLedger: null,
        ledgerMatchesSegment: false,
        nowMs: 0,
        budgetOf: (s) => sponsorWindowBudgetSeconds(s, window, "VOLLEYBALL"),
      },
    );
    expect(capped.phase).toBe("sponsor");
    expect(capped.sponsorFilterId).toBe("windowed");
  });

  it("plant setbreak-budget uit sportBudgetsJson.halftime", () => {
    const match = {
      sport: "VOLLEYBALL",
      status: "HALF_TIME",
      currentPeriod: 1,
      halfDurationSec: 0,
      periodDurationSec: 0,
      halfBreakSec: 180,
    };
    const s = {
      id: "s1",
      active: true,
      name: "HT",
      prematchSeconds: 0,
      halftimeSeconds: 0,
      matchSeconds: 0,
      imageDefaultSec: 10,
      media: [
        {
          id: "ht-m1",
          type: "IMAGE",
          active: true,
          durationSec: 10,
          title: "ht",
          path: "/x/ht.png",
        },
      ],
      sportBudgetsJson: JSON.stringify({ VOLLEYBALL: { halftime: 60 } }),
    } as Sponsor;
    const window = resolveSponsorWindow({ match, timerRunning: false });
    expect(window.id).toBe("halftime");
    expect(sponsorWindowBudgetSeconds(s, window, "VOLLEYBALL")).toBe(60);
    const map = buildWindowSponsorSlotMap([s], window, match);
    expect(map.filter(Boolean).length).toBeGreaterThan(0);
  });
});

describe("sponsorMatchClockFrozen", () => {
  it("bevriest voetbal zonder lopende klok", () => {
    const window = resolveSponsorWindow({
      match: footballMatch("FIRST_HALF"),
      timerRunning: false,
    });
    expect(sponsorMatchClockFrozen(window, false)).toBe(true);
    expect(sponsorMatchClockFrozen(window, true)).toBe(false);
  });
});

describe("sponsorWallPlayTimelineComplete", () => {
  it("is klaar als de volleybal-wandklok de slotmap voorbij is", () => {
    expect(
      sponsorWallPlayTimelineComplete({
        clock: "wall",
        section: "match",
        cycleBudgetForever: false,
        wallElapsedSec: 60,
        timelineSec: 60,
      }),
    ).toBe(true);
    expect(
      sponsorWallPlayTimelineComplete({
        clock: "wall",
        section: "match",
        cycleBudgetForever: false,
        wallElapsedSec: 59,
        timelineSec: 60,
      }),
    ).toBe(false);
  });

  it("blijft open bij voetbal of bij herhalend budget", () => {
    expect(
      sponsorWallPlayTimelineComplete({
        clock: "football_half",
        section: "match",
        cycleBudgetForever: false,
        wallElapsedSec: 2700,
        timelineSec: 2700,
      }),
    ).toBe(false);
    expect(
      sponsorWallPlayTimelineComplete({
        clock: "wall",
        section: "match",
        cycleBudgetForever: true,
        wallElapsedSec: 120,
        timelineSec: 60,
      }),
    ).toBe(false);
  });

  it("kapt de lookup-tijd, maar laat de speelkop voorbij H lopen", () => {
    const window = { clock: "wall" as const, H: 60, footballEngine: false, section: "match", id: "play1" } as Parameters<
      typeof windowPlayElapsed
    >[0]["window"];
    const input = {
      window,
      elapsedSec: 0,
      status: "FIRST_HALF",
      halfDurationSec: 60,
      periodDurationSec: 60,
      currentPeriod: 1,
      periodCount: 5,
      wallElapsedSec: 80,
    };
    expect(windowPlayElapsed(input)).toBe(59);
    expect(windowScheduleElapsed(input)).toBe(80);
  });
});
