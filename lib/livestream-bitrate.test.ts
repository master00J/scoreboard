import { describe, expect, it } from "vitest";
import {
  bitrateAdvice,
  bitrateOptionsKbps,
  bitrateVerdict,
  clampUploadMbps,
  effectiveBitrateKbps,
  FACEBOOK_MAX_KBPS,
  keyframeIntervalFrames,
  streamFallingBehind,
  streamFormatPlan,
  totalUploadKbps,
  TWITCH_MAX_KBPS,
  UPLOAD_FLOOR_KBPS,
  uploadBudgetKbps,
} from "./livestream-bitrate";
import { DEFAULT_LIVESTREAM_SETTINGS, mergeLivestreamSettings, STREAM_AUDIO_BITRATE_K } from "./livestream";

describe("upload", () => {
  it("leest een ingevulde snelheid met komma of punt, en 0 als hij onbekend is", () => {
    expect(clampUploadMbps("6,85")).toBe(6.85);
    expect(clampUploadMbps(" 6.85 ")).toBe(6.85);
    expect(clampUploadMbps("")).toBe(0);
    expect(clampUploadMbps("abc")).toBe(0);
    expect(clampUploadMbps(-3)).toBe(0);
    expect(clampUploadMbps(50000)).toBe(1000);
  });

  it("laat de bitrate ongemoeid zolang de upload onbekend is", () => {
    expect(uploadBudgetKbps(0, 2, STREAM_AUDIO_BITRATE_K)).toBeNull();
    expect(effectiveBitrateKbps(8000, null)).toBe(8000);
    expect(mergeLivestreamSettings({}).uploadMbps).toBe(0);
  });

  it("deelt de upload over de bestemmingen: Twitch + Facebook op 6,85 Mbps past niet op 8000 kbps", () => {
    const single = uploadBudgetKbps(6.85, 1, STREAM_AUDIO_BITRATE_K)!;
    const dual = uploadBudgetKbps(6.85, 2, STREAM_AUDIO_BITRATE_K)!;
    expect(single).toBe(4900);
    expect(dual).toBe(2400);
    expect(effectiveBitrateKbps(8000, dual)).toBe(2400);
    // Wat er dan echt over de lijn gaat, blijft onder de gemeten upload.
    expect(totalUploadKbps(effectiveBitrateKbps(8000, dual), 2, STREAM_AUDIO_BITRATE_K)).toBeLessThan(6850);
    // Vroeger: 2 × (8000 + 160) = 16,3 Mbps op een lijn van 6,85.
    expect(totalUploadKbps(8000, 2, STREAM_AUDIO_BITRATE_K)).toBe(16320);
  });

  it("verhoogt nooit een lagere keuze en zakt niet onder de bodem", () => {
    expect(effectiveBitrateKbps(3000, 4900)).toBe(3000);
    expect(effectiveBitrateKbps(6000, 100)).toBe(UPLOAD_FLOOR_KBPS);
  });

  it("onthoudt de upload in de instellingen", () => {
    expect(mergeLivestreamSettings({ uploadMbps: 6.85 }).uploadMbps).toBe(6.85);
  });
});

describe("streamFormatPlan (wizard en eenvoudige stand)", () => {
  it("kiest bij Twitch + Facebook op 6,85 Mbps 720p30 op 2400 kbps, en zegt dat het krap is", () => {
    expect(streamFormatPlan("auto", 6.85, ["twitch", "facebook"], 160)).toEqual({
      quality: "720p30",
      resolution: "1280x720",
      fps: 30,
      bitrateKbps: 2400,
      tight: true,
    });
  });

  it("geeft één platform op dezelfde lijn een betere stand", () => {
    const plan = streamFormatPlan("auto", 6.85, ["twitch"], 160);
    expect(plan.quality).toBe("720p60");
    expect(plan.bitrateKbps).toBe(4900);
    expect(plan.tight).toBe(false);
  });

  it("gaat met een snelle lijn naar 1080p60, afgetopt op de Twitch-grens", () => {
    const plan = streamFormatPlan("auto", 50, ["twitch"], 160);
    expect(plan).toMatchObject({ quality: "1080p60", bitrateKbps: TWITCH_MAX_KBPS, tight: false });
  });

  it("kiest zonder gemeten upload een veilige 720p30", () => {
    expect(streamFormatPlan("auto", 0, ["youtube"], 160)).toMatchObject({
      resolution: "1280x720",
      fps: 30,
      bitrateKbps: 4500,
    });
  });

  it("houdt een vaste kwaliteit aan, maar blijft binnen de upload", () => {
    const plan = streamFormatPlan("1080p60", 6.85, ["twitch", "facebook"], 160);
    expect(plan).toMatchObject({ resolution: "1920x1080", fps: 60, bitrateKbps: 2400, tight: true });
  });
});

