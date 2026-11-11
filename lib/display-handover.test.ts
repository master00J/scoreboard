import { describe, expect, it } from "vitest";
import { HELD_IMAGE_HANDOVER_MS, displayModeToShow, heldImageToContinue } from "./display-handover";

describe("displayModeToShow", () => {
  it("houdt het programma vast tot het bestand van de losse clip bekend is", () => {
    expect(
      displayModeToShow({
        mode: "SPONSOR",
        activeMediaId: "clip-1",
        settledMediaId: null,
        shownMode: "SPONSOR_ROTATION",
      }),
    ).toBe("SPONSOR_ROTATION");
  });

  it("start de losse clip zodra het opzoeken klaar is, ook als het bestand ontbreekt", () => {
    expect(
      displayModeToShow({
        mode: "SPONSOR",
        activeMediaId: "clip-1",
        settledMediaId: "clip-1",
        shownMode: "SPONSOR_ROTATION",
      }),
    ).toBe("SPONSOR");
  });

  it("laat de lopende clip staan tot de volgende bekend is", () => {
    expect(
      displayModeToShow({
        mode: "SPONSOR",
        activeMediaId: "clip-2",
        settledMediaId: "clip-1",
        shownMode: "SPONSOR",
      }),
    ).toBe("SPONSOR");
  });

  it("wacht niet als er nog niets op het scherm stond", () => {
    expect(
      displayModeToShow({ mode: "SPONSOR", activeMediaId: "clip-1", settledMediaId: null, shownMode: null }),
    ).toBe("SPONSOR");
  });

  it("wacht niet zonder media of bij een andere modus", () => {
    expect(
      displayModeToShow({ mode: "SPONSOR", activeMediaId: null, settledMediaId: null, shownMode: "MATCH" }),
    ).toBe("SPONSOR");
    expect(
      displayModeToShow({ mode: "GOAL", activeMediaId: "clip-1", settledMediaId: null, shownMode: "MATCH" }),
    ).toBe("GOAL");
    expect(
      displayModeToShow({
        mode: "SPONSOR_ROTATION",
        activeMediaId: null,
        settledMediaId: "clip-1",
        shownMode: "SPONSOR",
      }),
    ).toBe("SPONSOR_ROTATION");
  });
});

describe("heldImageToContinue", () => {
  it("sluit aan op een beeld dat er nog staat", () => {
    expect(heldImageToContinue({ src: "a.png", leftAtMs: null }, 5_000)).toBe("a.png");
  });

  it("sluit aan op een beeld dat net verdween", () => {
    expect(heldImageToContinue({ src: "a.png", leftAtMs: 1_000 }, 1_000)).toBe("a.png");
    expect(heldImageToContinue({ src: "a.png", leftAtMs: 1_000 }, 1_000 + HELD_IMAGE_HANDOVER_MS)).toBe("a.png");
  });

  it("begint leeg na een echte pauze of zonder vorig beeld", () => {
    expect(heldImageToContinue({ src: "a.png", leftAtMs: 1_000 }, 1_001 + HELD_IMAGE_HANDOVER_MS)).toBeNull();
    expect(heldImageToContinue(undefined, 1_000)).toBeNull();
    expect(heldImageToContinue({ src: "", leftAtMs: null }, 1_000)).toBeNull();
  });
});
