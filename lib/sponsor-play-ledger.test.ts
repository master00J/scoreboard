import { describe, expect, it } from "vitest";
import {
  applyVisibleProgress,
  createPlaySessionState,
  ledgerSecondsFromRows,
  playRowActualMs,
  playSourceCounts,
  recoveredPlayRowState,
  shouldPersistPlayProgress,
  type PlayLogLedgerRow,
} from "./sponsor-play-ledger";

function row(over: Partial<PlayLogLedgerRow>): PlayLogLedgerRow {
  return {
    clipSessionId: "s",
    matchId: "m1",
    segmentKey: "m1:FIRST_HALF",
    sponsorId: "sp1",
    ledgerSponsorId: "sp1",
    actualSec: 0,
    actualMs: 0,
    counted: true,
    ...over,
  };
}

describe("ledgerSecondsFromRows (rebuild after restart)", () => {
  it("sums unrounded seconds per sponsor for the phase, including an interrupted running play", () => {
    const rows = [
      row({ clipSessionId: "a", actualMs: 8_000 }),
      row({ clipSessionId: "b", actualMs: 3_400 }), // liep nog toen de app herstartte
      row({ clipSessionId: "c", sponsorId: null, ledgerSponsorId: "club:x", actualMs: 5_000 }),
      row({ clipSessionId: "d", segmentKey: "m1:prematch", actualMs: 9_000 }),
      row({ clipSessionId: "e", matchId: "m2", segmentKey: "m2:FIRST_HALF", actualMs: 9_000 }),
    ];
    expect(ledgerSecondsFromRows(rows, { matchId: "m1", segmentKey: "m1:FIRST_HALF" })).toEqual({
      sp1: 11.4,
      "club:x": 5,
    });
  });

  it("skips plays that are still counted in memory and plays that do not count", () => {
    const rows = [
      row({ clipSessionId: "a", actualMs: 8_000 }),
      row({ clipSessionId: "live", actualMs: 2_000 }),
      row({ clipSessionId: "manual", actualMs: 6_000, counted: false }),
    ];
    expect(
      ledgerSecondsFromRows(rows, {
        matchId: "m1",
        segmentKey: "m1:FIRST_HALF",
        skipSessionIds: new Set(["live"]),
      }),
    ).toEqual({ sp1: 8 });
  });

  it("falls back to whole seconds for rows from before the ms column", () => {
    expect(
      ledgerSecondsFromRows([row({ actualSec: 15, actualMs: 0 })], {
        matchId: "m1",
        segmentKey: "m1:FIRST_HALF",
      }),
    ).toEqual({ sp1: 15 });
  });
});

describe("recoveredPlayRowState", () => {
  it("keeps a running play that was visible as interrupted and drops one that never showed", () => {
    expect(recoveredPlayRowState({ state: "running", actualMs: 4_200 })).toBe("interrupted");
    expect(recoveredPlayRowState({ state: "running", actualMs: 0 })).toBe("delete");
    expect(recoveredPlayRowState({ state: "done", actualMs: 0 })).toBe("keep");
  });
});

describe("applyVisibleProgress (two plays reporting at once)", () => {
  it("the higher layer on screen counts; the covered rotation does not", () => {
    const rotation = createPlaySessionState({ clipSessionId: "r", source: "rotation", counted: true });
    const cue = createPlaySessionState({ clipSessionId: "c", source: "cue", counted: true });
    const sessions = [rotation, cue];
    applyVisibleProgress(sessions, rotation, 2_000, 2_000);
    // Cue komt erboven; de rotatie meldt (door een fout) nog door.
    applyVisibleProgress(sessions, cue, 500, 2_500);
    applyVisibleProgress(sessions, rotation, 2_500, 2_500);
    applyVisibleProgress(sessions, cue, 1_000, 3_000);
    applyVisibleProgress(sessions, rotation, 3_000, 3_000);
    expect(rotation.countedMs).toBe(2_000);
    expect(cue.countedMs).toBe(1_000);
  });

  it("the lower layer counts again once the higher one is gone or paused", () => {
    const rotation = createPlaySessionState({ clipSessionId: "r", source: "rotation", counted: true });
    const manual = createPlaySessionState({ clipSessionId: "m", source: "manual", counted: true });
    const sessions = [rotation, manual];
    applyVisibleProgress(sessions, manual, 1_000, 1_000);
    applyVisibleProgress(sessions, rotation, 1_000, 1_200); // bedekt
    manual.paused = true;
    applyVisibleProgress(sessions, rotation, 2_000, 2_000);
    applyVisibleProgress(sessions, rotation, 3_000, 5_000);
    expect(rotation.countedMs).toBe(2_000);
  });

  it("counts the very first half-second after the overlay has ended", () => {
    const rotation = createPlaySessionState({ clipSessionId: "r", source: "rotation", counted: true });
    const cue = createPlaySessionState({ clipSessionId: "c", source: "cue", counted: true });
    applyVisibleProgress([cue, rotation], cue, 2000, 2000);
    cue.endedAtMs = 2000;
    expect(applyVisibleProgress([cue, rotation], rotation, 500, 2500)).toBe(500);
  });

  it("a manual play is kept but does not count when the setting is off", () => {
    expect(playSourceCounts("manual", false)).toBe(false);
    expect(playSourceCounts("manual", true)).toBe(true);
    expect(playSourceCounts("rotation", false)).toBe(true);
    const manual = createPlaySessionState({ clipSessionId: "m", source: "manual", counted: false });
    applyVisibleProgress([manual], manual, 4_000, 4_000);
    expect(manual.countedMs).toBe(0);
    expect(playRowActualMs(manual)).toBe(4_000);
  });

  it("never counts backwards or the same reading twice", () => {
    const s = createPlaySessionState({ clipSessionId: "r", source: "rotation", counted: true });
    expect(applyVisibleProgress([s], s, 1_000, 1_000)).toBe(1_000);
    expect(applyVisibleProgress([s], s, 1_000, 1_100)).toBe(0);
    expect(applyVisibleProgress([s], s, 400, 1_200)).toBe(0);
    expect(s.countedMs).toBe(1_000);
  });
});

describe("shouldPersistPlayProgress", () => {
  it("writes progress at most every few seconds", () => {
    expect(shouldPersistPlayProgress(0, 1_000)).toBe(false);
    expect(shouldPersistPlayProgress(0, 3_000)).toBe(true);
  });
});
