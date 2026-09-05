import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIVESTREAM_SETTINGS,
  buildRtmpDestination,
  buildRtmpDestinations,
  clampBitrateKbps,
  escapeTeeUrl,
  ffmpegOutputArgs,
  guessDshowAudioForCameraLabel,
  audioChannelGain,
  audioMonitorGains,
  audioMonitorOutputConflicts,
  audioMonitorProcessKey,
  audioChainFingerprint,
  audioDeviceFingerprint,
  audioGainCommands,
  LIVESTREAM_AZMQ_FILTER,
  armedAudioChannels,
  buildAudioMixPlan,
  isSafeStreamKey,
  maskRtmpDestination,
  applyVideoInputSelection,
  resolvePreviewVideoInput,
  sanitizeBrowserUrl,
  sanitizeMediaPath,
  browserAudioDeviceId,
  mediaAudioDeviceId,
  isBrowserAudioDevice,
  mergeLivestreamSettings,
  parseDshowAudioDevices,
  parseDshowVideoDevices,
  mergeLivestreamAudioDevices,
  sortLivestreamAudioDevices,
  audioDeviceDisplayName,
  audioInputArgs,
  dshowAudioInputArgs,
  isWasapiAudioDevice,
  wasapiLoopbackPipeName,
  silentAudioInputArgs,
  ffmpegProgressHasEncodedFrame,
  stripFfmpegProgressLines,
  appendFfmpegProgressBuffer,
  parseFfmpegProgressFields,
  looksLikePacketLoss,
  looksLikeDestinationFail,
  looksLikeNonEncoderFail,
  looksLikeEncoderFail,
  STREAM_AUDIO_SAMPLE_RATE,
  DSHOW_AUDIO_BUFFER_MS,
} from "./livestream";

const base = {
  ...DEFAULT_LIVESTREAM_SETTINGS,
  streamKey: "abcd-efgh-ijkl-mnop",
};

describe("buildRtmpDestination", () => {
  it("bouwt YouTube- en Twitch-URL's", () => {
    expect(buildRtmpDestination({ ...base, platform: "youtube" })).toBe(
      "rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl-mnop",
    );
    expect(
      buildRtmpDestination({
        ...base,
        platform: "twitch",
        streamKey: "live_123_abc",
      }),
    ).toBe("rtmp://live.twitch.tv/app/live_123_abc");
  });

  it("plakt custom URL en key zonder dubbele slash", () => {
    expect(
      buildRtmpDestination({
        ...base,
        platform: "custom",
        customUrl: "rtmps://live.restream.io/live/",
        streamKey: "re_abc",
      }),
    ).toBe("rtmps://live.restream.io/live/re_abc");
  });

  it("weiger ongeldige keys", () => {
    expect(() =>
      buildRtmpDestination({
        ...base,
        platform: "youtube",
        streamKey: "bad key with spaces",
      }),
    ).toThrow();
  });
});

describe("dual destinations", () => {
  it("voegt een tweede RTMP-bestemming toe", () => {
    expect(
      buildRtmpDestinations({
        ...base,
        platform: "youtube",
        dualEnabled: true,
        platform2: "twitch",
        streamKey2: "live_123_abc",
      }),
    ).toEqual([
      "rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl-mnop",
      "rtmp://live.twitch.tv/app/live_123_abc",
    ]);
  });

  it("escapt : en | voor de tee-muxer", () => {
    expect(escapeTeeUrl("rtmp://live.twitch.tv/app/key")).toBe("rtmp\\://live.twitch.tv/app/key");
  });

  it("gebruikt tee bij twee bestemmingen", () => {
    const args = ffmpegOutputArgs([
      "rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl-mnop",
      "rtmp://live.twitch.tv/app/live_123_abc",
    ]);
    expect(args[0]).toBe("-use_fifo");
    expect(args.at(-2)).toBe("tee");
    expect(args.at(-1)).toContain("a.rtmp.youtube.com");
    expect(args.at(-1)).toContain("live.twitch.tv");
    expect(args.at(-1)).toContain("\\:");
  });

  it("schrijft een lokaal mp4-bestand", () => {
    const args = ffmpegOutputArgs(["C:\\\\Videos\\\\clip.mp4"]);
    expect(args).toContain("mp4");
    expect(args.at(-1)).toContain("clip.mp4");
  });
});

describe("maskRtmpDestination", () => {
  it("verbergt de streamkey", () => {
    expect(maskRtmpDestination("rtmp://a.rtmp.youtube.com/live2/secret-key")).toBe(
      "rtmp://a.rtmp.youtube.com/live2/***",
    );
  });
});

