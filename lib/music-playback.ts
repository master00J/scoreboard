import { musicVolume, nextMusicTrack, type MusicTrack } from "./music";

export type MusicPlaybackState = {
  trackId: string | null;
  playing: boolean;
  loading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  repeat: boolean;
  error: boolean;
};

/** One owner in ControlPage, independent of panel visibility, layout and display windows. */
export class MusicPlayback {
  private tracks: MusicTrack[] = [];
  private generation = 0;
  private listeners = new Set<() => void>();
  private state: MusicPlaybackState = {
    trackId: null, playing: false, loading: false, currentTime: 0, duration: 0,
    volume: 0.7, repeat: false, error: false,
  };
  private handlers: Record<string, () => void>;

  constructor(private audio: HTMLAudioElement, private url: (path: string) => string) {
    audio.preload = "metadata";
    audio.volume = this.state.volume;
    this.handlers = {
      playing: () => this.patch({ playing: true, loading: false }),
      pause: () => this.patch({ playing: false }),
      timeupdate: () => this.patch({ currentTime: audio.currentTime }),
      loadedmetadata: () => this.patch({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 }),
      durationchange: () => this.patch({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 }),
      error: () => { this.generation++; this.patch({ error: true, playing: false, loading: false }); },
      ended: () => {
        const next = nextMusicTrack(this.tracks, this.state.trackId, this.state.repeat);
        if (next) void this.play(next.id);
        else this.stop();
      },
    };
    for (const [event, handler] of Object.entries(this.handlers)) audio.addEventListener(event, handler);
  }

  snapshot = (): MusicPlaybackState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private patch(partial: Partial<MusicPlaybackState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => listener());
  }
  setTracks(tracks: MusicTrack[]) {
    this.tracks = tracks;
    if (!tracks.some((track) => track.id === this.state.trackId)) {
      this.stop();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.patch({ trackId: null, duration: 0, error: false });
    }
  }
  async play(id = this.state.trackId ?? this.tracks[0]?.id): Promise<void> {
    const track = this.tracks.find((item) => item.id === id);
    if (!track) return;
    const generation = ++this.generation;
    if (this.state.trackId !== track.id || this.state.error) {
      this.audio.pause();
      this.audio.src = this.url(track.path);
      this.patch({ trackId: track.id, currentTime: 0, duration: 0 });
    }
    this.patch({ error: false, loading: true });
    try {
      await this.audio.play();
      if (generation === this.generation) this.patch({ playing: true, loading: false });
    } catch {
      // A pause/stop/new selection can intentionally cancel an earlier play request.
      if (generation === this.generation) this.patch({ error: true, playing: false, loading: false });
    }
  }
  pause() {
    this.generation++;
    this.audio.pause();
    this.patch({ playing: false, loading: false });
  }
  stop() {
    this.pause();
    this.audio.currentTime = 0;
    this.patch({ currentTime: 0 });
  }
  next() {
    const next = nextMusicTrack(this.tracks, this.state.trackId, this.state.repeat);
    if (next) void this.play(next.id);
    else this.stop();
  }
  previous() {
    const index = this.tracks.findIndex((track) => track.id === this.state.trackId);
    const track = this.tracks[Math.max(0, index - 1)];
    if (track) void this.play(track.id);
  }
  seek(seconds: number) {
    if (!Number.isFinite(seconds) || this.state.duration <= 0) return;
    this.audio.currentTime = Math.max(0, Math.min(this.state.duration, seconds));
    this.patch({ currentTime: this.audio.currentTime });
  }
  setVolume(volume: number) {
    this.audio.volume = musicVolume(volume);
    this.patch({ volume: this.audio.volume });
  }
  setRepeat(repeat: boolean) { this.patch({ repeat }); }
  dispose() {
    this.generation++;
    for (const [event, handler] of Object.entries(this.handlers)) this.audio.removeEventListener(event, handler);
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.listeners.clear();
  }
}
