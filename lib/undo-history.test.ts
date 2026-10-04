import { describe, expect, it } from "vitest";
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  historyCommitGesture,
  historyOf,
  historyPush,
  historyRedo,
  historyReplace,
  historyUndo,
} from "./undo-history";

describe("undo history", () => {
  it("maakt stappen ongedaan en zet ze terug", () => {
    let h = historyOf("a");
    h = historyPush(h, "b");
    h = historyPush(h, "c");
    expect(h.present).toBe("c");
    expect(canUndo(h)).toBe(true);

    h = historyUndo(h);
    expect(h.present).toBe("b");
    h = historyUndo(h);
    expect(h.present).toBe("a");
    expect(canUndo(h)).toBe(false);
    expect(historyUndo(h)).toBe(h);

    h = historyRedo(h);
    h = historyRedo(h);
    expect(h.present).toBe("c");
    expect(canRedo(h)).toBe(false);
    expect(historyRedo(h)).toBe(h);
  });

  it("gooit 'opnieuw' weg zodra er na een undo iets nieuws gebeurt", () => {
    let h = historyPush(historyPush(historyOf(1), 2), 3);
    h = historyUndo(h);
    h = historyPush(h, 9);
    expect(h.present).toBe(9);
    expect(canRedo(h)).toBe(false);
    expect(historyUndo(h).present).toBe(2);
  });

  it("telt een heel sleepgebaar als één stap", () => {
    const start = { x: 10 };
    let h = historyOf(start);
    for (const x of [11, 12, 13, 14]) h = historyReplace(h, { x });
    expect(h.past).toHaveLength(0);
    h = historyCommitGesture(h, start);
    expect(h.past).toEqual([start]);
    expect(historyUndo(h).present).toBe(start);
  });

  it("maakt geen stap als er niets veranderde", () => {
    const start = { x: 10 };
    const h = historyOf(start);
    expect(historyPush(h, start)).toBe(h);
    expect(historyReplace(h, start)).toBe(h);
    expect(historyCommitGesture(h, start)).toBe(h);
  });

  it("bewaart hoogstens de laatste stappen", () => {
    let h = historyOf(0);
    for (let i = 1; i <= HISTORY_LIMIT + 25; i++) h = historyPush(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toBe(25);
  });
});
