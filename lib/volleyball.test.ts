import { describe, expect, it } from "vitest";
import {
  applyVolleyballScoreDelta,
  normalizeVolleyballFormat,
  parseSetHistory,
  volleyballSetWinner,
  volleyballTarget,
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
  it("wint een set bij 25–23 en start de volgende set op 0–0", () => {
    const live: VolleyballLive = { ...base, homeScore: 24, awayScore: 23, servingSide: "away", homeTimeouts: 2 };
    const next = applyVolleyballScoreDelta(live, "home", 1);
    expect(next.setJustWon).toBe(true);
    expect(next.homeSets).toBe(1);
    expect(next.setHistory).toEqual([{ home: 25, away: 23, firstServer: "home" }]);
    expect(next.homeScore).toBe(0);
    expect(next.awayScore).toBe(0);
    expect(next.homeTimeouts).toBe(0);
    expect(next.currentPeriod).toBe(2);
    expect(next.matchOver).toBe(false);
  });

  it("laat het team dat de vorige set niet opende, de nieuwe set openen (FIVB 12.3.1)", () => {
    // Set 1 geopend door thuis; thuis wint de set op eigen service → uit opent set 2.
    const set1 = applyVolleyballScoreDelta({ ...base, homeScore: 24, awayScore: 20 }, "home", 1);
    expect(set1.setFirstServer).toBe("away");
    expect(set1.servingSide).toBe("away");
    // Set 2 geopend door uit; ook als thuis set 2 wint, opent thuis set 3 (wissel per set, niet per winnaar).
    const set2 = applyVolleyballScoreDelta(
      { ...nextLive(set1), homeScore: 24, awayScore: 22, servingSide: "home" },
      "home",
      1,
    );
    expect(set2.setFirstServer).toBe("home");
    expect(set2.servingSide).toBe("home");
  });

  it("vereist twee punten verschil", () => {
    expect(volleyballSetWinner(25, 24, 25)).toBeNull();
    expect(volleyballSetWinner(26, 24, 25)).toBe("home");
    expect(volleyballSetWinner(15, 13, 15)).toBe("home");
    expect(volleyballSetWinner(15, 14, 15)).toBeNull();
  });

  it("sluit de wedstrijd bij 3 gewonnen sets en weigert daarna punten", () => {
    const live: VolleyballLive = {
      ...base,
      currentPeriod: 4,
      homeScore: 24,
      awayScore: 20,
      homeSets: 2,
      awaySets: 1,
      setHistory: [
        { home: 25, away: 20 },
        { home: 25, away: 18 },
        { home: 20, away: 25 },
      ],
    };
    const next = applyVolleyballScoreDelta(live, "home", 1);
    expect(next.matchOver).toBe(true);
    expect(next.status).toBe("FULL_TIME");
    expect(next.homeSets).toBe(3);

    const extra = applyVolleyballScoreDelta(nextLive(next), "away", 1);
    expect(extra.rejected).toBe("match_over");
    expect(extra.awayScore).toBe(0);

    const reopened = applyVolleyballScoreDelta(nextLive(next), "home", -1);
    expect(reopened.matchOver).toBe(false);
    expect(reopened.homeSets).toBe(2);
    expect(reopened.homeScore).toBe(24);
  });

  it("speelt best-of-3 met 21 punten wanneer het formaat dat zegt", () => {
    const format = normalizeVolleyballFormat({ setsToWin: 2, pointsToWinSet: 21, pointsToWinDecider: 15 });
    expect(volleyballTarget(1, format)).toBe(21);
    expect(volleyballTarget(3, format)).toBe(15);
    const set1 = applyVolleyballScoreDelta({ ...base, homeScore: 20, awayScore: 18 }, "home", 1, { format });
    expect(set1.setJustWon).toBe(true);
    const set2 = applyVolleyballScoreDelta(
      { ...nextLive(set1), homeScore: 20, awayScore: 19 },
      "home",
      1,
      { format },
    );
    expect(set2.matchOver).toBe(true);
  });

  it("zet de technische time-out alleen als die aan staat", () => {
    const off = applyVolleyballScoreDelta({ ...base, homeScore: 7, awayScore: 4 }, "home", 1);
    expect(off.technicalTimeout).toBe(false);
    expect(off.status).toBe("FIRST_HALF");

    const on = applyVolleyballScoreDelta({ ...base, homeScore: 7, awayScore: 4 }, "home", 1, {
      technicalTimeoutsEnabled: true,
    });
    expect(on.technicalTimeout).toBe(true);
    // Geen HALF_TIME-hack meer: de status blijft live, de time-outklok regelt de pauze.
    expect(on.status).toBe("FIRST_HALF");

    const deciding = applyVolleyballScoreDelta(
      { ...base, currentPeriod: 5, homeScore: 7, awayScore: 4 },
      "home",
      1,
      { technicalTimeoutsEnabled: true },
    );
    expect(deciding.technicalTimeout).toBe(false);
  });

  it("maakt een setwinst ongedaan vanaf 0–0 met −1 en herstelt de eerste server", () => {
    const afterSet = applyVolleyballScoreDelta({ ...base, homeScore: 24, awayScore: 20 }, "home", 1);
    const undone = applyVolleyballScoreDelta(nextLive(afterSet), "home", -1);
    expect(undone.homeSets).toBe(0);
    expect(undone.currentPeriod).toBe(1);
    expect(undone.homeScore).toBe(24);
    expect(undone.awayScore).toBe(20);
    expect(undone.setHistory).toEqual([]);
    expect(undone.setFirstServer).toBe("home");
    expect(undone.servingSide).toBe("home");
  });

  it("leest setHistory JSON (met en zonder eerste server)", () => {
    expect(parseSetHistory('[{"home":25,"away":21}]')).toEqual([{ home: 25, away: 21 }]);
    expect(parseSetHistory('[{"home":25,"away":21,"firstServer":"away"}]')).toEqual([
      { home: 25, away: 21, firstServer: "away" },
    ]);
    expect(parseSetHistory(null)).toEqual([]);
  });
});
