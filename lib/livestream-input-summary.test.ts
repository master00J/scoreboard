import { describe, expect, it } from "vitest";
import {
  armedFollowChannels,
  encoderSummary,
  summarizeAudioFollow,
  videoInputLabel,
} from "./livestream-input-summary";
import type { LivestreamAudioChannel } from "./livestream";

const channels: LivestreamAudioChannel[] = [
  { id: "a1", device: "Microfoon", volume: 100, muted: false },
  { id: "a2", device: "Capture", volume: 100, muted: false },
  { id: "a3", device: "", volume: 100, muted: false },
];

const fallback = (n: number) => `Bron ${n}`;

describe("armedFollowChannels", () => {
  it("laat lege kanalen weg — die vulden de UI met zinloze rijen", () => {
    expect(armedFollowChannels(channels).map((c) => c.id)).toEqual(["a1", "a2"]);
  });
});

describe("summarizeAudioFollow", () => {
  it("meldt niets ingesteld", () => {
    const s = summarizeAudioFollow({ audioFollow: {} }, armedFollowChannels(channels), fallback);
    expect(s.empty).toBe(true);
    expect(s.unmute).toEqual([]);
    expect(s.mute).toEqual([]);
  });

  it("splitst aan en uit", () => {
    const s = summarizeAudioFollow(
      { audioFollow: { a1: "unmute", a2: "mute" } },
      armedFollowChannels(channels),
      fallback,
    );
    expect(s.empty).toBe(false);
    expect(s.unmute).toEqual(["Microfoon"]);
    expect(s.mute).toEqual(["Capture"]);
  });

  it("valt terug op een kanaalnaam zonder apparaat", () => {
    const s = summarizeAudioFollow(
      { audioFollow: { a1: "unmute" } },
      [{ id: "a1", device: "", volume: 100, muted: false }],
      fallback,
    );
    expect(s.unmute).toEqual(["Bron 1"]);
  });

  it("negeert 'leave'", () => {
    const s = summarizeAudioFollow(
      { audioFollow: { a1: "leave", a2: "leave" } },
      armedFollowChannels(channels),
      fallback,
    );
    expect(s.empty).toBe(true);
  });
});

describe("videoInputLabel", () => {
  it("gebruikt de naam, anders het type", () => {
    const labels = { camera: "Camera", display: "LED" };
    expect(videoInputLabel({ name: "Camera 1", kind: "camera" }, labels)).toBe("Camera 1");
    expect(videoInputLabel({ name: "  ", kind: "display" }, labels)).toBe("LED");
  });
});

describe("encoderSummary", () => {
  it("vat de encoder samen in één regel", () => {
    expect(
      encoderSummary({
        resolution: "1920x1080",
        fps: 30,
        bitrateKbps: 8000,
        encoder: "h264_nvenc",
      }),
    ).toBe("1080p · 30 fps · 8000 kbps · NVENC");
    expect(
      encoderSummary({ resolution: "1280x720", fps: 60, bitrateKbps: 6000, encoder: "auto" }),
    ).toBe("720p · 60 fps · 6000 kbps · auto");
  });
});