describe("encoderinstellingen in de opgeslagen instellingen", () => {
  it("laat een bestaande opstelling ongemoeid: wie al een bitrate had, opent geavanceerd", () => {
    const saved = mergeLivestreamSettings({
      platform: "twitch",
      dualEnabled: true,
      platform2: "facebook",
      resolution: "1920x1080",
      fps: 60,
      bitrateKbps: 8000,
    });
    expect(saved).toMatchObject({
      encoderMode: "advanced",
      resolution: "1920x1080",
      fps: 60,
      bitrateKbps: 8000,
      encoderPreset: "balanced",
      keyframeSec: 2,
      audioBitrateKbps: 160,
    });
  });

  it("vult in de eenvoudige stand resolutie, fps en bitrate zelf in", () => {
    const simple = mergeLivestreamSettings({
      encoderMode: "simple",
      quality: "auto",
      uploadMbps: 6.85,
      platform: "twitch",
      dualEnabled: true,
      platform2: "facebook",
      resolution: "1920x1080",
      fps: 60,
      bitrateKbps: 8000,
    });
    expect(simple).toMatchObject({ resolution: "1280x720", fps: 30, bitrateKbps: 2400 });
  });

  it("begint een nieuwe installatie eenvoudig, gelijk aan de standaardwaarden", () => {
    const fresh = mergeLivestreamSettings({});
    expect(fresh.encoderMode).toBe("simple");
    expect(fresh.quality).toBe("auto");
    expect(fresh).toMatchObject({
      resolution: DEFAULT_LIVESTREAM_SETTINGS.resolution,
      fps: DEFAULT_LIVESTREAM_SETTINGS.fps,
      bitrateKbps: DEFAULT_LIVESTREAM_SETTINGS.bitrateKbps,
    });
  });

  it("negeert onzinwaarden", () => {
    const merged = mergeLivestreamSettings({
      encoderMode: "x" as never,
      quality: "4k" as never,
      encoderPreset: "ultra" as never,
      keyframeSec: 99,
      audioBitrateKbps: 77,
      bitrateKbps: 6000,
    });
    expect(merged).toMatchObject({
      encoderMode: "advanced",
      quality: "auto",
      encoderPreset: "balanced",
      keyframeSec: 4,
      audioBitrateKbps: 160,
    });
  });

  it("houdt het keyframe-interval op 2 seconden zoals voorheen", () => {
    for (const fps of [15, 30, 60]) expect(keyframeIntervalFrames(fps, 2)).toBe(Math.max(30, fps * 2));
  });
});

describe("streamFallingBehind", () => {
  it("meldt niets in de eerste seconden of zonder meting", () => {
    expect(streamFallingBehind({ speed: 0.5, frames: 100, targetFps: 30 })).toBe(false);
    expect(streamFallingBehind({ speed: null, frames: 10_000, targetFps: 30 })).toBe(false);
  });

  it("meldt een stream die trager dan realtime verstuurt", () => {
    expect(streamFallingBehind({ speed: 0.8, frames: 3000, targetFps: 60 })).toBe(true);
    expect(streamFallingBehind({ speed: 1.0, frames: 3000, targetFps: 60 })).toBe(false);
  });
});

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

  it("kapt af op de Facebook-limiet", () => {
    const advice = bitrateAdvice("1920x1080", 60, "facebook");
    expect(advice.recommendedKbps).toBe(FACEBOOK_MAX_KBPS);
    expect(advice.maximumKbps).toBe(FACEBOOK_MAX_KBPS);
    expect(bitrateAdvice("1920x1080", 30, "facebook").recommendedKbps).toBe(8000);
  });

  it("neemt bij twee bestemmingen de strengste grens", () => {
    expect(bitrateAdvice("1920x1080", 60, ["youtube", "facebook"]).maximumKbps).toBe(FACEBOOK_MAX_KBPS);
    expect(bitrateAdvice("1920x1080", 60, ["facebook", "twitch"]).maximumKbps).toBe(TWITCH_MAX_KBPS);
    expect(bitrateAdvice("1920x1080", 60, ["youtube", "custom"])).toEqual(bitrateAdvice("1920x1080", 60));
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
