import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MusicLibraryStore } from "../electron/music-library";

let root: string;
let uploads: string;
let store: MusicLibraryStore;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "arenacue-music-test-"));
  uploads = path.join(root, "uploads");
  store = new MusicLibraryStore(uploads);
});
afterEach(async () => {
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("arenacue-music-test-")) throw new Error("Unsafe cleanup path");
  await fs.rm(root, { recursive: true, force: true });
});
async function source(name: string) {
  const file = path.join(root, name);
  await fs.writeFile(file, "test audio bytes");
  return file;
}

describe("local music library", () => {
  it("copies selected files and restores playlist/settings after restart without the original", async () => {
    const file = await source("Pauze #1.MP3");
    const { library, failed } = await store.importFiles([file]);
    expect(failed).toEqual([]);
    expect(library.tracks[0]?.title).toBe("Pauze #1");
    await fs.unlink(file);
    const saved = await store.save({ trackIds: library.tracks.map((track) => track.id), volume: 0.3, repeat: true });
    expect(await new MusicLibraryStore(uploads).load()).toEqual(saved);
    const withOutput = await store.save({ trackIds: saved.tracks.map((track) => track.id), volume: 0.3, repeat: true, outputId: "soundcard-2" });
    expect((await new MusicLibraryStore(uploads).load()).outputId).toBe("soundcard-2");
    expect(withOutput.outputId).toBe("soundcard-2");
    expect(await fs.readFile(path.join(uploads, "music", path.basename(saved.tracks[0]!.path)), "utf8")).toBe("test audio bytes");
  });

  it("reports failed imports while preserving playable selections and existing tracks", async () => {
    const valid = await source("test.wav");
    const invalid = await source("test.exe");
    const { library, failed } = await store.importFiles([valid, invalid, path.join(root, "missing.mp3")]);
    expect(library.tracks).toHaveLength(1);
    expect(failed).toEqual(["test.exe", "missing.mp3"]);
  });

  it("serializes imports and removes only its own copies, never the original files", async () => {
    const one = await source("one.mp3");
    const two = await source("two.wav");
    await Promise.all([store.importFiles([one]), store.importFiles([two])]);
    const library = await store.load();
    expect(library.tracks).toHaveLength(2);
    const [first, second] = library.tracks;
    await store.save({ trackIds: [second!.id], volume: 0.5, repeat: false });
    expect(await fs.readFile(one, "utf8")).toBe("test audio bytes");
    await expect(fs.stat(path.join(uploads, "music", path.basename(first!.path)))).rejects.toThrow();
  });

  it("rejects unknown/duplicate track ids and corrupt manifests instead of overwriting them", async () => {
    const { library } = await store.importFiles([await source("one.mp3")]);
    await expect(store.save({ trackIds: ["../../outside"], volume: 1, repeat: false })).rejects.toThrow();
    await expect(store.save({ trackIds: [library.tracks[0]!.id, library.tracks[0]!.id], volume: 1, repeat: false })).rejects.toThrow();
    expect(await store.load()).toEqual(library);
    const manifest = path.join(uploads, "music", "playlist.json");
    await fs.writeFile(manifest, "corrupted");
    await expect(store.importFiles([await source("two.mp3")])).rejects.toThrow();
    expect(await fs.readFile(manifest, "utf8")).toBe("corrupted");
  });
});
