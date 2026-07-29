import { describe, expect, it } from "vitest";
import { CommandSchema } from "./commands";

describe("CommandSchema", () => {
  it("accepteert timer:start", () => {
    const r = CommandSchema.safeParse({ type: "timer:start" });
    expect(r.success).toBe(true);
  });

  it("accepteert score:set", () => {
    const r = CommandSchema.safeParse({ type: "score:set", homeScore: 1, awayScore: 2 });
    expect(r.success).toBe(true);
  });

  it("accepteert multisport- en shotclockcommando's", () => {
    expect(CommandSchema.safeParse({ type: "sport:setPeriod", period: 4 }).success).toBe(true);
    expect(
      CommandSchema.safeParse({
        type: "sport:statAdjust",
        stat: "timeout",
        side: "home",
        delta: 1,
      }).success,
    ).toBe(true);
    expect(
      CommandSchema.safeParse({ type: "shotclock:reset", seconds: 14 }).success,
    ).toBe(true);
    expect(
      CommandSchema.safeParse({ type: "shotclock:reset", seconds: 120 }).success,
    ).toBe(false);
  });

  it("wijst onbekend type af", () => {
    const r = CommandSchema.safeParse({ type: "nope" });
    expect(r.success).toBe(false);
  });
});
