import { afterEach, describe, expect, it } from "vitest";
import {
  displayCopyFor,
  displayCopyKey,
  displayCopyMap,
  displayCopyNotNeededKey,
  displayCopyProgress,
  needsDisplayCopy,
  normalizeDisplayCopyHeight,
  setDisplayMediaCopies,
  type DisplayCopyRow,
} from "./display-copy";
import { mediaUrl } from "./media-url";

const keys: Record<string, string> = {
  "C:/clips/fhd.mp4": "fhd-v1",
  "C:/clips/hd.mp4": "hd-v1",
  "C:/clips/vervangen.mp4": "vervangen-v2",
};
const currentKey = (p: string) => keys[p] ?? null;
const exists = (p: string) => !p.includes("weg");

const rows: DisplayCopyRow[] = [
  { path: "C:/clips/fhd.mp4", type: "VIDEO", displayCopyPath: "C:/uploads/display-720p/fhd-720p.mp4", displayCopyKey: displayCopyKey(720, "fhd-v1") },
  { path: "C:/clips/hd.mp4", type: "VIDEO", displayCopyPath: null, displayCopyKey: displayCopyNotNeededKey(720, "hd-v1") },
  // Origineel vervangen na het maken van de kopie: de oude kopie telt niet meer.
  { path: "C:/clips/vervangen.mp4", type: "VIDEO", displayCopyPath: "C:/uploads/display-720p/oud.mp4", displayCopyKey: displayCopyKey(720, "vervangen-v1") },
  { path: "C:/clips/foto.png", type: "IMAGE", displayCopyPath: null, displayCopyKey: null },
];

describe("kopieën voor het stadionscherm", () => {
  it("kent alleen 720p als keuze", () => {
    expect(normalizeDisplayCopyHeight(720)).toBe(720);
    expect(normalizeDisplayCopyHeight("720")).toBe(720);
    expect(normalizeDisplayCopyHeight(1080)).toBeNull();
    expect(normalizeDisplayCopyHeight(null)).toBeNull();
  });

  it("maakt alleen een kopie van een duidelijk hogere video", () => {
    expect(needsDisplayCopy(1080, 720)).toBe(true);
    expect(needsDisplayCopy(2160, 720)).toBe(true);
    expect(needsDisplayCopy(720, 720)).toBe(false);
    expect(needsDisplayCopy(768, 720)).toBe(false);
  });

  it("speelt alleen een kopie die bij de huidige versie van het origineel hoort", () => {
    expect(displayCopyMap(rows, 720, currentKey, exists)).toEqual({
      "C:/clips/fhd.mp4": "C:/uploads/display-720p/fhd-720p.mp4",
    });
    expect(displayCopyMap(rows, null, currentKey, exists)).toEqual({});
    const gone = [{ ...rows[0]!, displayCopyPath: "C:/uploads/display-720p/weg.mp4" }];
    expect(displayCopyMap(gone, 720, currentKey, exists)).toEqual({});
  });

  it("telt een kleine video als klaar, en een vervangen video niet", () => {
    expect(displayCopyProgress(rows, 720, currentKey, exists)).toEqual({ ready: 2, total: 3 });
    expect(displayCopyProgress(rows, null, currentKey, exists)).toEqual({ ready: 0, total: 0 });
  });
});

describe("mediaUrl met kopieën", () => {
  afterEach(() => setDisplayMediaCopies({}));

  it("geeft het origineel zolang het stadionscherm geen kopieën zette", () => {
    expect(displayCopyFor("C:/clips/fhd.mp4")).toBe("C:/clips/fhd.mp4");
    expect(mediaUrl("C:/clips/fhd.mp4")).toBe(`/api/localfile?path=${encodeURIComponent("C:/clips/fhd.mp4")}`);
  });

  it("geeft in het stadionscherm de kopie", () => {
    setDisplayMediaCopies({ "C:/clips/fhd.mp4": "C:/uploads/display-720p/fhd-720p.mp4" });
    expect(mediaUrl("C:/clips/fhd.mp4")).toBe(
      `/api/localfile?path=${encodeURIComponent("C:/uploads/display-720p/fhd-720p.mp4")}`,
    );
    expect(mediaUrl("C:/clips/hd.mp4")).toBe(`/api/localfile?path=${encodeURIComponent("C:/clips/hd.mp4")}`);
  });
});
