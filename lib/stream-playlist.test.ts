import { describe, expect, it } from "vitest";
import {
  appendPlaylistItems,
  createPlaylistItem,
  defaultPlaylistDurationSec,
  mergePlaylistItems,
  movePlaylistItem,
  nextPlaylistIndex,
  playlistHoldMs,
  playlistItemsFromPaths,
  PLAYLIST_IMAGE_DURATION_SEC,
  PLAYLIST_ITEM_LIMIT,
  sanitizePlaylistDurationSec,
} from "./stream-playlist";

describe("livestream playlist", () => {
  it("zet een afbeelding standaard op 8 seconden en een video op tot het einde", () => {
    expect(defaultPlaylistDurationSec("C:\\a.jpg")).toBe(PLAYLIST_IMAGE_DURATION_SEC);
    expect(defaultPlaylistDurationSec("C:\\b.mp4")).toBe(0);
  });

  it("houdt video-duur 0 (heel bestand) en klempt afbeeldingen tot minstens 1 seconde", () => {
    expect(sanitizePlaylistDurationSec(0, "C:\\a.mp4")).toBe(0);
    expect(sanitizePlaylistDurationSec(12.4, "C:\\a.mp4")).toBe(12);
    expect(sanitizePlaylistDurationSec(0, "C:\\a.png")).toBe(1);
    expect(sanitizePlaylistDurationSec(-3, "C:\\a.png")).toBe(1);
    expect(sanitizePlaylistDurationSec(99999, "C:\\a.png")).toBe(3600);
  });

  it("gooit ongeldige paden weg en bewaart de volgorde", () => {
    const items = mergePlaylistItems([
      { path: "javascript:alert(1)", durationSec: 4 },
      { id: "one", path: "C:\\intro.jpg", durationSec: 5 },
      { path: "https://evil.example/x.mp4" },
      { id: "two", path: "C:\\clip.mp4", durationSec: 0 },
    ]);
    expect(items.map((item) => item.path)).toEqual(["C:\\intro.jpg", "C:\\clip.mp4"]);
    expect(items[0]?.durationSec).toBe(5);
    expect(items[1]?.durationSec).toBe(0);
  });

  it("knipt af bij het maximum aantal items", () => {
    const paths = Array.from({ length: PLAYLIST_ITEM_LIMIT + 8 }, (_, i) => `C:\\f${i}.jpg`);
    expect(playlistItemsFromPaths(paths)).toHaveLength(PLAYLIST_ITEM_LIMIT);
  });

  it("voegt items achteraan toe en schuift ze omhoog of omlaag", () => {
    const a = createPlaylistItem({ id: "a", path: "C:\\a.jpg" })!;
    const b = createPlaylistItem({ id: "b", path: "C:\\b.jpg" })!;
    const c = createPlaylistItem({ id: "c", path: "C:\\c.jpg" })!;
    const items = appendPlaylistItems([a], [b, c]);
    expect(items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(movePlaylistItem(items, "c", -1).map((item) => item.id)).toEqual(["a", "c", "b"]);
    expect(movePlaylistItem(items, "a", -1).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("gaat naar het volgende item en herhaalt alleen als dat aanstaat", () => {
    expect(nextPlaylistIndex(0, 3, true)).toBe(1);
    expect(nextPlaylistIndex(2, 3, true)).toBe(0);
    expect(nextPlaylistIndex(2, 3, false)).toBeNull();
    expect(nextPlaylistIndex(0, 0, true)).toBeNull();
  });

  it("houdt een afbeelding een vast aantal milliseconden vast en een video zonder duur tot het einde", () => {
    expect(playlistHoldMs({ id: "i", path: "C:\\a.jpg", durationSec: 5 })).toBe(5000);
    expect(playlistHoldMs({ id: "v", path: "C:\\a.mp4", durationSec: 0 })).toBeNull();
    expect(playlistHoldMs({ id: "v", path: "C:\\a.mp4", durationSec: 9 })).toBe(9000);
  });
});
