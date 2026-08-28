import { describe, expect, it } from "vitest";
import {
  resolveVideoExpectedPlaySec,
  sponsorTelemetryActiveClipElapsedSec,
} from "./sponsor-telemetry";

describe("resolveVideoExpectedPlaySec", () => {
  it("gebruikt browserduur wanneer die plausibel is", () => {
    expect(
      resolveVideoExpectedPlaySec({ type: "VIDEO", durationSec: 10 }, 10, 45),
    ).toBe(45);
  });

  it("negeert extreem lange container-metadata", () => {
    expect(
      resolveVideoExpectedPlaySec({ type: "VIDEO", durationSec: 15 }, 15, 3600),
    ).toBe(15);
  });
});

describe("sponsorTelemetryActiveClipElapsedSec", () => {
  it("volgt startedAtMs-anker tijdens afspelen", () => {
    const now = 10_000;
    const ac = {
      sponsorId: "s1",
      mediaId: "m1",
      startedAtMs: now - 12_500,
      expectedPlaySec: 30,
      clipSessionId: "c1",
      playbackPositionMs: 0,
      paused: false,
    };
    expect(sponsorTelemetryActiveClipElapsedSec(ac, now)).toBeCloseTo(12.5);
  });
});
