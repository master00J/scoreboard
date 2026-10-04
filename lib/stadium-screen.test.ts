import { describe, expect, it } from "vitest";
import {
  choiceFromScreen,
  normalizeStadiumScreenChoice,
  numberScreens,
  pickStadiumScreen,
  type ScreenInfo,
} from "./stadium-screen";

const laptop: ScreenInfo = { id: 1, label: "Laptop", x: 0, y: 0, width: 1920, height: 1080, primary: true };
const led: ScreenInfo = { id: 2, label: "NovaStar", x: 1920, y: 0, width: 1920, height: 1080, primary: false };
const beamer: ScreenInfo = { id: 3, label: "Beamer", x: 3840, y: 0, width: 1280, height: 720, primary: false };

describe("monitor voor het stadionscherm", () => {
  it("neemt zonder keuze de monitor die niet het hoofdscherm is", () => {
    expect(pickStadiumScreen([laptop, led], null)).toEqual({ screen: led, via: "auto" });
    expect(pickStadiumScreen([laptop], null)).toEqual({ screen: laptop, via: "auto" });
  });

  it("volgt de keuze van de operator, ook als die het hoofdscherm of de derde monitor is", () => {
    expect(pickStadiumScreen([laptop, led, beamer], choiceFromScreen(beamer))).toEqual({ screen: beamer, via: "choice" });
    expect(pickStadiumScreen([laptop, led], choiceFromScreen(laptop))).toEqual({ screen: laptop, via: "choice" });
  });

  it("herkent de monitor aan naam en resolutie als Windows hem een nieuw id gaf", () => {
    const reconnected = { ...led, id: 77 };
    expect(pickStadiumScreen([laptop, reconnected, beamer], choiceFromScreen(led))).toEqual({
      screen: reconnected,
      via: "choice",
    });
  });

  it("gokt niet tussen twee gelijke monitoren", () => {
    const twinA = { ...led, id: 50 };
    const twinB = { ...led, id: 51, x: 3840 };
    expect(pickStadiumScreen([laptop, twinA, twinB], choiceFromScreen(led))).toEqual({ screen: twinA, via: "fallback" });
  });

  it("valt terug op de automatische regel als de gekozen monitor niet is aangesloten", () => {
    expect(pickStadiumScreen([laptop, led], choiceFromScreen(beamer))).toEqual({ screen: led, via: "fallback" });
    expect(pickStadiumScreen([laptop], choiceFromScreen(led))).toEqual({ screen: laptop, via: "fallback" });
  });

  it("geeft niets terug zonder monitoren", () => {
    expect(pickStadiumScreen([], null)).toBeNull();
  });

  it("nummert van links naar rechts", () => {
    expect(numberScreens([beamer, laptop, led]).map((screen) => [screen.number, screen.label])).toEqual([
      [1, "Laptop"],
      [2, "NovaStar"],
      [3, "Beamer"],
    ]);
  });

  it("leest alleen een volledige keuze uit het bestand", () => {
    expect(normalizeStadiumScreenChoice({ id: 2, label: "NovaStar", width: 1920, height: 1080 })).toEqual(choiceFromScreen(led));
    expect(normalizeStadiumScreenChoice({ id: "x" })).toBeNull();
    expect(normalizeStadiumScreenChoice(null)).toBeNull();
    expect(normalizeStadiumScreenChoice([2])).toBeNull();
  });
});
