import { describe, expect, it } from "vitest";
import {
  MAX_QUICK_MEDIA_BUTTON_LABEL_LENGTH,
  MAX_QUICK_MEDIA_BUTTONS,
  normalizeQuickMediaButtonLabel,
  parseQuickMediaButtonIds,
  quickMediaButtonLabel,
  quickMediaButtons,
} from "./quick-media-button";

describe("quick media button labels", () => {
  it("normaliseert een operatornaam", () => {
    expect(normalizeQuickMediaButtonLabel("  Sponsor   hoofdtribune  ")).toBe(
      "Sponsor hoofdtribune",
    );
  });

  it("valt bij een lege naam terug op de mediatitel", () => {
    expect(quickMediaButtonLabel({ title: "bestand.mp4", quickButtonLabel: "   " })).toBe(
      "bestand.mp4",
    );
  });

  it("begrenst een knopnaam zodat de liveknop leesbaar blijft", () => {
    const label = normalizeQuickMediaButtonLabel("x".repeat(100));
    expect(label).toHaveLength(MAX_QUICK_MEDIA_BUTTON_LABEL_LENGTH);
  });
});

describe("vastgepinde media uit de regie", () => {
  it("houdt de volgorde van de regie en laat dubbels en vreemde waarden vallen", () => {
    expect(parseQuickMediaButtonIds(["cm2", "cm1", "cm2", 7, null, "", "../x", "cm3"])).toEqual(["cm2", "cm1", "cm3"]);
  });

  it("is leeg als er geen lijst komt", () => {
    expect(parseQuickMediaButtonIds(undefined)).toEqual([]);
    expect(parseQuickMediaButtonIds("cm1")).toEqual([]);
    expect(parseQuickMediaButtonIds({ 0: "cm1" })).toEqual([]);
  });

  it("onthoudt niet meer knoppen dan het maximum", () => {
    const many = Array.from({ length: MAX_QUICK_MEDIA_BUTTONS + 10 }, (_, i) => `cm${i}`);
    expect(parseQuickMediaButtonIds(many)).toHaveLength(MAX_QUICK_MEDIA_BUTTONS);
  });
});

describe("snelle knoppen zoals de regie ze toont", () => {
  const media = [
    { id: "cm1", title: "hymne-2026.mp4", quickButtonLabel: "Clublied" },
    { id: "cm2", title: "Evacuatie", quickButtonLabel: null },
    { id: "cm3", title: "Onweer" },
  ];

  it("volgt de volgorde waarin ze vastgepind zijn, niet die van de bibliotheek", () => {
    expect(quickMediaButtons(["cm3", "cm1", "cm2"], media)).toEqual([
      { id: "cm3", label: "Onweer" },
      { id: "cm1", label: "Clublied" },
      { id: "cm2", label: "Evacuatie" },
    ]);
  });

  it("slaat media over die er niet meer zijn, zodat de volgende knop opschuift zoals in de regie", () => {
    expect(quickMediaButtons(["weg", "cm2", "cm2", "cm1"], media).map((button) => button.id)).toEqual(["cm2", "cm1"]);
    expect(quickMediaButtons([], media)).toEqual([]);
  });
});
