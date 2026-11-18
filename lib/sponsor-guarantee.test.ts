import { describe, expect, it } from "vitest";
import {
  bookingTotalsBySponsor,
  carryInForSegment,
  computeShortfall,
  cueGuarantee,
  guaranteeSegmentOf,
  isCompletePlay,
  liveGuaranteeView,
  parseSponsorGuarantee,
  phaseRemainingSec,
  serializeSponsorGuarantee,
  sponsorWithCatchUp,
} from "./sponsor-guarantee";

describe("sponsor guarantee settings", () => {
  it("defaults to cumulative seconds without catch-up, and stores nothing for the default", () => {
    expect(parseSponsorGuarantee(null)).toEqual({ kind: "seconds", catchUpIn: [] });
    expect(serializeSponsorGuarantee({ kind: "seconds", catchUpIn: [] })).toBeNull();
  });

  it("round-trips full plays and catch-up phases in match order", () => {
    const raw = serializeSponsorGuarantee({ kind: "plays", catchUpIn: ["postmatch", "halftime"] });
    expect(parseSponsorGuarantee(raw)).toEqual({ kind: "plays", catchUpIn: ["halftime", "postmatch"] });
    expect(parseSponsorGuarantee('{"kind":"x","catchUpIn":["bogus","halftime"]}')).toEqual({
      kind: "seconds",
      catchUpIn: ["halftime"],
    });
  });
});

describe("cueGuarantee", () => {
  it("keeps the old behaviour without an explicit choice", () => {
    expect(cueGuarantee({ triggerSec: 600, endSec: 660 })).toBe("window");
    expect(cueGuarantee({ triggerSec: 600, endSec: null })).toBe("none");
  });
  it("a one-off cue can owe one full play", () => {
    expect(cueGuarantee({ triggerSec: 600, endSec: null, guarantee: "fullPlay" })).toBe("fullPlay");
    // Een venster zonder eindtijd bestaat niet.
    expect(cueGuarantee({ triggerSec: 600, endSec: null, guarantee: "window" })).toBe("none");
  });
});

describe("computeShortfall", () => {
  const seconds = { kind: "seconds" as const, catchUpIn: [] };

  it("leaves a shortfall open without catch-up phases, and extra play elsewhere does not fill it", () => {
    const r = computeShortfall(
      {
        FIRST_HALF: { bookedSec: 60, deliveredSec: 45 },
        SECOND_HALF: { bookedSec: 60, deliveredSec: 90 },
      },
      seconds,
    );
    expect(r.bySegment.FIRST_HALF?.shortSec).toBe(15);
    expect(r.bySegment.SECOND_HALF?.shortSec).toBe(0);
    expect(r.openSec).toBe(15);
  });

  it("catches up a first-half shortfall at halftime when the booking allows it", () => {
    const g = { kind: "seconds" as const, catchUpIn: ["halftime" as const] };
    const ledger = {
      FIRST_HALF: { bookedSec: 60, deliveredSec: 40 },
      halftime: { bookedSec: 30, deliveredSec: 0 },
    };
    expect(carryInForSegment(ledger, g, "halftime")).toBe(20);
    expect(carryInForSegment(ledger, g, "SECOND_HALF")).toBe(0);
    const done = computeShortfall({ ...ledger, halftime: { bookedSec: 30, deliveredSec: 50 } }, g);
    expect(done.bySegment.halftime).toEqual({ bookedSec: 30, deliveredSec: 50, carryInSec: 20, shortSec: 0 });
    expect(done.openSec).toBe(0);
  });

  it("carries what a catch-up phase could not make up to the next catch-up phase", () => {
    const g = { kind: "seconds" as const, catchUpIn: ["halftime" as const, "postmatch" as const] };
    const r = computeShortfall(
      {
        FIRST_HALF: { bookedSec: 60, deliveredSec: 30 },
        halftime: { bookedSec: 30, deliveredSec: 40 },
        SECOND_HALF: { bookedSec: 60, deliveredSec: 50 },
        postmatch: { bookedSec: 0, deliveredSec: 15 },
      },
      g,
    );
    // Rust: 30 + 30 ingehaald nodig, 40 gespeeld → 20 open; 2e helft +10; na de match 15 ingehaald.
    expect(r.bySegment.halftime?.shortSec).toBe(20);
    expect(r.bySegment.postmatch?.carryInSec).toBe(30);
    expect(r.openSec).toBe(15);
  });

  it("stops at the running phase: later phases have not started", () => {
    const r = computeShortfall(
      { FIRST_HALF: { bookedSec: 60, deliveredSec: 10 }, SECOND_HALF: { bookedSec: 60, deliveredSec: 0 } },
      seconds,
      "FIRST_HALF",
    );
    expect(r.openSec).toBe(50);
    expect(r.bySegment.SECOND_HALF).toBeUndefined();
  });
});

