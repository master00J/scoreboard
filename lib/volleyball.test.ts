import { describe, expect, it } from "vitest";
import {
  applyVolleyballScoreDelta,
  DEFAULT_VOLLEYBALL_RULES,
  matchVolleyballPresetId,
  parseSetHistory,
  parseTechnicalTimeoutScores,
  rallyWinnersFromEvents,
  servingAfterRemovingLastRally,
  VOLLEYBALL_PRESETS,
  volleyballSetWinner,
  type Side,
  type VolleyballLive,
} from "./volleyball";

const base: VolleyballLive = {
  currentPeriod: 1,
  homeScore: 0,
  awayScore: 0,
  homeSets: 0,
  awaySets: 0,
  servingSide: "home",
  setFirstServer: "home",
  setHistory: [],
  homeTimeouts: 0,
  awayTimeouts: 0,
  status: "FIRST_HALF",
};

function nextLive(result: ReturnType<typeof applyVolleyballScoreDelta>): VolleyballLive {
  const { technicalTimeout: _t, setJustWon: _s, matchOver: _m, rejected: _r, ...live } = result;
  return live;
}

describe("volleybal-setregels", () => {
  it("wint een set bij 25–23 en start de volgende set op 0–0 in setbreak", () => {
    const live = { ...base, homeScore: 24, awayScore: 23, servingSide: "away" as const };
    const next = applyVolleyballScoreDelta(live, "home", 1);
    expect(next.setJustWon).toBe(true);
    expect(next.homeSets).toBe(1);
    expect(next.setHistory).toEqual([{ home: 25, away: 23, firstServer: "home" }]);
    expect(next.homeScore).toBe(0);
    expect(next.awayScore).toBe(0);
    expect(next.currentPeriod).toBe(2);
    expect(next.servingSide).toBe("away");
    expect(next.setFirstServer).toBe("away");
    expect(next.status).toBe("HALF_TIME");
    expect(next.matchOver).toBe(false);
  });

  it("vereist twee punten verschil", () => {
    expect(volleyballSetWinner(25, 24, 25)).toBeNull();
    expect(volleyballSetWinner(26, 24, 25)).toBe("home");
    expect(volleyballSetWinner(15, 13, 15)).toBe("home");
    expect(volleyballSetWinner(15, 14, 15)).toBeNull();
  });

  it("sluit de wedstrijd bij 3 gewonnen sets", () => {
    const live: VolleyballLive = {
      ...base,
      currentPeriod: 4,
      homeScore: 24,
      awayScore: 20,
      homeSets: 2,
      awaySets: 1,
      setFirstServer: "away",
      servingSide: "home",
      setHistory: [
        { home: 25, away: 20, firstServer: "home" },
        { home: 25, away: 18, firstServer: "away" },
        { home: 20, away: 25, firstServer: "home" },
      ],
    };
    const next = applyVolleyballScoreDelta(live, "home", 1);
    expect(next.matchOver).toBe(true);
    expect(next.status).toBe("FULL_TIME");
    expect(next.homeSets).toBe(3);
  });

  it("zet een technical timeout bij 8 en 16 in sets 1–4 alleen als dat aanstaat", () => {
    const atEight = applyVolleyballScoreDelta({ ...base, homeScore: 7, awayScore: 4 }, "home", 1, {
      technicalTimeoutsEnabled: true,
    });
    expect(atEight.technicalTimeout).toBe(true);
    expect(atEight.status).toBe("FIRST_HALF");
    expect(atEight.homeScore).toBe(8);

    const off = applyVolleyballScoreDelta({ ...base, homeScore: 7, awayScore: 4 }, "home", 1);
    expect(off.technicalTimeout).toBe(false);

    const atSixteen = applyVolleyballScoreDelta(
      { ...base, homeScore: 15, awayScore: 10, currentPeriod: 2 },
      "home",
      1,
      { technicalTimeoutsEnabled: true },
    );
    expect(atSixteen.technicalTimeout).toBe(true);

    const deciding = applyVolleyballScoreDelta(
      { ...base, currentPeriod: 5, homeScore: 7, awayScore: 4 },
      "home",
      1,
      { technicalTimeoutsEnabled: true },
    );
    expect(deciding.technicalTimeout).toBe(false);
  });

  it("gebruikt custom TTO-scores in plaats van 8 en 16", () => {
    const atTen = applyVolleyballScoreDelta({ ...base, homeScore: 9, awayScore: 4 }, "home", 1, {
      technicalTimeoutsEnabled: true,
      technicalTimeoutScores: [10],
    });
    expect(atTen.technicalTimeout).toBe(true);

    const atEight = applyVolleyballScoreDelta({ ...base, homeScore: 7, awayScore: 4 }, "home", 1, {
      technicalTimeoutsEnabled: true,
      technicalTimeoutScores: [10],
    });
    expect(atEight.technicalTimeout).toBe(false);
  });

  it("herkent FIVB-preset vs TTO-preset", () => {
    expect(matchVolleyballPresetId(DEFAULT_VOLLEYBALL_RULES)).toBe("indoor");
    expect(matchVolleyballPresetId(VOLLEYBALL_PRESETS.indoor_tto)).toBe("indoor_tto");
    expect(matchVolleyballPresetId(VOLLEYBALL_PRESETS.italy_serie_a_men)).toBe("italy_serie_a_men");
    expect(parseTechnicalTimeoutScores("8, 16")).toEqual([8, 16]);
    expect(parseTechnicalTimeoutScores("10")).toEqual([10]);
  });

  it("maakt een setwinst ongedaan vanaf 0–0 met −1", () => {
    const afterSet = applyVolleyballScoreDelta({ ...base, homeScore: 24, awayScore: 20 }, "home", 1);
    const undone = applyVolleyballScoreDelta(nextLive(afterSet), "home", -1);
    expect(undone.homeSets).toBe(0);
    expect(undone.currentPeriod).toBe(1);
    expect(undone.homeScore).toBe(24);
    expect(undone.awayScore).toBe(20);
    expect(undone.setHistory).toEqual([]);
    expect(undone.servingSide).toBe("home");
    expect(undone.setFirstServer).toBe("home");
  });

  it("herstel de service bij −1 van de laatste rally", () => {
    const afterSideOut = applyVolleyballScoreDelta({ ...base, homeScore: 3, awayScore: 2, servingSide: "home" }, "away", 1);
    expect(afterSideOut.servingSide).toBe("away");
    expect(afterSideOut.awayScore).toBe(3);
    const undone = applyVolleyballScoreDelta(nextLive(afterSideOut), "away", -1, {
      rallyWinnersInSet: ["home", "away"],
    });
    expect(undone.awayScore).toBe(2);
    expect(undone.servingSide).toBe("home");
  });

  it("houdt de service bij −1 tijdens een puntenserie", () => {
    const undone = applyVolleyballScoreDelta(
      { ...base, homeScore: 5, awayScore: 2, servingSide: "home" },
      "home",
      -1,
      { rallyWinnersInSet: ["away", "home", "home", "home"] },
    );
    expect(undone.homeScore).toBe(4);
    expect(undone.servingSide).toBe("home");
  });

  it("leest setHistory JSON", () => {
    expect(parseSetHistory('[{"home":25,"away":21}]')).toEqual([{ home: 25, away: 21 }]);
    expect(parseSetHistory(null)).toEqual([]);
  });
});

