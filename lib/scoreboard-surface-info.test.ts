import { describe, expect, it } from "vitest";
import type { ElementSurface } from "./scoreboard-elements";
import {
  surfaceInfo,
  surfacesForDevice,
  tryOnScreenMatchesReality,
} from "./scoreboard-surface-info";

const ALL: ElementSurface[] = ["sponsor", "full", "stream", "streamBreak"];

describe("waar een vlak terechtkomt", () => {
  it("scheidt het stadionscherm van de livestream", () => {
    expect(surfacesForDevice(ALL, "wall")).toEqual(["sponsor", "full"]);
    expect(surfacesForDevice(ALL, "stream")).toEqual(["stream", "streamBreak"]);
  });

  it("heeft voor elk vlak een naam én een wanneer", () => {
    // Zonder de "wanneer" ziet een tab er hetzelfde uit als de andere drie, en dat was de val.
    for (const surface of ALL) {
      const info = surfaceInfo(surface);
      expect(info.labelKey).toMatch(/^setup\./);
      expect(info.whenKey).toMatch(/^setup\.themeSurfaceWhen/);
    }
    expect(new Set(ALL.map((s) => surfaceInfo(s).whenKey)).size).toBe(ALL.length);
  });
});

describe("eerlijkheid van Probeer op scherm", () => {
  it("klopt alleen voor het volledige scorebord", () => {
    // De proef dwingt het bewerkte vlak af. Alleen `full` is ook wat de wand tijdens een gewone
    // wedstrijd toont; bij de rest bevestigt de proef iets dat de kijker zo nooit ziet.
    expect(tryOnScreenMatchesReality("full")).toBe(true);
    expect(tryOnScreenMatchesReality("sponsor")).toBe(false);
    expect(tryOnScreenMatchesReality("stream")).toBe(false);
    expect(tryOnScreenMatchesReality("streamBreak")).toBe(false);
  });
});
