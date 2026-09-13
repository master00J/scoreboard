import { describe, expect, it } from "vitest";
import {
  isDisplayPlaybackRisk,
  needsStadiumTranscode,
  parseFfmpegInputProbe,
  stadiumTranscodeReason,
} from "./media-playback-compat";

const BB_PROBE = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'BB.mp4':
  Duration: 00:00:12.28, start: 0.000000, bitrate: 12294 kb/s
  Stream #0:0[0x1](eng): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080, 12065 kb/s, 60 fps, 60 tbr, 60k tbn (default)
  Stream #0:1[0x2](eng): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 188 kb/s (default)`;

const CRISTAL_PROBE = `Duration: 00:00:15.00, start: 0.000000, bitrate: 7178 kb/s
  Stream #0:0[0x1](eng): Video: h264 (Main) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 6856 kb/s, 30 fps, 30 tbr, 30k tbn (default)`;

describe("parseFfmpegInputProbe", () => {
  it("leest Mainconcept 1080p60 High", () => {
    const info = parseFfmpegInputProbe(BB_PROBE);
    expect(info).toMatchObject({
      codec: "h264",
      profile: "High",
      pixFmt: "yuv420p",
      width: 1920,
      height: 1080,
      fps: 60,
    });
    expect(info?.durationSec).toBeCloseTo(12.28);
  });

  it("leest fps uit tbr als het fps-veld ontbreekt", () => {
    const info = parseFfmpegInputProbe(
      "Stream #0:0: Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080, 60 tbr, 60 tbn",
    );
    expect(info?.fps).toBe(60);
    expect(stadiumTranscodeReason(info!)).toBe("high_fps");
  });

  it("laat 1080p60 Main met rust (fps is niet het probleem)", () => {
    const info = parseFfmpegInputProbe(
      "Stream #0:0: Video: h264 (Main) (avc1 / 0x31637661), yuv420p, 1920x1080, 60 fps, 60 tbr",
    );
    expect(info?.fps).toBe(60);
    expect(stadiumTranscodeReason(info!)).toBe("ok");
  });

  it("leest een gewone 1080p30 Main-clip", () => {
    const info = parseFfmpegInputProbe(CRISTAL_PROBE);
    expect(info).toMatchObject({
      codec: "h264",
      profile: "Main",
      fps: 30,
    });
  });
});

describe("stadiumTranscodeReason", () => {
  it("zet 1080p60 High om naar een Chromium-vriendelijk profiel", () => {
    const info = parseFfmpegInputProbe(BB_PROBE)!;
    expect(stadiumTranscodeReason(info)).toBe("high_fps");
    expect(needsStadiumTranscode(info)).toBe(true);
  });

  it("laat 1080p30 Main met rust", () => {
    const info = parseFfmpegInputProbe(CRISTAL_PROBE)!;
    expect(stadiumTranscodeReason(info)).toBe("ok");
  });

  it("zet HEVC en 10-bit om", () => {
    expect(
      stadiumTranscodeReason({
        codec: "hevc",
        profile: "Main 10",
        pixFmt: "yuv420p10le",
        width: 1920,
        height: 1080,
        fps: 25,
        durationSec: 10,
      }),
    ).toBe("unsupported_codec");
    expect(
      stadiumTranscodeReason({
        codec: "h264",
        profile: "High 10",
        pixFmt: "yuv420p10le",
        width: 1920,
        height: 1080,
        fps: 25,
        durationSec: 10,
      }),
    ).toBe("pixel_format");
  });

  it("onderscheidt een echt afspeelrisico van een probe-fout", () => {
    expect(isDisplayPlaybackRisk("high_fps")).toBe(true);
    expect(isDisplayPlaybackRisk("ok")).toBe(false);
    expect(isDisplayPlaybackRisk("probe_failed")).toBe(false);
  });
});