describe("liveGuaranteeView", () => {
  it("shows seconds still owed against seconds still available after the reserve", () => {
    const view = liveGuaranteeView({
      sponsors: [
        { id: "a", name: "A", bookedSec: 120, carryInSec: 0, deliveredSec: 30 },
        { id: "b", name: "B", bookedSec: 60, carryInSec: 20, deliveredSec: 80 },
      ],
      phaseRemainingSec: 150,
      reserveSec: 60,
    });
    expect(view.availableSec).toBe(90);
    expect(view.rows.map((r) => [r.id, r.owedSec, r.atRisk])).toEqual([
      ["a", 90, false],
      ["b", 0, false],
    ]);
    expect(view.overbooked).toBe(false);
  });

  it("flags a sponsor and the phase when there is not enough time left", () => {
    const view = liveGuaranteeView({
      sponsors: [
        { id: "a", name: "A", bookedSec: 120, carryInSec: 0, deliveredSec: 0 },
        { id: "b", name: "B", bookedSec: 60, carryInSec: 0, deliveredSec: 0 },
      ],
      phaseRemainingSec: 200,
      reserveSec: 60,
    });
    expect(view.rows[0]!.atRisk).toBe(false);
    expect(view.overbooked).toBe(true);
    expect(
      liveGuaranteeView({ sponsors: view.rows, phaseRemainingSec: 100, reserveSec: 60 }).rows[0]!.atRisk,
    ).toBe(true);
  });

  it("has no availability without a fixed phase end", () => {
    const view = liveGuaranteeView({
      sponsors: [{ id: "a", name: "A", bookedSec: 60, carryInSec: 0, deliveredSec: 0 }],
      phaseRemainingSec: null,
      reserveSec: 60,
    });
    expect(view.availableSec).toBeNull();
    expect(view.rows[0]!.atRisk).toBe(false);
  });
});

describe("phaseRemainingSec", () => {
  const base = { halfDurationSec: 2700, halfBreakSec: 900, nowMs: 1_000_000 };
  it("counts down each half on the match clock", () => {
    expect(phaseRemainingSec({ ...base, status: "FIRST_HALF", elapsedSec: 2000 })).toBe(700);
    expect(phaseRemainingSec({ ...base, status: "SECOND_HALF", elapsedSec: 5000 })).toBe(400);
    expect(phaseRemainingSec({ ...base, status: "SECOND_HALF", elapsedSec: 5500 })).toBe(0);
  });
  it("uses the break and kickoff when known", () => {
    expect(phaseRemainingSec({ ...base, status: "HALF_TIME", elapsedSec: 2700, halftimeElapsedSec: 300 })).toBe(600);
    expect(
      phaseRemainingSec({ ...base, status: "PREMATCH", elapsedSec: 0, kickoffAtMs: base.nowMs + 120_000 }),
    ).toBe(120);
    expect(phaseRemainingSec({ ...base, status: "POST_MATCH", elapsedSec: 5400 })).toBeNull();
  });
});

describe("isCompletePlay", () => {
  it("uses the measured milliseconds and excludes unfinished plays", () => {
    expect(isCompletePlay({ expectedSec: 8, actualSec: 7, actualMs: 7_400 })).toBe(false);
    expect(isCompletePlay({ expectedSec: 8, actualSec: 8, actualMs: 7_968, state: "done" })).toBe(true);
    expect(isCompletePlay({ expectedSec: 8, actualSec: 8, actualMs: 7_968, state: "interrupted" })).toBe(false);
    expect(isCompletePlay({ expectedSec: 8, actualSec: 1, actualMs: 1_210 })).toBe(false);
  });

  it("counts a clip whose stored duration was rounded up", () => {
    // 29,6 s clip, durationSec opgeslagen als 30.
    expect(isCompletePlay({ expectedSec: 30, actualSec: 30, actualMs: 29_580, state: "done" })).toBe(true);
    expect(isCompletePlay({ expectedSec: 30, actualSec: 29, actualMs: 29_400, state: "done" })).toBe(false);
  });
});

