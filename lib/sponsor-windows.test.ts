import { describe, expect, it } from "vitest";
import { halfWindowElapsed, sponsorSectionBudgetSeconds } from "./sponsor-distribution";
import type { Sponsor } from "./types";
import {
  blockAccumulatedElapsed,
  defaultSponsorLayoutId,
  resolveSponsorLayoutId,
  resolveSponsorWindow,
  shouldUsePeriodBreak,
  sponsorWindowBudgetSeconds,
  usesFootballSponsorEngine,
  windowPlayElapsed,
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
  });
});