describe("parseDshowAudioDevices", () => {
  it("leest alleen audio-apparaten", () => {
    const text = `
[dshow @ 000] DirectShow video devices
[dshow @ 000]  "USB Camera"
[dshow @ 000] DirectShow audio devices
[dshow @ 000]  "Microphone (USB)"
[dshow @ 000]  "Game Capture HD60"
`;
    expect(parseDshowAudioDevices(text).map((d) => d.name)).toEqual(["Microphone (USB)", "Game Capture HD60"]);
  });

  it("leest FFmpeg 7-regels met (audio)-tag — GoXLR en RodeCaster", () => {
    const text = `
[dshow @ 000] "Logitech BRIO" (video)
[dshow @ 000] "Microfoon (Logitech BRIO)" (audio)
[dshow @ 000]   Alternative name "@device_cm_\\\\?\\wave"
[dshow @ 000] "Chat Mic (TC-Helicon GoXLR)" (audio)
[dshow @ 000] "Broadcast Stream Mix (TC-Helicon GoXLR)" (audio)
[dshow @ 000] "Microfoon (RODECaster Duo Main Stereo)" (audio)
`;
    expect(parseDshowAudioDevices(text).map((d) => d.name)).toEqual([
      "Microfoon (Logitech BRIO)",
      "Chat Mic (TC-Helicon GoXLR)",
      "Broadcast Stream Mix (TC-Helicon GoXLR)",
      "Microfoon (RODECaster Duo Main Stereo)",
    ]);
  });
});

describe("wasapi loopback devices", () => {
  it("zet GoXLR-weergavekanalen om naar een pipe-input", () => {
    const name = "wasapi:Game (TC-Helicon GoXLR)";
    expect(isWasapiAudioDevice(name)).toBe(true);
    expect(audioDeviceDisplayName(name)).toBe("Game (TC-Helicon GoXLR)");
    expect(audioInputArgs(name)).toContain("s16le");
    expect(audioInputArgs(name)).toContain(wasapiLoopbackPipeName(name));
  });
});

describe("mergeLivestreamAudioDevices", () => {
  it("ontdubbelt en zet stream-mixen vooraan", () => {
    const merged = mergeLivestreamAudioDevices(
      [{ name: "Speakers" }, { name: "Chat Mic (TC-Helicon GoXLR)" }],
      [{ name: "chat mic (tc-helicon goxlr)" }, { name: "Broadcast Stream Mix (TC-Helicon GoXLR)" }],
      [{ name: "Microfoon (RODECaster Duo Main Stereo)" }],
    );
    expect(merged.map((d) => d.name)[0]).toBe("Broadcast Stream Mix (TC-Helicon GoXLR)");
    expect(merged.map((d) => d.name)).toContain("Microfoon (RODECaster Duo Main Stereo)");
    expect(merged.map((d) => d.name)).toContain("Chat Mic (TC-Helicon GoXLR)");
    expect(merged.map((d) => d.name)).toContain("Speakers");
    expect(merged).toHaveLength(4);
  });
});

describe("sortLivestreamAudioDevices", () => {
  it("zet GoXLR-mix voor een gewone mic", () => {
    const sorted = sortLivestreamAudioDevices([
      { name: "Microphone (Realtek)" },
      { name: "Broadcast Stream Mix (TC-Helicon GoXLR)" },
    ]);
    expect(sorted[0]?.name).toMatch(/Broadcast Stream Mix/);
  });
});

describe("guessDshowAudioForCameraLabel", () => {
  it("matcht capture-kaart op naam", () => {
    expect(
      guessDshowAudioForCameraLabel("Game Capture HD60", [{ name: "Game Capture HD60" }, { name: "Microphone" }]),
    ).toBe("Game Capture HD60");
  });
});

describe("parseDshowVideoDevices", () => {
  it("leest alleen video-apparaten", () => {
    const text = `
[dshow @ 000] DirectShow video devices (some may be both video and audio devices)
[dshow @ 000]  "USB Camera"
[dshow @ 000]     Alternative name "@device_pnp_\\\\?\\usb"
[dshow @ 000]  "Game Capture HD60"
[dshow @ 000] DirectShow audio devices
[dshow @ 000]  "Microphone"
`;
    expect(parseDshowVideoDevices(text).map((d) => d.name)).toEqual(["USB Camera", "Game Capture HD60"]);
  });
});

