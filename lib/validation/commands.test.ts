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

  it("accepteert volleybal-serving, hervatten, time-outklok en hockey-straffen", () => {
    expect(CommandSchema.safeParse({ type: "sport:setServing", side: "away" }).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "sport:resumePlay" }).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "timeout:start", side: "home" }).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "timeout:start", side: "technical", seconds: 60 }).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "timeout:start", side: "home", seconds: 2 }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "timeout:clear" }).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "penalty:start", side: "home", seconds: 120 }).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "penalty:start", side: "home", seconds: 1200 }).success).toBe(false);
    expect(
      CommandSchema.safeParse({ type: "card:trigger", teamId: "t", playerId: "p", color: "GREEN" }).success,
    ).toBe(true);
  });

  it("begrenst klok- en scorecorrecties", () => {
    expect(CommandSchema.safeParse({ type: "timer:adjust", deltaSec: 60 }).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "timer:adjust", deltaSec: 99999 }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "score:adjust", side: "home", delta: 3 }).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "score:adjust", side: "home", delta: 500 }).success).toBe(false);
  });

  it("wijst onbekend type af", () => {
    const r = CommandSchema.safeParse({ type: "nope" });
    expect(r.success).toBe(false);
  });
});
