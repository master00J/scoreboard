import { describe, expect, it } from "vitest";
import { createElement, isStreamSurface } from "./scoreboard-elements";
import {
  DEFAULT_STREAM_SLOTS,
  mergeScoreboardTheme,
  scoreboardThemeSavePayload,
  withSurfaceElements,
} from "./scoreboard-theme";
import { applyTemplateToThemeJson, sameVisualLayout, sanitizeTemplateThemeJson } from "./scoreboard-templates";
import { mergeLivestreamSettings } from "./livestream";
import { streamCustomSurface } from "./stream-program-layout";

describe("keuze tussen vaste lagen en eigen indeling", () => {
  it("houdt bestaande streams bij de score-widget en het sponsorscherm", () => {
    const settings = mergeLivestreamSettings({ bitrateKbps: 6000 });
    expect(settings).toMatchObject({ overlayPlay: "widget", overlayBreak: "sponsors" });
    expect(streamCustomSurface(settings, "play")).toBeNull();
    expect(streamCustomSurface(settings, "break")).toBeNull();
  });

  it("kiest per fase het juiste vlak", () => {
    const play = mergeLivestreamSettings({ overlayPlay: "custom" });
    expect(streamCustomSurface(play, "play")).toBe("stream");
    expect(streamCustomSurface(play, "break")).toBeNull();
    const both = mergeLivestreamSettings({ overlayPlay: "custom", overlayBreak: "custom" });
    expect(streamCustomSurface(both, "break")).toBe("streamBreak");
  });

  it("negeert onbekende waarden", () => {
    const settings = mergeLivestreamSettings({ overlayPlay: "x" as never, overlayBreak: "y" as never });
    expect(settings).toMatchObject({ overlayPlay: "widget", overlayBreak: "sponsors" });
  });
});

const CLASSIC_IDS = ["sponsor", "home", "homeScore", "away", "awayScore", "clock", "shotClock"];

describe("livestream-overlay als indelingsvlak", () => {
  it("kent twee stream-vlakken, los van het stadionscherm", () => {
    expect(isStreamSurface("stream")).toBe(true);
    expect(isStreamSurface("streamBreak")).toBe(true);
    expect(isStreamSurface("sponsor")).toBe(false);
    expect(isStreamSurface("full")).toBe(false);
  });

  it("geeft een club zonder overlay een standaardindeling met leesbare vlakken", () => {
    const theme = mergeScoreboardTheme(null);
    for (const surface of ["stream", "streamBreak"] as const) {
      expect(theme.elements[surface].map((e) => e.id)).toEqual(CLASSIC_IDS);
      for (const element of theme.elements[surface]) {
        if (element.type === "media") expect(element.style).toBeUndefined();
        else expect(element.style?.background).toBeTruthy();
      }
    }
    // De sponsorplaat is 16:9 op het 1920x1080-canvas van de stream.
    const plate = theme.elements.stream.find((e) => e.id === "sponsor")!;
    expect(plate.w).toBe(plate.h);
    expect(plate).toMatchObject(DEFAULT_STREAM_SLOTS.sponsor);
  });

  it("bewaart een eigen overlay, ook met vrije elementen", () => {
    const base = mergeScoreboardTheme(null);
    const text = { ...createElement("text", "t1"), text: "Welkom" };
    const list = [...base.elements.stream.map((e) => (e.id === "clock" ? { ...e, x: 50, y: 80 } : e)), text];
    const saved = withSurfaceElements(base, "stream", list);
    const reread = mergeScoreboardTheme(JSON.stringify(scoreboardThemeSavePayload(saved)));
    expect(reread.elements.stream.find((e) => e.id === "clock")).toMatchObject({ x: 50, y: 80 });
    expect(reread.elements.stream.find((e) => e.id === "t1")).toMatchObject({ type: "text", text: "Welkom" });
  });

  it("verandert niets aan het stadionscherm als je de overlay indeelt", () => {
    const base = mergeScoreboardTheme(JSON.stringify({ layoutMode: "auto" }));
    const moved = base.elements.streamBreak.map((e) => ({ ...e, x: 1, y: 1 }));
    const next = withSurfaceElements(base, "streamBreak", moved);
    expect(next.layoutMode).toBe(base.layoutMode);
    expect(next.slots).toEqual(base.slots);
    expect(next.fullSlots).toEqual(base.fullSlots);
    expect(next.elements.sponsor).toEqual(base.elements.sponsor);
    expect(next.elements.full).toEqual(base.elements.full);
  });

  it("laat de stadionindeling van een bestaande club exact gelijk", () => {
    const saved = JSON.stringify({ layoutMode: "custom", slots: { clock: { x: 30, y: 2, w: 26, h: 22 } } });
    const theme = mergeScoreboardTheme(saved);
    expect(theme.layoutMode).toBe("custom");
    expect(theme.elements.sponsor.find((e) => e.id === "clock")).toMatchObject({ x: 30, y: 2, w: 26, h: 22 });
  });

  it("houdt de overlay bij het kiezen van een indeling uit de bibliotheek", () => {
    const base = mergeScoreboardTheme(null);
    const mine = withSurfaceElements(
      base,
      "stream",
      base.elements.stream.map((e) => (e.id === "home" ? { ...e, x: 60 } : e)),
    );
    const currentJson = JSON.stringify(scoreboardThemeSavePayload(mine));
    const templateJson = JSON.stringify({ layoutMode: "full" });
    const applied = mergeScoreboardTheme(applyTemplateToThemeJson(currentJson, templateJson));
    expect(applied.layoutMode).toBe("full");
    expect(applied.elements.stream.find((e) => e.id === "home")).toMatchObject({ x: 60 });
  });

  it("telt een aanpassing aan de overlay niet als een andere stadionindeling", () => {
    const base = mergeScoreboardTheme(null);
    const before = JSON.stringify(scoreboardThemeSavePayload(base));
    const after = JSON.stringify(
      scoreboardThemeSavePayload(
        withSurfaceElements(base, "stream", base.elements.stream.map((e) => ({ ...e, y: 70 }))),
      ),
    );
    expect(sameVisualLayout(before, after)).toBe(true);
    expect(JSON.parse(sanitizeTemplateThemeJson(after)).elements.stream).toBeUndefined();
  });
});
