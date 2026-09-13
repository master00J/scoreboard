import { describe, expect, it } from "vitest";
import {
  MAX_QUICK_MEDIA_BUTTON_LABEL_LENGTH,
  normalizeQuickMediaButtonLabel,
  quickMediaButtonLabel,
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
