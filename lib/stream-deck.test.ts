import { describe, expect, it } from "vitest";
import {
  actionFromKind,
  goalPrepareStartedVisual,
  mergeStreamDeckSlots,
  parseStreamDeckPath,
  runScoreDeckAction,
  STREAM_DECK_BINDINGS,
} from "./stream-deck";

describe("parseStreamDeckPath", () => {
  it("leest bron 1–8", () => {
    expect(parseStreamDeckPath("/input/1")).toEqual({ id: "input", index: 1 });
    expect(parseStreamDeckPath("/input/8/")).toEqual({ id: "input", index: 8 });
    expect(parseStreamDeckPath("/input/9")).toBeNull();
  });

  it("leest stream, timer, score en blackout", () => {
    expect(parseStreamDeckPath("/stream/toggle")).toEqual({ id: "stream", mode: "toggle" });
    expect(parseStreamDeckPath("/record/toggle")).toEqual({ id: "record", mode: "toggle" });
    expect(parseStreamDeckPath("/cut")).toEqual({ id: "cut" });
    expect(parseStreamDeckPath("/preview/2")).toEqual({ id: "preview", index: 2 });
    expect(parseStreamDeckPath("/key/3")).toEqual({ id: "key", index: 3 });
    expect(parseStreamDeckPath("/key/25")).toBeNull();
    expect(parseStreamDeckPath("/timer/pause")).toEqual({ id: "timer", mode: "pause" });
    expect(parseStreamDeckPath("/score/away/down")).toEqual({ id: "score", side: "away", delta: -1 });
    expect(parseStreamDeckPath("/blackout")).toEqual({ id: "blackout" });
  });

  it("heeft een hotkey per standaardbinding", () => {
    expect(STREAM_DECK_BINDINGS.every((item) => item.accelerator && item.path)).toBe(true);
  });

  it("bewaart alleen geldige eigen knoppen", () => {
    const slots = mergeStreamDeckSlots([
      { id: "dk1", title: "Mijn CUT", action: actionFromKind("cut") },
      { id: "bad", title: "", action: { id: "key", index: 1 } },
      { title: "x".repeat(40), action: { id: "input", index: 2 } },
    ]);
    expect(slots).toHaveLength(2);
    expect(slots[0]?.title).toBe("Mijn CUT");
    expect(slots[1]?.action).toEqual({ id: "input", index: 2 });
    expect(slots[1]?.title.length).toBeLessThanOrEqual(16);
  });
});

describe("runScoreDeckAction", () => {
  it("start thuis +1 als goal-intro, niet als trigger zonder schutter", async () => {
    const cmds: unknown[] = [];
    await runScoreDeckAction({ id: "score", side: "home", delta: 1 }, async (cmd) => {
      cmds.push(cmd);
      return { ok: true, result: { visual: true } };
    });
    expect(cmds).toEqual([{ type: "goal:prepare", side: "home" }]);
  });

  it("telt thuis +1 alleen als score als de visual uit staat", async () => {
    const cmds: unknown[] = [];
    await runScoreDeckAction({ id: "score", side: "home", delta: 1 }, async (cmd) => {
      cmds.push(cmd);
      return { ok: true, result: { visual: false } };
    });
    expect(cmds).toEqual([
      { type: "goal:prepare", side: "home" },
      { type: "score:adjust", side: "home", delta: 1 },
    ]);
  });

  it("telt uit +1 alleen als score, zonder visual", async () => {
    const cmds: unknown[] = [];
    await runScoreDeckAction({ id: "score", side: "away", delta: 1 }, async (cmd) => {
      cmds.push(cmd);
      return { ok: true };
    });
    expect(cmds).toEqual([{ type: "score:adjust", side: "away", delta: 1 }]);
  });

  it("leest of prepare de intro startte", () => {
    expect(goalPrepareStartedVisual({ visual: true })).toBe(true);
    expect(goalPrepareStartedVisual({ visual: false })).toBe(false);
    expect(goalPrepareStartedVisual(undefined)).toBe(false);
  });
});
