"use client";

import { useEffect, useRef, useState } from "react";
import { mediaUrl } from "./media-url";
import { emptyMusicLibrary, musicOutputId, type MusicLibrary } from "./music";
import { MusicPlayback, type MusicPlaybackState } from "./music-playback";

export function useMusicPlayer() {
  const [library, setLibrary] = useState<MusicLibrary>(emptyMusicLibrary);
  const libraryRef = useRef(library);
  const player = useRef<MusicPlayback | null>(null);
  const [playback, setPlayback] = useState<MusicPlaybackState | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [outputs, setOutputs] = useState<Array<{ id: string; label: string }>>([]);

  function acceptLibrary(next: MusicLibrary) {
    libraryRef.current = next;
    player.current?.setTracks(next.tracks);
    setLibrary(next);
  }

  useEffect(() => {
    mounted.current = true;
    const engine = new MusicPlayback(new Audio(), mediaUrl);
    player.current = engine;
    const unsubscribe = engine.subscribe(() => setPlayback(engine.snapshot()));
    setPlayback(engine.snapshot());
    let canceled = false;
    const api = window.electronAPI;
    if (api?.loadMusicLibrary) {
      void api.loadMusicLibrary().then((next) => {
        if (canceled) return;
        libraryRef.current = next;
        setLibrary(next);
        engine.setTracks(next.tracks);
        engine.setVolume(next.volume);
        engine.setRepeat(next.repeat);
        if (next.outputId) void engine.setOutput(next.outputId).catch(() => { if (!canceled) setError("outputError"); });
        setReady(true);
      }).catch(() => { if (!canceled) setError("loadError"); });
    }
    return () => {
      canceled = true;
      mounted.current = false;
      unsubscribe();
      engine.dispose();
      player.current = null;
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    async function refresh() {
      const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []);
      if (canceled || !devices) return;
      setOutputs(devices.filter((device) => device.kind === "audiooutput").map((device, index) => ({
        id: device.deviceId,
        label: device.label || `Output ${index + 1}`,
      })));
    }
    void refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      canceled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, []);

  async function mutate(action: () => Promise<void>, failure: string) {
    if (busyRef.current || !ready) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setFailed([]);
    try { await action(); }
    catch {
      if (mounted.current) {
        player.current?.setTracks(libraryRef.current.tracks);
        setError(failure);
      }
    }
    finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function save(trackIds = libraryRef.current.tracks.map((track) => track.id)) {
    const state = player.current!.snapshot();
    const next = await window.electronAPI!.saveMusicLibrary!({ trackIds, volume: state.volume, repeat: state.repeat });
    if (mounted.current) acceptLibrary(next);
  }

  return {
    library, playback, ready, busy, error, failed, outputs,
    supported: typeof window !== "undefined" && !!window.electronAPI?.loadMusicLibrary,
    importFiles: () => mutate(async () => {
      const result = await window.electronAPI!.importMusic!();
      if (mounted.current) { acceptLibrary(result.library); setFailed(result.failed); }
    }, "importError"),
    remove: (id: string) => mutate(async () => {
      // Release the audio file before Windows deletes the imported copy.
      if (player.current?.snapshot().trackId === id) {
        player.current.setTracks(libraryRef.current.tracks.filter((track) => track.id !== id));
      }
      await save(libraryRef.current.tracks.filter((track) => track.id !== id).map((track) => track.id));
    }, "saveError"),
    move: (id: string, delta: number) => mutate(async () => {
      const ids = libraryRef.current.tracks.map((track) => track.id);
      const from = ids.indexOf(id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to]!, ids[from]!];
      await save(ids);
    }, "saveError"),
    play: (id?: string) => { void player.current?.play(id); },
    pause: () => player.current?.pause(),
    stop: () => player.current?.stop(),
    next: () => player.current?.next(),
    previous: () => player.current?.previous(),
    seek: (seconds: number) => player.current?.seek(seconds),
    volume: (volume: number) => player.current?.setVolume(volume),
    persistSettings: () => mutate(() => save(), "saveError"),
    repeat: (repeat: boolean) => mutate(async () => {
      player.current?.setRepeat(repeat);
      await save();
    }, "saveError"),
    output: (outputId: string) => mutate(async () => {
      await player.current?.setOutput(musicOutputId(outputId));
      const state = player.current!.snapshot();
      const next = await window.electronAPI!.saveMusicLibrary!({
        trackIds: libraryRef.current.tracks.map((track) => track.id),
        volume: state.volume,
        repeat: state.repeat,
        outputId: musicOutputId(outputId),
      });
      if (mounted.current) acceptLibrary(next);
    }, "outputError"),
  };
}

export type MusicPlayerController = ReturnType<typeof useMusicPlayer>;