describe("volleybal-serviceherstel uit events", () => {
  it("negeert een handmatige technical timeout zonder punt", () => {
    const winners = rallyWinnersFromEvents(
      [
        { type: "POINT", period: 1, teamId: "h", metaJson: JSON.stringify({ side: "home", delta: 1, sport: "VOLLEYBALL" }) },
        { type: "TECHNICAL_TIMEOUT", period: 1, metaJson: JSON.stringify({ side: "technical", seconds: 60 }) },
      ],
      { currentPeriod: 1, homeTeamId: "h", awayTeamId: "a" },
    );
    expect(winners).toEqual(["home"]);
  });

  it("berekent servingAfterRemovingLastRally", () => {
    expect(servingAfterRemovingLastRally(["home"], "home", "home")).toBe("home");
    expect(servingAfterRemovingLastRally(["home", "away"], "away", "home")).toBe("home");
    expect(servingAfterRemovingLastRally(["home"], "away", "home")).toBeNull();
  });
});

describe("volledige volleybalwedstrijd (3–2)", () => {
  it("speelt vijf sets met servicewissel, TTO, deuce, setbreak en matchwinst", () => {
    const tto = { technicalTimeoutsEnabled: true };
    let live: VolleyballLive = { ...base };

    const ttoAtEight = applyVolleyballScoreDelta({ ...live, homeScore: 7, awayScore: 4 }, "home", 1, tto);
    expect(ttoAtEight.technicalTimeout).toBe(true);
    expect(ttoAtEight.servingSide).toBe("home");

    const ttoAtSixteen = applyVolleyballScoreDelta({ ...live, homeScore: 15, awayScore: 10 }, "home", 1, tto);
    expect(ttoAtSixteen.technicalTimeout).toBe(true);

    const set1 = applyVolleyballScoreDelta({ ...live, homeScore: 24, awayScore: 20, servingSide: "away" }, "home", 1, tto);
    expect(set1.setJustWon).toBe(true);
    expect(set1.homeSets).toBe(1);
    expect(set1.status).toBe("HALF_TIME");
    expect(set1.servingSide).toBe("away");
    expect(set1.setFirstServer).toBe("away");
    expect(set1.homeTimeouts).toBe(0);
    live = nextLive(set1);

    const resume = applyVolleyballScoreDelta(live, "away", 1, tto);
    expect(resume.status).toBe("FIRST_HALF");
    expect(resume.currentPeriod).toBe(2);
    expect(resume.awayScore).toBe(1);
    expect(resume.servingSide).toBe("away");
    live = nextLive(resume);

    const set2 = applyVolleyballScoreDelta({ ...live, homeScore: 18, awayScore: 24, servingSide: "home" }, "away", 1, tto);
    expect(set2.setJustWon).toBe(true);
    expect(set2.awaySets).toBe(1);
    expect(set2.setFirstServer).toBe("home");
    expect(set2.currentPeriod).toBe(3);
    live = nextLive(set2);

    live = { ...live, homeScore: 24, awayScore: 24, servingSide: "away", status: "HALF_TIME" };
    const stillDeuce = applyVolleyballScoreDelta(live, "home", 1, tto);
    expect(stillDeuce.setJustWon).toBe(false);
    expect(stillDeuce.status).toBe("FIRST_HALF");
    expect(stillDeuce.homeScore).toBe(25);
    live = nextLive(stillDeuce);
    const set3 = applyVolleyballScoreDelta(live, "home", 1, tto);
    expect(set3.setJustWon).toBe(true);
    expect(set3.homeSets).toBe(2);
    expect(set3.setHistory[2]).toEqual({ home: 26, away: 24, firstServer: "home" });
    live = nextLive(set3);

    const set4 = applyVolleyballScoreDelta(
      { ...live, homeScore: 21, awayScore: 24, servingSide: "home" },
      "away",
      1,
      tto,
    );
    expect(set4.setJustWon).toBe(true);
    expect(set4.awaySets).toBe(2);
    expect(set4.currentPeriod).toBe(5);
    expect(set4.status).toBe("HALF_TIME");
    live = nextLive(set4);

    const ttoSet5 = applyVolleyballScoreDelta({ ...live, homeScore: 7, awayScore: 4 }, "home", 1, tto);
    expect(ttoSet5.technicalTimeout).toBe(false);

    const set5 = applyVolleyballScoreDelta({ ...live, homeScore: 14, awayScore: 13, servingSide: "away" }, "home", 1, tto);
    expect(set5.setJustWon).toBe(true);
    expect(set5.matchOver).toBe(true);
    expect(set5.homeSets).toBe(3);
    expect(set5.awaySets).toBe(2);
    expect(set5.status).toBe("FULL_TIME");
    expect(set5.setHistory).toHaveLength(5);

    const rejected = applyVolleyballScoreDelta(nextLive(set5), "away", 1);
    expect(rejected.rejected).toBe("match_over");
    expect(rejected.homeSets).toBe(3);

    const reopen = applyVolleyballScoreDelta(nextLive(set5), "home", -1);
    expect(reopen.matchOver).toBe(false);
    expect(reopen.homeSets).toBe(2);
    expect(reopen.currentPeriod).toBe(5);
    expect(reopen.homeScore).toBe(14);
    expect(reopen.awayScore).toBe(13);
    expect(reopen.servingSide).toBe("home");
  });


  it("speelt best-of-3 tot 21 met beslisser tot 15", () => {
    const format = { setsToWin: 2, pointsToWinSet: 21, pointsToWinDecider: 15 };
    let live: VolleyballLive = { ...base };
    live = nextLive(applyVolleyballScoreDelta({ ...live, homeScore: 20, awayScore: 18 }, "home", 1, { format }));
    expect(live.homeSets).toBe(1);
    expect(live.currentPeriod).toBe(2);
    live = nextLive(applyVolleyballScoreDelta({ ...live, homeScore: 18, awayScore: 20 }, "away", 1, { format }));
    expect(live.awaySets).toBe(1);
    expect(live.currentPeriod).toBe(3);
    const match = applyVolleyballScoreDelta({ ...live, homeScore: 14, awayScore: 12 }, "home", 1, { format });
    expect(match.matchOver).toBe(true);
    expect(match.homeSets).toBe(2);
  });
});
