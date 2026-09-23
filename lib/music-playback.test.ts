import { describe, expect, it } from "vitest";
import { MusicPlayback } from "./music-playback";

class FakeAudio extends EventTarget {
  src = "";
  preload = "";
  volume = 1;
  currentTime = 0;
  duration = 30;
  rejectNext: Error | null = null;
  deferred: (() => Promise<void>) | null = null;
  async play() {
    if (this.deferred) return this.deferred();
    if (this.rejectNext) { const error = this.rejectNext; this.rejectNext = null; throw error; }
    this.dispatchEvent(new Event("playing"));
  }
  pause() { this.dispatchEvent(new Event("pause")); }
  removeAttribute() { this.src = ""; }
  load() {}
}
const tracks = [
  { id: "one", title: "First", path: "/one.mp3" },
  { id: "two", title: "Second", path: "/two.wav" },
];
function setup() {
  const audio = new FakeAudio();
  const player = new MusicPlayback(audio as unknown as HTMLAudioElement, (path) => path);
  player.setTracks(tracks);
  return { audio, player };
}

describe("music playback", () => {
  it("does not autoplay on load; resumes a pause and resets on stop", async () => {
    const { audio, player } = setup();
    expect(audio.src).toBe("");
    await player.play();
    audio.currentTime = 12;
    audio.dispatchEvent(new Event("timeupdate"));
    player.pause();
    expect(player.snapshot()).toMatchObject({ playing: false, currentTime: 12 });
    await player.play();
    expect(audio.currentTime).toBe(12);
    player.stop();
    expect(player.snapshot()).toMatchObject({ playing: false, currentTime: 0 });
  });

  it("advances in playlist order, stops at the end and repeats only when enabled", async () => {
    const { audio, player } = setup();
    await player.play();
    audio.dispatchEvent(new Event("ended"));
    expect(player.snapshot().trackId).toBe("two");
    audio.dispatchEvent(new Event("ended"));
    expect(player.snapshot().playing).toBe(false);
    player.setRepeat(true);
    await player.play("two");
    audio.dispatchEvent(new Event("ended"));
    expect(player.snapshot().trackId).toBe("one");
  });

  it("stops on an unreadable file without looping through errors; another track can play", async () => {
    const { audio, player } = setup();
    audio.rejectNext = new Error("Unsupported format");
    await player.play();
    expect(player.snapshot()).toMatchObject({ error: true, playing: false, trackId: "one" });
    await player.play("two");
    expect(player.snapshot()).toMatchObject({ error: false, playing: true, trackId: "two" });
  });

  it("ignores an obsolete play rejection after stop or a new selection", async () => {
    const { audio, player } = setup();
    let reject!: (error: Error) => void;
    audio.deferred = () => new Promise<void>((_resolve, fail) => { reject = fail; });
    const pending = player.play();
    player.stop();
    audio.deferred = null;
    await player.play("two");
    reject(new Error("AbortError"));
    await pending;
    expect(player.snapshot()).toMatchObject({ playing: true, trackId: "two", error: false });
  });

  it("keeps playback when the playlist is reordered; releases a removed playing file", async () => {
    const { audio, player } = setup();
    await player.play("one");
    audio.currentTime = 10;
    player.setTracks([...tracks].reverse());
    expect(audio.currentTime).toBe(10);
    expect(player.snapshot().playing).toBe(true);
    player.setTracks([tracks[1]!]);
    expect(audio.src).toBe("");
    expect(player.snapshot()).toMatchObject({ playing: false, trackId: null });
  });

  it("releases audio on disposal and clamps volume", async () => {
    const { audio, player } = setup();
    player.setVolume(10);
    expect(audio.volume).toBe(1);
    await player.play();
    player.dispose();
    expect(audio.src).toBe("");
  });
});
