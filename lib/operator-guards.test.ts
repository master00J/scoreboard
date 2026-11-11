import { describe, expect, it } from "vitest";
import { createRepeatGuard, playerIntroIntervalSec } from "./operator-guards";

describe("createRepeatGuard", () => {
  it("laat de eerste klik door en houdt een dubbelklik op dezelfde knop tegen", () => {
    let t = 1000;
    const accept = createRepeatGuard(250, () => t);
    expect(accept("home:+2")).toBe(true);
    t += 120;
    expect(accept("home:+2")).toBe(false);
  });

  it("laat een tweede bewuste klik na het venster weer door", () => {
    let t = 0;
    const accept = createRepeatGuard(250, () => t);
    expect(accept("home:+1")).toBe(true);
    t = 250;
    expect(accept("home:+1")).toBe(true);
  });

  it("meet vanaf de laatste doorgelaten klik, niet vanaf een geweigerde", () => {
    let t = 0;
    const accept = createRepeatGuard(250, () => t);
    expect(accept("k")).toBe(true);
    t = 200;
    expect(accept("k")).toBe(false);
    t = 300;
    expect(accept("k")).toBe(true);
  });

  it("houdt knoppen uit elkaar", () => {
    let t = 0;
    const accept = createRepeatGuard(250, () => t);
    expect(accept("home:+2")).toBe(true);
    t = 50;
    expect(accept("away:+2")).toBe(true);
    expect(accept("home:+3")).toBe(true);
  });

  it("blokkeert niet als de klok terugloopt", () => {
    let t = 5000;
    const accept = createRepeatGuard(250, () => t);
    expect(accept("k")).toBe(true);
    t = 100;
    expect(accept("k")).toBe(true);
  });
});

describe("playerIntroIntervalSec", () => {
  it("laat een geldige waarde staan", () => {
    expect(playerIntroIntervalSec(3)).toBe(3);
    expect(playerIntroIntervalSec(1.5)).toBe(1.5);
  });

  it("valt terug op de standaard bij een leeg veld, 0 of onzin", () => {
    expect(playerIntroIntervalSec(Number(""))).toBe(3);
    expect(playerIntroIntervalSec(0)).toBe(3);
    expect(playerIntroIntervalSec(-4)).toBe(3);
    expect(playerIntroIntervalSec(Number.NaN)).toBe(3);
    expect(playerIntroIntervalSec("abc")).toBe(3);
  });

  it("begrenst op 1 tot 30 seconden", () => {
    expect(playerIntroIntervalSec(0.2)).toBe(1);
    expect(playerIntroIntervalSec(120)).toBe(30);
  });
});
