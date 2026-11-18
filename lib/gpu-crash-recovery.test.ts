import { describe, expect, it } from "vitest";
import { nextGpuCrashStep } from "./gpu-crash-recovery";

const base = {
  sponsorVideoContext: true,
  softwareDecodeThisSession: false,
  nowMs: 1_000_000,
  lastCrashAtMs: 0,
  streak: 0,
};

describe("nextGpuCrashStep", () => {
  it("herlaadt bij de eerste crash en zet software-decode klaar", () => {
    expect(nextGpuCrashStep(base)).toEqual({
      action: "reload-and-flag",
      streak: 1,
      lastCrashAtMs: 1_000_000,
    });
  });

  it("herstart bij een tweede crash binnen twee minuten", () => {
    const first = nextGpuCrashStep(base);
    const second = nextGpuCrashStep({ ...base, ...first, nowMs: 1_030_000 });
    expect(second.action).toBe("relaunch");
    expect(second.streak).toBe(2);
  });

  it("begint opnieuw te tellen als de vorige crash lang geleden is", () => {
    const first = nextGpuCrashStep(base);
    const later = nextGpuCrashStep({ ...base, ...first, nowMs: 1_000_000 + 121_000 });
    expect(later.action).toBe("reload-and-flag");
    expect(later.streak).toBe(1);
  });

  it("herstart niet als deze sessie al software-decode gebruikt", () => {
    const step = nextGpuCrashStep({ ...base, softwareDecodeThisSession: true, streak: 1, lastCrashAtMs: 999_000 });
    expect(step).toEqual({ action: "reload", streak: 1, lastCrashAtMs: 999_000 });
  });

  it("herlaadt alleen als er geen sponsorvideo speelde", () => {
    expect(nextGpuCrashStep({ ...base, sponsorVideoContext: false }).action).toBe("reload");
  });
});
