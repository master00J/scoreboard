import { describe, expect, it } from "vitest";
import {
  bitrateAdvice,
  bitrateOptionsKbps,
  bitrateVerdict,
  TWITCH_MAX_KBPS,
} from "./livestream-bitrate";

describe("bitrateAdvice", () => {
  it("vraagt meer bits voor 1080p60 dan voor 1080p30", () => {
    const p60 = bitrateAdvice("1920x1080", 60);
    const p30 = bitrateAdvice("1920x1080", 30);
    expect(p60.recommendedKbps).toBeGreaterThan(p30.recommendedKbps);
    expect(p30.recommendedKbps).toBe(8000);
    expect(p60.recommendedKbps).toBe(12000);
  });

  it("vraagt minder voor 720p", () => {
    expect(bitrateAdvice("1280x720", 30).recommendedKbps).toBeLessThan(
      bitrateAdvice("1920x1080", 30).recommendedKbps,
    );
  });

  it("kapt af op de Twitch-limiet", () => {
    const advice = bitrateAdvice("1920x1080", 60, "twitch");
    expect(advice.recommendedKbps).toBeLessThanOrEqual(TWITCH_MAX_KBPS);
    expect(advice.maximumKbps).toBeLessThanOrEqual(TWITCH_MAX_KBPS);
  });
});

describe("bitrateVerdict", () => {
  it("markeert 4500 kbps op 1080p60 als te laag", () => {
    expect(bitrateVerdict(4500, "1920x1080", 60)).toBe("low");
  });

  it("keurt de aanbevolen waarde goed", () => {
    const advice = bitrateAdvice("1920x1080", 30);
    expect(bitrateVerdict(advice.recommendedKbps, "1920x1080", 30)).toBe("ok");
  });

  it("markeert zinloos hoge waarden", () => {
    expect(bitrateVerdict(20000, "1280x720", 30)).toBe("high");
  });
});

describe("bitrateOptionsKbps", () => {
  it("bevat altijd de aanbevolen waarde en blijft binnen het maximum", () => {
    const advice = bitrateAdvice("1920x1080", 60);
    const options = bitrateOptionsKbps("1920x1080", 60);
    expect(options).toContain(advice.recommendedKbps);
    expect(Math.max(...options)).toBeLessThanOrEqual(advice.maximumKbps);
    expect([...options].sort((a, b) => a - b)).toEqual(options);
  });

  it("biedt op Twitch geen onbruikbaar hoge waarden aan", () => {
    for (const kbps of bitrateOptionsKbps("1920x1080", 60, "twitch")) {
      expect(kbps).toBeLessThanOrEqual(TWITCH_MAX_KBPS);
    }
  });
});
