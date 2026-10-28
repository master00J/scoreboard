import { describe, expect, it } from "vitest";
import {
  blendBgra,
  clampTransitionMs,
  drawOverBgra,
  isNearlyBlackBgra,
  letterboxRect,
  parseStreamTransition,
  placeBgra,
  solidBgra,
  transitionDurationOptions,
  transitionMix,
} from "./stream-transition";

const px = (b: number, g: number, r: number, a = 255) => [b, g, r, a];

describe("overgangen in de livestream", () => {
  it("knipt meteen bij een cut en na afloop", () => {
    expect(transitionMix("cut", 0, 600)).toEqual({ done: true });
    expect(transitionMix("fade", 600, 600)).toEqual({ done: true });
  });

  it("vloeit bij fade geleidelijk van oud naar nieuw", () => {
    const start = transitionMix("fade", 0, 600);
    const mid = transitionMix("fade", 300, 600);
    expect(start).toMatchObject({ done: false, a: "from", b: "to", t: 0 });
    expect(mid).toMatchObject({ done: false, a: "from", b: "to" });
    expect((mid as { t: number }).t).toBeCloseTo(0.5, 5);
  });

  it("gaat bij logo via de clubkaart: eerst erheen, even stilstaan, dan naar de nieuwe bron", () => {
    expect(transitionMix("logo", 200, 1000)).toMatchObject({ a: "from", b: "card" });
    expect(transitionMix("logo", 500, 1000)).toEqual({ done: false, a: "card", b: "card", t: 1 });
    expect(transitionMix("logo", 800, 1000)).toMatchObject({ a: "card", b: "to" });
  });

  it("leest onbekende instellingen veilig in", () => {
    expect(parseStreamTransition("wipe")).toBe("fade");
    expect(parseStreamTransition("logo")).toBe("logo");
    expect(clampTransitionMs(50)).toBe(200);
    expect(clampTransitionMs(99_999)).toBe(3000);
    expect(clampTransitionMs("x")).toBe(600);
  });
});

describe("beelden mengen en plaatsen", () => {
  it("mengt twee BGRA-beelden per kanaal", () => {
    const a = Uint8Array.from([...px(0, 0, 0), ...px(200, 100, 50)]);
    const b = Uint8Array.from([...px(255, 255, 255), ...px(0, 100, 250)]);
    const out = new Uint8Array(a.length);
    blendBgra(out, a, b, 0);
    expect([...out]).toEqual([...a]);
    blendBgra(out, a, b, 1);
    expect([...out]).toEqual([...b]);
    blendBgra(out, a, b, 0.5);
    expect([...out.subarray(0, 4)]).toEqual([127, 127, 127, 255]);
    expect([...out.subarray(4, 8)]).toEqual([100, 100, 150, 255]);
  });

  it("mengt ook niet-uitgelijnde buffers correct", () => {
    const backing = new Uint8Array(13);
    const a = backing.subarray(1, 5);
    a.set(px(100, 100, 100));
    const b = Uint8Array.from(px(200, 200, 200));
    const out = new Uint8Array(4);
    blendBgra(out, a, b, 0.5);
    expect([...out]).toEqual([150, 150, 150, 255]);
  });

  it("mengt een 1080p-beeld snel genoeg voor 30 beeldjes per seconde", () => {
    const size = 1920 * 1080 * 4;
    const a = new Uint8Array(size).fill(10);
    const b = new Uint8Array(size).fill(200);
    const out = new Uint8Array(size);
    blendBgra(out, a, b, 0.3);
    const start = performance.now();
    for (let i = 0; i < 5; i++) blendBgra(out, a, b, i / 5);
    expect((performance.now() - start) / 5).toBeLessThan(25);
  });

  it("zet een breed stadionscherm met zwarte randen in 16:9, zoals ffmpeg", () => {
    expect(letterboxRect(1920, 1080, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(letterboxRect(3840, 1080, 1920, 1080)).toEqual({ x: 0, y: 270, w: 1920, h: 540 });
    expect(letterboxRect(1080, 1920, 1920, 1080)).toEqual({ x: 656, y: 0, w: 608, h: 1080 });
  });

  it("plaatst een beeld in een canvas", () => {
    const dst = new Uint8Array(4 * 4 * 4);
    const src = Uint8Array.from([...px(1, 2, 3), ...px(4, 5, 6)]);
    placeBgra(dst, 4, src, 2, 1, 1, 2);
    expect([...dst.subarray((2 * 4 + 1) * 4, (2 * 4 + 3) * 4)]).toEqual([...src]);
  });

  it("zet een transparant logo op de kaart", () => {
    const card = solidBgra(2, 1, "#000000");
    expect([...card.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
    const logo = Uint8Array.from([...px(200, 100, 50, 255), ...px(0, 0, 0, 0)]);
    drawOverBgra(card, 2, logo, 2, 1, 0, 0);
    expect([...card.subarray(0, 4)]).toEqual([200, 100, 50, 255]);
    expect([...card.subarray(4, 8)]).toEqual([0, 0, 0, 255]);
    const red = solidBgra(1, 1, "#ff0000");
    expect([...red]).toEqual([0, 0, 255, 255]);
  });
});

describe("duur van de overgang kiezen", () => {
  it("biedt vaste stappen en houdt een eigen waarde", () => {
    expect(transitionDurationOptions(600)).toEqual([300, 600, 1000, 1500, 2000]);
    expect(transitionDurationOptions(800)).toEqual([300, 600, 800, 1000, 1500, 2000]);
  });
});

describe("overgang wacht op echt beeld", () => {
  it("herkent een zwart beeld van een opstartende camera", () => {
    expect(isNearlyBlackBgra(solidBgra(1920, 1080, "#000000"))).toBe(true);
    expect(isNearlyBlackBgra(solidBgra(1920, 1080, "#020202"))).toBe(true);
    expect(isNearlyBlackBgra(solidBgra(1920, 1080, "#202020"))).toBe(false);
  });

  it("ziet een donker camerabeeld met wat licht niet als zwart", () => {
    const frame = solidBgra(640, 360, "#000000");
    for (let i = 0; i < frame.length; i += 4 * 3) {
      frame[i] = 40;
      frame[i + 1] = 40;
      frame[i + 2] = 40;
    }
    expect(isNearlyBlackBgra(frame)).toBe(false);
  });
});
