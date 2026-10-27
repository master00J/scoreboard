import { describe, expect, it } from "vitest";
import { keepCaptureThumbnails } from "./desktop-capture-sources";

describe("bronnenlijst zonder schermafdrukken verversen", () => {
  it("houdt bekende miniaturen en laat gesloten vensters verdwijnen", () => {
    const previous = [
      { id: "window:1", name: "OBS", thumbnailDataUrl: "data:image/png;base64,AAA" },
      { id: "window:2", name: "Weg", thumbnailDataUrl: "data:image/png;base64,BBB" },
    ];
    const fresh = [
      { id: "window:1", name: "OBS 30.1", thumbnailDataUrl: null },
      { id: "window:3", name: "Nieuw", thumbnailDataUrl: null },
    ];
    expect(keepCaptureThumbnails(fresh, previous)).toEqual([
      { id: "window:1", name: "OBS 30.1", thumbnailDataUrl: "data:image/png;base64,AAA" },
      { id: "window:3", name: "Nieuw", thumbnailDataUrl: null },
    ]);
  });

  it("neemt een nieuwe miniatuur over als die er is", () => {
    const out = keepCaptureThumbnails(
      [{ id: "screen:0", name: "Scherm 1", thumbnailDataUrl: "data:new" }],
      [{ id: "screen:0", thumbnailDataUrl: "data:old" }],
    );
    expect(out[0]?.thumbnailDataUrl).toBe("data:new");
  });
});