describe("helpers", () => {
  it("accepteert gangbare keys", () => {
    expect(isSafeStreamKey("abcd-efgh-ijkl-mnop")).toBe(true);
    expect(isSafeStreamKey("live_123_abc")).toBe(true);
    expect(isSafeStreamKey("")).toBe(false);
  });

  it("beperkt bitrate", () => {
    expect(clampBitrateKbps(200)).toBe(1500);
    /** Bovengrens 20000: 1080p60 vraagt op YouTube ~12000 kbps. */
    expect(clampBitrateKbps(50000)).toBe(20000);
    expect(clampBitrateKbps(12000)).toBe(12000);
    expect(clampBitrateKbps(4500)).toBe(4500);
  });

  it("vult ontbrekende overlay-velden aan", () => {
    const merged = mergeLivestreamSettings({ platform: "twitch", streamKey: "live_123_abc" });
    expect(merged.sponsors).toBe(true);
    expect(merged.layoutMode).toBe("auto");
    expect(merged.manualLayout.score).toBe(true);
    expect(merged.sponsorPosition).toBe("auto");
    expect(merged.audioEnabled).toBe(true);
    expect(merged.audioChannels).toHaveLength(1);
    expect(merged.fps).toBe(30);
    expect(merged.scoreWidget.style).toBe("broadcast");
    expect(merged.scoreWidget.anchor).toBe("top-left");
    expect(merged.scoreWidgetDesigns).toEqual([]);
    expect(merged.studioPreview).toBe(true);
    expect(mergeLivestreamSettings({ studioPreview: false }).studioPreview).toBe(false);
    expect(mergeLivestreamSettings({ previewVideoInputId: "v-led" }).previewVideoInputId).toBe("v-led");
    expect(mergeLivestreamSettings({}).streamDeckSlots).toEqual([]);
    expect(
      mergeLivestreamSettings({
        streamDeckSlots: [{ id: "dk1", title: "CUT", action: { id: "cut" } }],
      }).streamDeckSlots,
    ).toEqual([{ id: "dk1", title: "CUT", action: { id: "cut" } }]);
    expect(merged.videoInputs.length).toBeGreaterThanOrEqual(2);
    expect(merged.activeVideoInputId).toBeTruthy();
    expect(merged.recordDir).toBe("");
    expect(mergeLivestreamSettings({ recordDir: "D:\\\\Captures" }).recordDir).toBe("D:\\\\Captures");
  });

  it("migreert een oude camera-bron naar benoemde ingangen", () => {
    const merged = mergeLivestreamSettings({
      source: "camera",
      cameraDevice: "camera:abc",
    });
    expect(merged.videoInputs.some((input) => input.kind === "camera" && input.cameraDevice === "camera:abc")).toBe(
      true,
    );
    expect(merged.source).toBe("camera");
    expect(merged.cameraDevice).toBe("camera:abc");
  });

  it("past audio-follow toe bij een program-wissel", () => {
    const base = mergeLivestreamSettings({
      audioChannels: [
        { id: "a1", device: "Mic", volume: 80, muted: false },
        { id: "a2", device: "HDMI", volume: 80, muted: false },
      ],
      videoInputs: [
        {
          id: "v-cam",
          name: "Tafel",
          kind: "camera",
          cameraDevice: "camera:1",
          audioFollow: { a1: "unmute", a2: "mute" },
        },
        {
          id: "v-led",
          name: "LED",
          kind: "display",
          cameraDevice: "",
          audioFollow: { a1: "mute", a2: "unmute" },
        },
      ],
      activeVideoInputId: "v-cam",
    });
    const next = mergeLivestreamSettings({ ...base, ...applyVideoInputSelection(base, "v-led") });
    expect(next.source).toBe("display");
    expect(next.audioChannels.find((c) => c.id === "a1")?.muted).toBe(true);
    expect(next.audioChannels.find((c) => c.id === "a2")?.muted).toBe(false);
  });

  it("kiest de volgende browserbron voor preview, niet alleen program", () => {
    const merged = mergeLivestreamSettings({
      videoInputs: [
        { id: "v-cam", name: "Camera 1", kind: "camera", cameraDevice: "HDMI" },
        { id: "v-web", name: "Browser 1", kind: "browser", browserUrl: "https://example.com/overlay" },
      ],
      activeVideoInputId: "v-cam",
      previewVideoInputId: "v-web",
    });
    expect(resolvePreviewVideoInput(merged)?.id).toBe("v-web");
    expect(resolvePreviewVideoInput(merged)?.browserUrl).toBe(sanitizeBrowserUrl("https://example.com/overlay"));
  });

  it("accepteert een browserbron met http(s)-URL", () => {
    expect(sanitizeBrowserUrl("scoreboard.example")).toBe("https://scoreboard.example/");
    expect(sanitizeBrowserUrl("javascript:alert(1)")).toBe("");
    const merged = mergeLivestreamSettings({
      videoInputs: [
        { id: "v-web", name: "Sponsor", kind: "browser", browserUrl: "https://example.com/overlay" },
      ],
      activeVideoInputId: "v-web",
    });
    expect(merged.source).toBe("browser");
    expect(merged.videoInputs[0]?.browserUrl).toBe("https://example.com/overlay");
    const browserDevice = browserAudioDeviceId("v-web");
    expect(isBrowserAudioDevice(browserDevice)).toBe(true);
    expect(merged.audioChannels.some((channel) => channel.device === browserDevice)).toBe(true);
    expect(audioInputArgs(browserDevice)).toContain("s16le");
  });

  it("accepteert een lokale mediabron", () => {
    expect(sanitizeMediaPath("C:\\Videos\\intro.mp4")).toBe("C:\\Videos\\intro.mp4");
    expect(sanitizeMediaPath("https://evil.example/x.mp4")).toBe("");
    expect(sanitizeMediaPath("javascript:alert(1)")).toBe("");
    const merged = mergeLivestreamSettings({
      videoInputs: [
        { id: "v-clip", name: "Intro", kind: "media", mediaPath: "C:\\Videos\\intro.mp4", mediaLoop: false },
      ],
      activeVideoInputId: "v-clip",
    });
    expect(merged.source).toBe("media");
    expect(merged.videoInputs[0]?.mediaPath).toBe("C:\\Videos\\intro.mp4");
    expect(merged.videoInputs[0]?.mediaLoop).toBe(false);
    expect(merged.audioChannels.some((channel) => channel.device === mediaAudioDeviceId("v-clip"))).toBe(true);
  });

  it("kiest sport-defaults voor fps en audio", () => {
    expect(DEFAULT_LIVESTREAM_SETTINGS.fps).toBe(30);
    expect(dshowAudioInputArgs("Microphone (USB)")).toContain(String(DSHOW_AUDIO_BUFFER_MS));
    expect(silentAudioInputArgs().at(-1)).toContain(`sample_rate=${STREAM_AUDIO_SAMPLE_RATE}`);
    expect(ffmpegProgressHasEncodedFrame("frame=0\nprogress=continue")).toBe(false);
    expect(ffmpegProgressHasEncodedFrame("frame=1\nprogress=continue")).toBe(true);
    expect(ffmpegProgressHasEncodedFrame("bitrate=N/A\nframe=12\n")).toBe(true);
    expect(stripFfmpegProgressLines("frame=12\nprogress=continue\nConnection failed")).toContain("Connection failed");
    expect(stripFfmpegProgressLines("frame=12\nprogress=continue\nConnection failed")).not.toContain("frame=");
    expect(ffmpegProgressHasEncodedFrame(appendFfmpegProgressBuffer("fra", "me=4\n"))).toBe(true);
    expect(parseFfmpegProgressFields("frame=88\nfps=29.92\nbitrate=4321.5kbits/s\ndrop_frames=3\ndup_frames=1\nspeed=0.99x\n")).toEqual({
      frames: 88,
      fps: 29.92,
      bitrateKbps: 4321.5,
      dropFrames: 3,
      dupFrames: 1,
      speed: 0.99,
    });
    expect(looksLikePacketLoss("RTMP packet too large")).toBe(true);
    expect(looksLikePacketLoss("frame=12")).toBe(false);
  });

  it("classificeert ffmpeg-fouten over een hele poging, niet alleen de laatste regel", () => {
    const acc = appendFfmpegProgressBuffer(
      "Cannot open connection rtmp://a.rtmp.youtube.com/live2/***\n",
      "frame=0\nprogress=continue\n",
    );
    expect(looksLikeDestinationFail(acc)).toBe(true);
    expect(looksLikeDestinationFail("frame=0")).toBe(false);
    expect(looksLikeEncoderFail("No capable devices found for nvenc")).toBe(true);
    expect(looksLikeNonEncoderFail("Error opening input: No such device")).toBe(true);
    expect(looksLikeNonEncoderFail("Cannot open connection")).toBe(false);
    expect(looksLikeNonEncoderFail("nvenc cannot load")).toBe(false);
  });

  it("migreert oude audioDevice naar een mixer-kanaal", () => {
    const merged = mergeLivestreamSettings({ audioDevice: "Microphone (USB)" });
    expect(merged.audioChannels[0]?.device).toBe("Microphone (USB)");
    expect(merged.audioDevice).toBe("Microphone (USB)");
  });
});

