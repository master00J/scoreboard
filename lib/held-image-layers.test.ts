import { describe, expect, it } from "vitest";
import { imageLayersAfterDecoded, imageLayersAfterPainted } from "./held-image-layers";

describe("held image layers", () => {
  it("toont het eerste beeld zodra het gedecodeerd is", () => {
    expect(imageLayersAfterDecoded([], "a.png")).toEqual(["a.png"]);
  });

  it("laat het vorige beeld onder het nieuwe staan tot dat geschilderd is", () => {
    const decoded = imageLayersAfterDecoded(["a.png"], "b.png");
    expect(decoded).toEqual(["a.png", "b.png"]);
    expect(imageLayersAfterPainted(decoded, "b.png")).toEqual(["b.png"]);
  });

  it("houdt nooit meer dan twee beelden vast bij snelle wissels", () => {
    expect(imageLayersAfterDecoded(["a.png", "b.png"], "c.png")).toEqual(["b.png", "c.png"]);
  });

  it("laat een te laat geschilderd beeld niets weghalen", () => {
    expect(imageLayersAfterPainted(["b.png", "c.png"], "b.png")).toEqual(["b.png", "c.png"]);
  });

  it("verandert niets als hetzelfde beeld opnieuw komt", () => {
    expect(imageLayersAfterDecoded(["a.png"], "a.png")).toEqual(["a.png"]);
  });
});
