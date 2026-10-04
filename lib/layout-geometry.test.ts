import { describe, expect, it } from "vitest";
import { resizeBox, snapMovedBox, snapResizedBox } from "./layout-geometry";

describe("magnetisch uitlijnen", () => {
  it("laat het midden van een vak naar het midden van het canvas springen", () => {
    const moved = snapMovedBox({ x: 39.7, y: 20, w: 20, h: 10 }, []);
    expect(moved.x).toBeCloseTo(40, 5);
  });

  it("lijnt uit op de rand van een ander vak", () => {
    const other = { x: 12.3, y: 40, w: 20, h: 10 };
    const moved = snapMovedBox({ x: 12.6, y: 5.2, w: 14, h: 9 }, [other]);
    expect(moved.x).toBeCloseTo(12.3, 5);
  });

  it("laat een vak staan dat nergens dichtbij is", () => {
    const box = { x: 14.2, y: 23.7, w: 7.3, h: 5.1 };
    expect(snapMovedBox(box, [])).toEqual(box);
  });

  it("laat bij vergroten alleen de getrokken rand springen", () => {
    const resized = snapResizedBox({ x: 10, y: 10, w: 39.8, h: 20 }, "e", []);
    expect(resized).toEqual({ x: 10, y: 10, w: 40, h: 20 });
    const untouched = snapResizedBox({ x: 10.2, y: 10, w: 25, h: 20 }, "s", []);
    expect(untouched.x).toBe(10.2);
  });
});

describe("vergroten", () => {
  it("trekt vrij aan elke rand", () => {
    expect(resizeBox({ x: 10, y: 10, w: 20, h: 20 }, "e", 5, 99)).toEqual({ x: 10, y: 10, w: 25, h: 20 });
    expect(resizeBox({ x: 10, y: 10, w: 20, h: 20 }, "nw", -2, -3)).toEqual({ x: 8, y: 7, w: 22, h: 23 });
  });

  it("houdt op een 16:9-scherm breedte% en hoogte% gelijk", () => {
    const corner = resizeBox({ x: 20, y: 20, w: 40, h: 40 }, "se", 10, 4, 1);
    expect(corner).toEqual({ x: 20, y: 20, w: 50, h: 50 });
    const fromTopLeft = resizeBox({ x: 20, y: 20, w: 40, h: 40 }, "nw", -10, 0, 1);
    expect(fromTopLeft).toEqual({ x: 10, y: 10, w: 50, h: 50 });
  });

  it("houdt 16:9 vast op een ander schermformaat", () => {
    // Strip 1920×360: hoogte% = breedte% × 3.
    const wide = resizeBox({ x: 0, y: 0, w: 10, h: 30 }, "e", 5, 0, 3);
    expect(wide).toEqual({ x: 0, y: 0, w: 15, h: 45 });
    const tall = resizeBox({ x: 0, y: 0, w: 10, h: 30 }, "s", 0, 30, 3);
    expect(tall).toEqual({ x: 0, y: 0, w: 20, h: 60 });
  });
});
