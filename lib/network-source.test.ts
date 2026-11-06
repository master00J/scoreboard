import { describe, expect, it } from "vitest";
import {
  NETWORK_SOURCE_H264_CODEC,
  isSafeNetworkUrl,
  maskNetworkUrl,
  networkSourceErrorIsFatal,
  networkSourceErrorIsTemporary,
  networkSourceFfmpegArgs,
  networkSourceProtocol,
  networkSourceRetryDelayMs,
  networkSourceTransportArgs,
  sanitizeNetworkUrl,
} from "./network-source";

const HIK = "rtsp://admin:Geheim123@192.168.1.64:554/Streaming/Channels/101";

describe("netwerkadressen", () => {
  it("laat de vier protocollen door die ffmpeg met hetzelfde pad leest", () => {
    expect(isSafeNetworkUrl(HIK)).toBe(true);
    expect(isSafeNetworkUrl("rtsps://camera.club.be:322/live")).toBe(true);
    expect(isSafeNetworkUrl("udp://239.255.255.1:50000")).toBe(true);
    expect(isSafeNetworkUrl("rtp://239.0.0.1:5004")).toBe(true);
    expect(isSafeNetworkUrl("srt://0.0.0.0:9999?mode=listener")).toBe(true);
    expect(isSafeNetworkUrl("rtmp://10.0.0.5/live/stream")).toBe(true);
  });

  it("geeft het ingetypte adres terug, niet een genormaliseerde versie", () => {
    // Een RTSP-pad moet precies blijven zoals de camera het verwacht.
    expect(sanitizeNetworkUrl(HIK)).toBe(HIK);
    expect(sanitizeNetworkUrl(`  ${HIK}  `)).toBe(HIK);
  });

  it("weigert alles wat ffmpeg als iets anders dan een stream kan lezen", () => {
    expect(sanitizeNetworkUrl("file:///etc/passwd")).toBe("");
    expect(sanitizeNetworkUrl("concat:a|b")).toBe("");
    expect(sanitizeNetworkUrl("pipe:0")).toBe("");
    expect(sanitizeNetworkUrl("http://camera/stream")).toBe("");
    // Zou ffmpeg als optie lezen in plaats van als invoer.
    expect(sanitizeNetworkUrl("-i")).toBe("");
    expect(sanitizeNetworkUrl("rtsp://host/a b")).toBe("");
    expect(sanitizeNetworkUrl("rtsp://host/a\nb")).toBe("");
    expect(sanitizeNetworkUrl("rtsp:///zonder-host")).toBe("");
    expect(sanitizeNetworkUrl("")).toBe("");
    expect(sanitizeNetworkUrl(null)).toBe("");
    expect(sanitizeNetworkUrl(`rtsp://host/${"a".repeat(2100)}`)).toBe("");
  });

  it("verbergt inloggegevens, want clubs mailen logbestanden door", () => {
    expect(maskNetworkUrl(HIK)).toBe("rtsp://***@192.168.1.64:554/Streaming/Channels/101");
    expect(maskNetworkUrl("srt://host:9999?passphrase=zeergeheim")).toBe(
      "srt://host:9999?passphrase=***",
    );
    // Zonder inlog blijft het adres leesbaar.
    expect(maskNetworkUrl("udp://239.255.255.1:50000")).toBe("udp://239.255.255.1:50000");
  });

  it("herkent het protocol", () => {
    expect(networkSourceProtocol(HIK)).toBe("rtsp:");
    expect(networkSourceProtocol("udp://239.255.255.1:50000")).toBe("udp:");
    expect(networkSourceProtocol("http://x/y")).toBe(null);
  });
});

describe("ffmpeg-opdracht", () => {
  it("dwingt RTSP over TCP af: UDP in een zaal geeft blokken in beeld", () => {
    expect(networkSourceTransportArgs(HIK)).toEqual(["-rtsp_transport", "tcp"]);
  });

  it("geeft een multicast-feed een ruime wachtrij die niet fataal overloopt", () => {
    expect(networkSourceTransportArgs("udp://239.255.255.1:50000")).toEqual([
      "-fifo_size",
      "5000000",
      "-overrun_nonfatal",
      "1",
    ]);
  });

  it("gebruikt geen ffmpeg-tijdslimiet, want die optie heet per versie anders", () => {
    const args = networkSourceFfmpegArgs({ url: HIK, mode: "copy", fps: 30 });
    expect(args).not.toContain("-stimeout");
    expect(args).not.toContain("-timeout");
  });

  it("hermuxt zonder hercodering en levert fragmented MP4 op stdout", () => {
    const args = networkSourceFfmpegArgs({ url: HIK, mode: "copy", fps: 30 });
    expect(args.join(" ")).toContain("-c:v copy");
    expect(args).not.toContain("libx264");
    expect(args.join(" ")).toContain("-movflags +frag_keyframe+empty_moov+default_base_moof");
    expect(args[args.length - 1]).toBe("pipe:1");
    // Het adres staat als eigen argument na -i, dus een schaal kan er niets aan toevoegen.
    expect(args[args.indexOf("-i") + 1]).toBe(HIK);
  });

  it("laat geluid aan de audiomixer van de studio", () => {
    expect(networkSourceFfmpegArgs({ url: HIK, mode: "copy", fps: 30 })).toContain("-an");
  });

  it("hercodeert naar precies het profiel dat de speler aankan", () => {
    const args = networkSourceFfmpegArgs({ url: HIK, mode: "h264", fps: 50 });
    expect(args.join(" ")).toContain("-c:v libx264");
    expect(args.join(" ")).toContain("-profile:v high");
    expect(args.join(" ")).toContain("-level 4.1");
    // avc1.640029 = High 4.1: wat h264-modus belooft, belooft de speler ook.
    expect(NETWORK_SOURCE_H264_CODEC).toContain("avc1.640029");
    expect(args.join(" ")).toContain("-g 100");
  });

  it("weigert een adres dat de controle niet haalt", () => {
    expect(() => networkSourceFfmpegArgs({ url: "file:///etc/passwd", mode: "copy", fps: 30 })).toThrow();
  });
});

describe("herstel", () => {
  it("scheidt een haperende verbinding van een verkeerd adres", () => {
    expect(networkSourceErrorIsTemporary("Connection timed out")).toBe(true);
    expect(networkSourceErrorIsTemporary("rtsp://x: Connection refused")).toBe(true);
    expect(networkSourceErrorIsFatal("401 Unauthorized")).toBe(true);
    expect(networkSourceErrorIsFatal("Protocol not found")).toBe(true);
    expect(networkSourceErrorIsFatal("Connection timed out")).toBe(false);
  });

  it("wacht langer na elke mislukte poging, tot 15 seconden", () => {
    expect(networkSourceRetryDelayMs(0)).toBe(1000);
    expect(networkSourceRetryDelayMs(1)).toBe(2000);
    expect(networkSourceRetryDelayMs(2)).toBe(4000);
    expect(networkSourceRetryDelayMs(3)).toBe(8000);
    expect(networkSourceRetryDelayMs(9)).toBe(15_000);
  });
});
