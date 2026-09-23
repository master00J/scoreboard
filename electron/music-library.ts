import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MUSIC_EXTENSIONS, emptyMusicLibrary, musicVolume, type MusicLibrary, type MusicLibraryUpdate, type MusicImportResult } from "../lib/music";

/** Imported copies and the playlist live in uploads, so venue backups include both. */
export class MusicLibraryStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly directory: string;
  private readonly manifest: string;

  constructor(uploadsDir: string) {
    this.directory = path.join(uploadsDir, "music");
    this.manifest = path.join(this.directory, "playlist.json");
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<MusicLibrary> {
    let raw: string;
    try {
      raw = await fs.readFile(this.manifest, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyMusicLibrary();
      throw error;
    }
    const data = JSON.parse(raw) as MusicLibrary;
    if (!Array.isArray(data?.tracks)) throw new Error("Invalid music playlist");
    const ids = new Set<string>();
    for (const track of data.tracks) {
      if (!track || typeof track.id !== "string" || !/^[a-f0-9-]{36}$/.test(track.id) ||
          typeof track.title !== "string" || typeof track.path !== "string" || ids.has(track.id) ||
          !MUSIC_EXTENSIONS.some((ext) => track.path === `/uploads/music/${track.id}.${ext}`)) {
        throw new Error("Invalid music track");
      }
      ids.add(track.id);
    }
    return { tracks: data.tracks, volume: musicVolume(data.volume), repeat: data.repeat === true };
  }

  private async write(library: MusicLibrary): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    const temporary = `${this.manifest}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(library, null, 2), "utf8");
    await fs.rename(temporary, this.manifest);
  }

  load(): Promise<MusicLibrary> { return this.serial(() => this.read()); }

  importFiles(filePaths: string[]): Promise<MusicImportResult> {
    return this.serial(async () => {
      const library = await this.read();
      const failed: string[] = [];
      const copied: string[] = [];
      await fs.mkdir(this.directory, { recursive: true });
      for (const source of filePaths) {
        const ext = path.extname(source).slice(1).toLowerCase();
        const id = randomUUID();
        const target = path.join(this.directory, `${id}.${ext}`);
        try {
          if (!MUSIC_EXTENSIONS.includes(ext) || !(await fs.stat(source)).isFile()) throw new Error("Unsupported audio file");
          await fs.copyFile(source, target);
          copied.push(target);
          library.tracks.push({ id, title: path.basename(source, path.extname(source)), path: `/uploads/music/${id}.${ext}` });
        } catch {
          failed.push(path.basename(source));
        }
      }
      try {
        await this.write(library);
      } catch (error) {
        await Promise.all(copied.map((file) => fs.unlink(file).catch(() => undefined)));
        throw error;
      }
      return { library, failed };
    });
  }

  save(update: MusicLibraryUpdate): Promise<MusicLibrary> {
    return this.serial(async () => {
      const previous = await this.read();
      if (!update || !Array.isArray(update.trackIds) || update.trackIds.some((id) => typeof id !== "string") ||
          new Set(update.trackIds).size !== update.trackIds.length ||
          typeof update.volume !== "number" || !Number.isFinite(update.volume) || typeof update.repeat !== "boolean") {
        throw new Error("Invalid music playlist update");
      }
      const tracks = update.trackIds.map((id) => {
        const track = previous.tracks.find((item) => item.id === id);
        if (!track) throw new Error("Unknown music track");
        return track;
      });
      const library = { tracks, volume: musicVolume(update.volume), repeat: update.repeat };
      await this.write(library);
      // Only delete generated copies referenced by the validated previous manifest.
      for (const track of previous.tracks) {
        if (!update.trackIds.includes(track.id)) {
          await fs.unlink(path.join(this.directory, path.basename(track.path))).catch(() => undefined);
        }
      }
      return library;
    });
  }
}
