import { describe, expect, it } from "vitest";
import { createArenaCueDecoder } from "./protocols/arenacue";
import { bodetLrc, createBodetDecoder } from "./protocols/bodet";
import { createDaktronicsDecoder } from "./protocols/daktronics";
import { OFFICIAL_CLOCK_PROTOCOL_LIST, officialClockProtocol } from "./protocols";
import { parseClockText } from "./protocols/shared";
import { createStramatelDecoder } from "./protocols/stramatel";
import { createSwissTimingDecoder } from "./protocols/swisstiming";
import { OFFICIAL_CLOCK_PROTOCOLS, type OfficialClockDecoder, type OfficialClockReading } from "./types";

const hex = (text: string) => Uint8Array.from(text.trim().split(/\s+/).map((h) => parseInt(h, 16)));
const latin1 = (text: string) => Uint8Array.from([...text].map((ch) => ch.charCodeAt(0)));
const join = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));

/** Voert de bytes in stukjes van `size`, zoals een seriële poort ze aflevert. */
function feed(decoder: OfficialClockDecoder, bytes: Uint8Array, size = bytes.length): OfficialClockReading[] {
  const out: OfficialClockReading[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(...decoder.push(bytes.subarray(i, i + size)));
  return out;
}

describe("clock text", () => {
  it("reads what a board shows", () => {
    expect(parseClockText(" 8:05")).toEqual({ seconds: 485, resolution: 1 });
    expect(parseClockText("12:00")).toEqual({ seconds: 720, resolution: 1 });
    expect(parseClockText("59.9 ")).toEqual({ seconds: 59.9, resolution: 0.1 });
    expect(parseClockText(" 9")).toEqual({ seconds: 9, resolution: 1 });
    expect(parseClockText("1:23.4")).toEqual({ seconds: 83.4, resolution: 0.1 });
    expect(parseClockText("  ")).toBeNull();
    expect(parseClockText("8:5")).toBeNull();
    expect(parseClockText("--:--")).toBeNull();
  });
});

describe("Bodet Scorepad", () => {
  /** Bouwt een bericht zoals de console het stuurt: SOH 7F STX 47 <tekst> ETX LRC. */
  function frame(message: Uint8Array): Uint8Array {
    const body = join(hex("01 7F 02 47"), message, hex("03"));
    return join(body, Uint8Array.of(bodetLrc(body, 1, body.length - 1)));
  }
  const shot = (status: number, digits: string) => frame(join(latin1("50"), Uint8Array.of(status), latin1(digits)));

  it("reads the frames printed in Bodet's protocol manual", () => {
    const decoder = createBodetDecoder();
    // Bericht 18, klok loopt: 1:56.
    expect(feed(decoder, hex("01 7F 02 47 31 38 80 35 20 31 35 36 30 30 20 20 31 20 03 26"))).toEqual([
      { game: { seconds: 116, resolution: 1, running: true } },
    ]);
    // Laatste minuut: 36,9 seconden, eerst in bericht 18 en dan elke tiende in bericht 36.
    expect(feed(decoder, hex("01 7F 02 47 31 38 80 35 33 36 44 39 30 30 20 20 31 20 03 6C"))).toEqual([
      { game: { seconds: 36.9, resolution: 0.1, running: true } },
    ]);
    expect(feed(decoder, hex("01 7F 02 47 33 36 33 36 38 03 21"))).toEqual([
      { game: { seconds: 36.8, resolution: 0.1, running: true } },
    ]);
    // Klok stilgezet op 35,8.
    expect(feed(decoder, hex("01 7F 02 47 31 38 82 35 33 35 44 38 30 30 20 20 31 20 03 6C"))).toEqual([
      { game: { seconds: 35.8, resolution: 0.1, running: false } },
    ]);
    expect(decoder.stats()).toEqual({ frames: 4, rejected: 0 });
  });

  it("reads the shot clock: running, stopped, tenths and blank", () => {
    const decoder = createBodetDecoder();
    expect(feed(decoder, shot(0x80, "24"))).toEqual([{ shot: { seconds: 24, resolution: 1, running: true } }]);
    expect(feed(decoder, shot(0x82, "14"))).toEqual([{ shot: { seconds: 14, resolution: 1, running: false } }]);
    expect(feed(decoder, shot(0x80, " 1"))).toEqual([{ shot: { seconds: 1, resolution: 1, running: true } }]);
    expect(feed(decoder, shot(0x90, "43"))).toEqual([{ shot: { seconds: 4.3, resolution: 0.1, running: true } }]);
    expect(feed(decoder, shot(0x8a, "24"))).toEqual([{ shot: null }]);
    expect(feed(decoder, shot(0x86, " 0"))).toEqual([{ shot: { seconds: 0, resolution: 1, running: false } }]);
  });

  it("survives split frames, noise between frames and a damaged checksum", () => {
    const decoder = createBodetDecoder();
    const good = shot(0x80, "21");
    const damaged = shot(0x80, "20");
    damaged[damaged.length - 1] ^= 0x01;
    const stream = join(hex("FF 00 41"), good, hex("E0 E8"), damaged, shot(0x80, "19"));
    expect(feed(decoder, stream, 3)).toEqual([
      { shot: { seconds: 21, resolution: 1, running: true } },
      { shot: { seconds: 19, resolution: 1, running: true } },
    ]);
    expect(decoder.stats().rejected).toBe(1);
  });

  it("ignores frames of other messages without counting them as errors", () => {
    const decoder = createBodetDecoder();
    // Bericht 30: score.
    expect(feed(decoder, frame(latin1("305 12 18")))).toEqual([]);
    expect(decoder.stats()).toEqual({ frames: 1, rejected: 0 });
  });
});

describe("Stramatel", () => {
  /** Hoofdbericht van 54 bytes; velden waar de test niets over zegt, staan op een rustige stand. */
  function main(opts: { clock: string; state?: string; shot?: string; shotState?: string; shotVisible?: string }): Uint8Array {
    const text =
      "3 0" + opts.clock + "  0  0" + "1" + "00" + "00" + " " + (opts.state ?? "0") + " " +
      "0".repeat(24) + "  " + (opts.shot ?? "24") + "0" + (opts.shotState ?? "0") + (opts.shotVisible ?? "1");
    const bytes = join(Uint8Array.of(0xf8), latin1(text), Uint8Array.of(0x0d));
    expect(bytes.length).toBe(54);
    return bytes;
  }

  it("reads game clock and shot clock with their running flags", () => {
    const decoder = createStramatelDecoder();
    expect(feed(decoder, main({ clock: " 610" }))).toEqual([
      { game: { seconds: 370, resolution: 1, running: true }, shot: { seconds: 24, resolution: 1, running: true } },
    ]);
    expect(feed(decoder, main({ clock: "1130", state: "1", shot: " 9", shotState: "3" }))).toEqual([
      { game: { seconds: 690, resolution: 1, running: false }, shot: { seconds: 9, resolution: 1, running: false } },
    ]);
  });

  it("reads tenths in the last minute and a blank shot clock", () => {
    const decoder = createStramatelDecoder();
    expect(feed(decoder, main({ clock: "599 ", shotVisible: "0" }))).toEqual([
      { game: { seconds: 59.9, resolution: 0.1, running: true }, shot: null },
    ]);
    expect(feed(decoder, main({ clock: "011 " }))[0].game).toEqual({ seconds: 1.1, resolution: 0.1, running: true });
  });

  it("does not report the break countdown as game time", () => {
    const decoder = createStramatelDecoder();
    const [reading] = feed(decoder, main({ clock: "1130", state: "R", shotVisible: "0" }));
    expect(reading.game).toBeUndefined();
    expect(reading.shot).toBeNull();
  });

  it("skips other frame types and the bytes the console sends between frames", () => {
    const decoder = createStramatelDecoder();
    const players = join(Uint8Array.of(0xf8), latin1("7" + " ".repeat(51)), Uint8Array.of(0x0d));
    const between = hex("E0 E0 E8 E8 E4 E4");
    const stream = join(players, between, main({ clock: " 609" }), between);
    expect(feed(decoder, stream, 7)).toHaveLength(1);
    expect(decoder.stats()).toEqual({ frames: 1, rejected: 0 });
  });
});

describe("Swiss Timing", () => {
  function data(opts: { clock: string; status?: string; shot?: string }): Uint8Array {
    const body = latin1("D" + opts.clock + "  5  2" + "01" + "00" + "1" + "0" + (opts.status ?? "0") + "0" + "  " + (opts.shot ?? "24"));
    expect(body.length).toBe(24);
    const framed = join(Uint8Array.of(0x02), body, Uint8Array.of(0x03));
    return join(framed, Uint8Array.of(framed.reduce((acc, byte) => acc ^ byte, 0)));
  }

  it("reads the clocks; the shot clock has no running flag", () => {
    const decoder = createSwissTimingDecoder();
    expect(feed(decoder, data({ clock: " 8:05", status: "1", shot: "14" }))).toEqual([
      { game: { seconds: 485, resolution: 1, running: true }, shot: { seconds: 14, resolution: 1 } },
    ]);
    expect(feed(decoder, data({ clock: "59.9 ", shot: " 9" }))).toEqual([
      { game: { seconds: 59.9, resolution: 0.1, running: false }, shot: { seconds: 9, resolution: 1 } },
    ]);
    expect(feed(decoder, data({ clock: " 0.0 ", status: "2", shot: "  " }))).toEqual([
      { game: { seconds: 0, resolution: 0.1, running: false }, shot: null },
    ]);
  });

  it("rejects a clock frame with a wrong checksum", () => {
    const decoder = createSwissTimingDecoder();
    const damaged = data({ clock: " 8:05" });
    damaged[5] = "9".charCodeAt(0);
    expect(feed(decoder, join(damaged, data({ clock: " 8:04" })), 5)).toHaveLength(1);
    expect(decoder.stats()).toEqual({ frames: 1, rejected: 1 });
  });
});

describe("Daktronics RTD", () => {
  /** Eén RTD-pakket dat `text` op positie `position` van de regel zet. */
  const packet = (position: number, text: string) =>
    join(hex("16"), latin1("20000000"), hex("01"), latin1("004210" + String(position).padStart(4, "0")), hex("02"), latin1(text), hex("04"), latin1("3F"), hex("17"));

  it("assembles the line and reports the clocks once their fields arrived", () => {
    const decoder = createDaktronicsDecoder();
    // Alleen de klok: of hij loopt, weten we nog niet.
    expect(feed(decoder, packet(0, "12:34"))).toEqual([{ game: { seconds: 754, resolution: 1, running: undefined } }]);
    expect(feed(decoder, packet(27, "s"))).toEqual([{ game: { seconds: 754, resolution: 1, running: false } }]);
    expect(feed(decoder, packet(27, " "), 4)).toEqual([{ game: { seconds: 754, resolution: 1, running: true } }]);
    expect(feed(decoder, packet(0, "45.3 "))).toEqual([{ game: { seconds: 45.3, resolution: 0.1, running: true } }]);
    expect(feed(decoder, packet(200, "      24"))).toEqual([{ shot: { seconds: 24, resolution: 1 } }]);
    expect(feed(decoder, packet(200, "        "))).toEqual([{ shot: null }]);
  });

  it("counts a packet without the expected markers as rejected", () => {
    const decoder = createDaktronicsDecoder();
    expect(feed(decoder, join(hex("16"), latin1("garbage"), hex("17")))).toEqual([]);
    expect(decoder.stats()).toEqual({ frames: 0, rejected: 1 });
  });
});

describe("ArenaCue JSON feed", () => {
  const utf8 = (text: string) => new TextEncoder().encode(text);

  it("reads one JSON line per reading, with numbers or board text", () => {
    const decoder = createArenaCueDecoder();
    const lines = '{"clock":"8:31","clockRunning":true,"shot":14,"shotRunning":true}\n{"clock":45.3}\r\n{"shot":null}\n';
    expect(feed(decoder, utf8(lines), 11)).toEqual([
      { game: { seconds: 511, resolution: 1, running: true }, shot: { seconds: 14, resolution: 1, running: true } },
      { game: { seconds: 45.3, resolution: 0.1 } },
      { shot: null },
    ]);
  });

  it("treats a datagram without a line ending as one message and rejects nonsense", () => {
    const decoder = createArenaCueDecoder();
    expect(decoder.push(utf8('{"shot":7}'))).toEqual([]);
    expect(decoder.endOfDatagram()).toEqual([{ shot: { seconds: 7, resolution: 1 } }]);
    expect(feed(decoder, utf8('not json\n{"clock":"abc"}\n[1,2]\n'))).toEqual([]);
    expect(decoder.stats()).toEqual({ frames: 1, rejected: 3 });
  });
});

describe("protocol list", () => {
  it("has a decoder and sensible defaults for every protocol id", () => {
    expect(OFFICIAL_CLOCK_PROTOCOL_LIST.map((protocol) => protocol.id)).toEqual([...OFFICIAL_CLOCK_PROTOCOLS]);
    for (const id of OFFICIAL_CLOCK_PROTOCOLS) {
      const protocol = officialClockProtocol(id);
      expect(protocol.id).toBe(id);
      expect(protocol.baudRate).toBeGreaterThan(0);
      expect(protocol.create().push(new Uint8Array(0))).toEqual([]);
    }
  });
});