describe("guaranteeSegmentOf", () => {
  it("reads the phase from a segment key", () => {
    expect(guaranteeSegmentOf("m1:FIRST_HALF")).toBe("FIRST_HALF");
    expect(guaranteeSegmentOf("m1:halftime")).toBe("halftime");
    expect(guaranteeSegmentOf("nonsense")).toBeNull();
  });
});

describe("bookingTotalsBySponsor (report)", () => {
  it("adds booked seconds and the open shortfall per sponsor over matches", () => {
    const totals = bookingTotalsBySponsor(
      [
        { sponsorId: "a", matchId: "m1", segmentKey: "m1:FIRST_HALF", bookedSec: 60, guaranteeJson: null },
        { sponsorId: "a", matchId: "m1", segmentKey: "m1:SECOND_HALF", bookedSec: 60, guaranteeJson: null },
        { sponsorId: "a", matchId: "m2", segmentKey: "m2:FIRST_HALF", bookedSec: 60, guaranteeJson: null },
      ],
      [
        { sponsorId: "a", matchId: "m1", segmentKey: "m1:FIRST_HALF", expectedSec: 10, actualSec: 50, actualMs: 50_000 },
        { sponsorId: "a", matchId: "m1", segmentKey: "m1:SECOND_HALF", expectedSec: 10, actualSec: 60, actualMs: 60_000 },
        { sponsorId: "a", matchId: "m2", segmentKey: "m2:FIRST_HALF", expectedSec: 10, actualSec: 60, actualMs: 60_000 },
        // Telt niet (handmatig, instelling uit).
        { sponsorId: "a", matchId: "m1", segmentKey: "m1:FIRST_HALF", expectedSec: 10, actualSec: 10, actualMs: 10_000, counted: false },
      ],
    );
    expect(totals.get("a")).toEqual({ bookedSec: 180, shortfallSec: 10 });
  });

  it("with full plays owed, an interrupted clip does not count", () => {
    const totals = bookingTotalsBySponsor(
      [
        {
          sponsorId: "a",
          matchId: "m1",
          segmentKey: "m1:FIRST_HALF",
          bookedSec: 16,
          guaranteeJson: '{"kind":"plays","catchUpIn":[]}',
        },
      ],
      [
        { sponsorId: "a", matchId: "m1", segmentKey: "m1:FIRST_HALF", expectedSec: 8, actualSec: 8, actualMs: 8_000 },
        { sponsorId: "a", matchId: "m1", segmentKey: "m1:FIRST_HALF", expectedSec: 8, actualSec: 5, actualMs: 5_000 },
      ],
    );
    expect(totals.get("a")).toEqual({ bookedSec: 16, shortfallSec: 8 });
  });
});

describe("sponsorWithCatchUp", () => {
  const sponsor = {
    prematchSeconds: 30,
    matchSeconds: 120,
    matchFirstHalfSeconds: 60,
    matchSecondHalfSeconds: 60,
    halftimeSeconds: 30,
    postmatchSeconds: 0,
  };
  it("adds the carry to the budget the running phase reads", () => {
    expect(sponsorWithCatchUp(sponsor, 14.2, "HALF_TIME").halftimeSeconds).toBe(45);
    const h2 = sponsorWithCatchUp(sponsor, 20, "SECOND_HALF");
    expect(h2.matchSecondHalfSeconds).toBe(80);
    expect(h2.matchFirstHalfSeconds).toBe(60);
    expect(sponsorWithCatchUp(sponsor, 10, "POST_MATCH").postmatchSeconds).toBe(10);
  });
  it("leaves the sponsor untouched without carry", () => {
    expect(sponsorWithCatchUp(sponsor, 0, "HALF_TIME")).toBe(sponsor);
  });
});
