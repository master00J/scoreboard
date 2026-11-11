import { describe, expect, it } from "vitest";
import { createStreamDeckSlot } from "./stream-deck";
import { BOARD_DECK_PATHS, type DeckMatch, type DeckState } from "./stream-deck-board";
import { deckMatch, deckState } from "./stream-deck-board.fixtures";
import {
  DECK_LOCALES,
  DECK_TEXTS,
  deckFace,
  deckFaces,
  deckFaceSvg,
  deckPathName,
  normalizeDeckLocale,
  type DeckFaceContext,
  type DeckStream,
} from "./stream-deck-faces";

const NOW = Date.parse("2026-11-11T12:00:00.000Z");

function ctx(
  match: Partial<DeckMatch> | null = {},
  state: Partial<DeckState> = {},
  stream: DeckStream | null = null,
): DeckFaceContext {
  return {
    live: { state: deckState(state), match: match ? deckMatch(match) : null },
    stream,
    texts: DECK_TEXTS.nl,
    now: NOW,
  };
}

describe("teksten", () => {
  it("heeft in elke taal dezelfde sleutels, allemaal ingevuld", () => {
    const keys = Object.keys(DECK_TEXTS.nl).sort();
    for (const locale of DECK_LOCALES) {
      expect(Object.keys(DECK_TEXTS[locale]).sort(), locale).toEqual(keys);
      for (const [key, value] of Object.entries(DECK_TEXTS[locale])) {
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("valt terug op Nederlands bij een onbekende taal", () => {
    expect(normalizeDeckLocale("fr-BE")).toBe("fr");
    expect(normalizeDeckLocale("es")).toBe("nl");
    expect(normalizeDeckLocale(undefined)).toBe("nl");
  });

  it("geeft elke knop uit de keuzelijst een eigen naam, in elke taal", () => {
    for (const locale of DECK_LOCALES) {
      const names = BOARD_DECK_PATHS.map((path) => deckPathName(path, DECK_TEXTS[locale]));
      expect(new Set(names).size, locale).toBe(BOARD_DECK_PATHS.length);
      expect(names.every((name) => !name.startsWith("/")), locale).toBe(true);
    }
  });
});

describe("klok", () => {
  it("is groen met de lopende tijd en rood als hij stilstaat", () => {
    const running = ctx({}, {
      timerRunning: true,
      timerBaseSec: 600,
      timerStartedAt: new Date(NOW - 65_000).toISOString(),
    });
    expect(deckFace("/timer/toggle", running)).toEqual({ label: "KLOK", value: "11:05", tone: "go" });
    expect(deckFace("/timer/toggle", ctx({}, { timerBaseSec: 600 }))).toEqual({
      label: "KLOK",
      value: "10:00",
      tone: "stop",
    });
  });

  it("telt af bij sporten die aftellen", () => {
    const face = deckFace("/timer/toggle", ctx({ sport: "BASKETBALL", periodDurationSec: 600 }, { timerBaseSec: 30 }));
    expect(face.value).toBe("09:30");
  });

  it("is dood bij een sport zonder wedstrijdklok", () => {
    expect(deckFace("/timer/toggle", ctx({ sport: "VOLLEYBALL" })).tone).toBe("off");
  });
});

describe("score", () => {
  it("toont de stand en de korte clubnaam", () => {
    const c = ctx({ homeScore: 2, awayScore: 1, homeName: "kvm", awayName: "Racing Club Genk" });
    expect(deckFace("/score/home/up", c)).toEqual({ label: "KVM +1", value: "2", tone: "home" });
    expect(deckFace("/score/away/up", c)).toEqual({ label: "UIT +1", value: "1", tone: "away" });
    expect(deckFace("/score/home/down", c)).toEqual({ label: "KVM −1", value: "2", tone: "idle" });
  });

  it("is dood zonder wedstrijd en voor +2 bij voetbal", () => {
    expect(deckFace("/score/home/up", ctx(null)).tone).toBe("off");
    expect(deckFace("/score/home/plus2", ctx()).tone).toBe("off");
    expect(deckFace("/score/home/plus2", ctx({ sport: "BASKETBALL", homeScore: 41 }))).toEqual({
      label: "THUIS +2",
      value: "41",
      tone: "home",
    });
  });
});

describe("wedstrijdverloop", () => {
  it("zegt welke periode volgt", () => {
    expect(deckFace("/period/next", ctx({ status: "PREMATCH" }))).toEqual({
      label: "VOLGENDE",
      value: "1E HELFT",
      tone: "info",
    });
    expect(deckFace("/period/next", ctx({ status: "SECOND_HALF", currentPeriod: 2 })).value).toBe("VERL. 1");
    expect(deckFace("/period/next", ctx({ sport: "BASKETBALL", currentPeriod: 2 })).value).toBe("Q3");
    expect(deckFace("/period/next", ctx({ status: "FULL_TIME" })).tone).toBe("off");
  });

  it("toont in de rust de pauzeklok, of dat dezelfde knop hervat", () => {
    expect(deckFace("/break", ctx()).tone).toBe("idle");
    expect(deckFace("/break", ctx({ status: "HALF_TIME" }))).toEqual({ label: "RUST", value: "HERVAT", tone: "warn" });
    const counting = ctx({ status: "HALF_TIME" }, {
      breakRunning: true,
      breakBaseSec: 120,
      breakStartedAt: new Date(NOW - 30_000).toISOString(),
    });
    expect(deckFace("/break", counting).value).toBe("1:30");
  });

  it("kleurt Einde rood als de wedstrijd gedaan is", () => {
    expect(deckFace("/fulltime", ctx()).tone).toBe("idle");
    expect(deckFace("/fulltime", ctx({ status: "FULL_TIME" })).tone).toBe("stop");
  });
});

describe("scherm", () => {
  it("kleurt de keuze die nu op het scherm staat", () => {
    expect(deckFace("/display/board", ctx({}, { mode: "MATCH" })).tone).toBe("go");
    expect(deckFace("/display/sponsors", ctx({}, { mode: "MATCH" })).tone).toBe("idle");
    expect(deckFace("/display/sponsors", ctx({}, { mode: "SPONSOR_ROTATION" })).tone).toBe("go");
    expect(deckFace("/blackout", ctx({}, { mode: "BLACKOUT" }))).toEqual({ label: "ZWART", value: "", tone: "stop" });
  });
});

describe("basketknoppen", () => {
  const basket = { sport: "BASKETBALL", homeTimeouts: 1, homeFouls: 3 };

  it("toont de shotclock en de presets", () => {
    const running = ctx(basket, {
      shotClockRunning: true,
      shotClockBaseSec: 24,
      shotClockStartedAt: new Date(NOW - 4_000).toISOString(),
    });
    expect(deckFace("/shotclock/toggle", running)).toEqual({ label: "SHOT", value: "20", tone: "go" });
    expect(deckFace("/shotclock/reset/14", ctx(basket))).toEqual({ label: "SHOT", value: "14", tone: "info" });
    expect(deckFace("/shotclock/toggle", ctx()).tone).toBe("off");
  });

  it("toont genomen time-outs, en de klok zodra er een loopt", () => {
    expect(deckFace("/timeout/home", ctx(basket))).toEqual({ label: "T-O THUIS", value: "1/2", tone: "idle" });
    const running = ctx(basket, {
      timeoutRunning: true,
      timeoutSide: "home",
      timeoutBaseSec: 60,
      timeoutStartedAt: new Date(NOW - 15_000).toISOString(),
    });
    expect(deckFace("/timeout/home", running)).toEqual({ label: "T-O THUIS", value: "0:45", tone: "warn" });
    expect(deckFace("/timeout/away", running).tone).toBe("idle");
    expect(deckFace("/timeout/clear", running).tone).toBe("warn");
    expect(deckFace("/timeout/home", ctx()).tone).toBe("off");
  });

  it("toont de teamfouten", () => {
    expect(deckFace("/foul/home/up", ctx(basket))).toEqual({ label: "FOUT THUIS +", value: "3", tone: "idle" });
    expect(deckFace("/foul/home/up", ctx({ sport: "HOCKEY" })).label).toBe("STRAF THUIS +");
  });
});

describe("extra tijd", () => {
  it("toont de minuten bij voetbal en is dood bij andere sporten", () => {
    expect(deckFace("/addedtime/up", ctx({}, { addedTimeMinutes: 3 }))).toEqual({
      label: "EXTRA +1",
      value: "+3'",
      tone: "idle",
    });
    expect(deckFace("/addedtime/up", ctx({ sport: "BASKETBALL" })).tone).toBe("off");
  });
});

describe("studio-knoppen", () => {
  const stream: DeckStream = {
    running: true,
    recording: false,
    scenes: [
      { name: "Hoofdcamera", program: true, preview: false },
      { name: "Tribune", program: false, preview: true },
    ],
    slots: [createStreamDeckSlot({ id: "timer", mode: "toggle" }, "Mijn klok"), createStreamDeckSlot({ id: "cut" })],
  };

  it("toont live, opname en welke bron in beeld staat", () => {
    const c = ctx({}, {}, stream);
    expect(deckFace("/stream/toggle", c)).toEqual({ label: "ON AIR", value: "", tone: "stop" });
    expect(deckFace("/record/toggle", c).tone).toBe("idle");
    expect(deckFace("/input/1", c)).toEqual({ label: "PGM", value: "Hoofdcamera", tone: "stop" });
    expect(deckFace("/input/2", c)).toEqual({ label: "NEXT", value: "Tribune", tone: "go" });
    expect(deckFace("/input/3", c).tone).toBe("off");
  });

  it("toont achter een eigen knop de functie, met het eigen label", () => {
    const c = ctx({}, { timerBaseSec: 61 }, stream);
    expect(deckFace("/key/1", c)).toEqual({ label: "MIJN KLOK", value: "01:01", tone: "stop" });
    expect(deckFace("/key/2", c).label).toBe("CUT");
    expect(deckFace("/key/9", c)).toEqual({ label: "KNOP 9", value: "", tone: "off" });
  });
});

describe("beeld", () => {
  it("tekent een geldige SVG en ontsnapt tekens uit clubnamen", () => {
    const svg = deckFaceSvg({ label: `A&B <"x">`, value: "1", tone: "home" });
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain("A&amp;B &lt;&quot;x&quot;&gt;");
    expect(svg).not.toContain(`<"x">`);
  });

  it("verdeelt een lang label zonder waarde over twee regels", () => {
    expect(deckFaceSvg({ label: "SCOREBORD", value: "", tone: "idle" }).match(/<text /g)).toHaveLength(1);
    expect(deckFaceSvg({ label: "T-O STOP", value: "", tone: "idle" }).match(/<text /g)).toHaveLength(1);
    expect(deckFaceSvg({ label: "AUSZEIT STOP", value: "", tone: "idle" }).match(/<text /g)).toHaveLength(2);
  });

  it("geeft een onbekend pad een dode knop", () => {
    expect(deckFace("/nope", ctx())).toEqual({ label: "?", value: "", tone: "off" });
    expect(deckFaces(["/constructor"], ctx()).faces["/constructor"]?.svg).toContain("?");
  });

  it("verandert de vingerafdruk alleen als een knop er anders uitziet", () => {
    const paths = ["/timer/toggle", "/score/home/up", "/timer/toggle"];
    const first = deckFaces(paths, ctx({ homeScore: 1 }));
    expect(Object.keys(first.faces)).toEqual(["/timer/toggle", "/score/home/up"]);
    expect(deckFaces(paths, ctx({ homeScore: 1 })).etag).toBe(first.etag);
    expect(deckFaces(paths, ctx({ homeScore: 2 })).etag).not.toBe(first.etag);
    // Een andere set knoppen is ook een ander antwoord, ook al staat er hetzelfde op.
    expect(deckFaces(["/timer/toggle"], ctx({ homeScore: 1 })).etag).not.toBe(first.etag);
  });
});