describe("audio mixer", () => {
  it("neemt mute en master mee in de gain", () => {
    expect(audioChannelGain({ id: "a1", device: "Mic", volume: 80, muted: false }, 50)).toBeCloseTo(0.4);
    expect(audioChannelGain({ id: "a1", device: "Mic", volume: 80, muted: true }, 100)).toBe(0);
  });

  it("PFL is unity, master-koptelefoon volgt de mix", () => {
    const channels = [
      { id: "a1", device: "Mic", volume: 20, muted: false },
      { id: "a2", device: "wasapi:Music (TC-Helicon GoXLR)", volume: 100, muted: false },
    ];
    expect(audioMonitorGains({ audioMasterVolume: 50, audioMonitorCueIds: ["a1"], audioChannels: channels })).toEqual([
      1, 0,
    ]);
    expect(
      audioMonitorGains({
        audioMasterVolume: 50,
        audioMonitorCueIds: ["master"],
        audioChannels: channels,
      })[0],
    ).toBeCloseTo(0.1);
    expect(audioMonitorProcessKey({
      audioEnabled: true,
      audioMonitorDevice: "Headset",
      audioMonitorCueIds: ["a1"],
      audioChannels: channels,
    })).toContain("Headset");
    expect(audioMonitorOutputConflicts("Music (TC-Helicon GoXLR)", channels)).toBe(true);
  });

  describe("audioChainFingerprint", () => {
    const base = {
      audioEnabled: true,
      audioMasterVolume: 100,
      audioChannels: [{ id: "a1", device: "Mic", volume: 80, muted: false }],
    };

    it("verandert bij mute — anders blijft de audio doorkomen", () => {
      const muted = {
        ...base,
        audioChannels: [{ id: "a1", device: "Mic", volume: 80, muted: true }],
      };
      expect(audioChainFingerprint(muted)).not.toBe(audioChainFingerprint(base));
    });

    it("verandert bij een andere fader- of masterstand", () => {
      expect(
        audioChainFingerprint({
          ...base,
          audioChannels: [{ id: "a1", device: "Mic", volume: 40, muted: false }],
        }),
      ).not.toBe(audioChainFingerprint(base));
      expect(audioChainFingerprint({ ...base, audioMasterVolume: 50 })).not.toBe(
        audioChainFingerprint(base),
      );
    });

    it("blijft gelijk bij wijzigingen die de keten niet raken", () => {
      expect(audioChainFingerprint({ ...base, audioChannels: [{ ...base.audioChannels[0]! }] })).toBe(
        audioChainFingerprint(base),
      );
    });

    it("houdt mute/volume buiten de device-vingerafdruk", () => {
      expect(
        audioDeviceFingerprint({
          ...base,
          audioChannels: [{ id: "a1", device: "Mic", volume: 10, muted: true }],
        }),
      ).toBe(audioDeviceFingerprint(base));
      expect(audioGainCommands({ ...base, audioChannels: [{ id: "a1", device: "Mic", volume: 80, muted: true }] })).toEqual([
        { target: "volume@v0", gain: 0 },
      ]);
    });

    it("onderscheidt uit, stil en actief", () => {
      expect(audioChainFingerprint({ ...base, audioEnabled: false })).toBe("off");
      expect(audioChainFingerprint({ ...base, audioChannels: [] })).toBe("silent");
    });
  });

  it("mengt twee bronnen met eigen volume", () => {
    const plan = buildAudioMixPlan(
      [
        { id: "a1", device: "Microphone", volume: 80, muted: false },
        { id: "a2", device: "Game Capture HD60", volume: 50, muted: false },
      ],
      100,
    );
    expect(plan.audioMap).toBe("[aout]");
    expect(plan.filterComplex).toContain("amix=inputs=2");
    expect(plan.filterComplex).toContain(LIVESTREAM_AZMQ_FILTER);
    expect(plan.filterComplex).toContain("volume@v0=0.8");
    expect(plan.filterComplex).toContain("volume@v1=0.5");
    expect(plan.filterComplex).toContain("eval=frame");
    expect(plan.inputArgs.filter((a) => a.startsWith("audio="))).toEqual([
      "audio=Microphone",
      "audio=Game Capture HD60",
    ]);
  });

  it("negeert lege of dubbele apparaten", () => {
    expect(
      armedAudioChannels([
        { id: "a1", device: "", volume: 100, muted: false },
        { id: "a2", device: "Mic", volume: 100, muted: false },
        { id: "a3", device: "Mic", volume: 80, muted: false },
      ]).map((c) => c.id),
    ).toEqual(["a2"]);
  });
});
