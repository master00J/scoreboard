/** Music has its own playlist: it never changes the scoreboard's display mode. */
export const MUSIC_EXTENSIONS = ["mp3", "wav", "ogg", "flac", "m4a", "aac"];

export type MusicTrack = { id: string; title: string; path: string };
export type MusicLibrary = { tracks: MusicTrack[]; volume: number; repeat: boolean; outputId: string };
export type MusicImportResult = { library: MusicLibrary; failed: string[] };
export type MusicLibraryUpdate = { trackIds: string[]; volume: number; repeat: boolean; outputId?: string };

export function emptyMusicLibrary(): MusicLibrary {
  return { tracks: [], volume: 0.7, repeat: false, outputId: "" };
}

export function musicVolume(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.7;
}

export function musicOutputId(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

export function nextMusicTrack(tracks: MusicTrack[], currentId: string | null, repeat: boolean): MusicTrack | null {
  const index = tracks.findIndex((track) => track.id === currentId);
  return tracks[index + 1] ?? (repeat ? tracks[0] ?? null : null);
}
