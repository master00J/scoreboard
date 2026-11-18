import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { toFileUrl } from "./media-url";

describe("toFileUrl", () => {
  it("keeps the drive letter and slashes and encodes spaces", () => {
    expect(toFileUrl("C:\\Clips\\Goal video.mp4")).toBe("file:///C:/Clips/Goal%20video.mp4");
  });

  it("keeps #, ? and % in the file name instead of turning them into URL syntax", () => {
    const url = toFileUrl("C:\\Sponsors\\Sponsor #1 ? 50% off.png");
    expect(url).toBe("file:///C:/Sponsors/Sponsor%20%231%20%3F%2050%25%20off.png");
    const parsed = new URL(url);
    expect(parsed.hash).toBe("");
    expect(parsed.search).toBe("");
  });

  it("round-trips paths with special and non-ASCII characters", () => {
    const paths = [
      "C:\\Média\\Café Fête #2\\clip ü?.mp4",
      "D:\\uploads\\100% Antwerp & co;=+$@,.png",
      "C:\\Clips\\已经 ok\\a%20b.mp4",
    ];
    for (const p of paths) {
      expect(fileURLToPath(toFileUrl(p), { windows: true })).toBe(p);
    }
  });

  it("encodes Unix-style absolute paths per segment", () => {
    const url = toFileUrl("/Users/club/Sponsor #1.png");
    expect(url).toBe("file:///Users/club/Sponsor%20%231.png");
    expect(fileURLToPath(url, { windows: false })).toBe("/Users/club/Sponsor #1.png");
  });

  it("keeps the same URL as before for ordinary paths", () => {
    const p = "C:\\Users\\RAFC\\AppData\\Roaming\\uploads\\abc123.mp4";
    expect(toFileUrl(p)).toBe(encodeURI(`file:///${p.replace(/\\/g, "/")}`));
  });
});
