import { describe, expect, it } from "vitest";
import { resolveStoredMediaPath } from "./media-file-path";

describe("resolveStoredMediaPath", () => {
  it("vertaalt /uploads/ naar de uploads-map, zoals het scherm afspeelt", () => {
    expect(resolveStoredMediaPath("/uploads/restored-clip.mp4", "C:\\Users\\club\\AppData\\uploads")).toBe(
      "C:\\Users\\club\\AppData\\uploads\\restored-clip.mp4",
    );
    expect(resolveStoredMediaPath("/uploads/compat/a-fd1.mp4", "C:\\data\\uploads\\")).toBe(
      "C:\\data\\uploads\\compat\\a-fd1.mp4",
    );
    expect(resolveStoredMediaPath("/uploads/a.png", "/home/club/uploads")).toBe("/home/club/uploads/a.png");
  });

  it("laat een volledig pad ongemoeid", () => {
    expect(resolveStoredMediaPath("D:\\Sponsors\\bank.mp4", "C:\\data\\uploads")).toBe("D:\\Sponsors\\bank.mp4");
    expect(resolveStoredMediaPath("/media/clips/a.mp4", "/data/uploads")).toBe("/media/clips/a.mp4");
  });

  it("geeft niets zonder uploads-map, voor een leeg pad of een pad dat uit de map wil", () => {
    expect(resolveStoredMediaPath("/uploads/a.mp4", null)).toBeNull();
    expect(resolveStoredMediaPath("", "C:\\data\\uploads")).toBeNull();
    expect(resolveStoredMediaPath(null, "C:\\data\\uploads")).toBeNull();
    expect(resolveStoredMediaPath("/uploads/../stadium.db", "C:\\data\\uploads")).toBeNull();
  });
});
