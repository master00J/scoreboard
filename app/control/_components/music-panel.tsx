"use client";

import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Music2, Pause, Play, Plus, SkipBack, SkipForward, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MusicPlayerController } from "@/lib/use-music-player";

function time(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function MusicPanel({ player }: { player: MusicPlayerController }) {
  const { t } = useTranslation();
  const { playback, library, busy, ready } = player;
  const current = library.tracks.find((track) => track.id === playback?.trackId);
  const disabled = !ready || !library.tracks.length;
  const active = playback?.playing || playback?.loading;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label={t("panels.music")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Music2 className="size-4 text-primary" />{t("panels.music")}</h2>
        <Button size="sm" variant="outline" disabled={!ready || busy} onClick={() => void player.importFiles()}>
          <Plus className="mr-1 size-4" />{t(busy ? "common.busy" : "music.add")}
        </Button>
      </div>
      {!player.supported ? <p className="text-sm text-muted-foreground">{t("music.desktopOnly")}</p> : <>
        <div className="min-w-0 rounded-lg bg-background/70 p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t(active ? "music.nowPlaying" : "music.selected")}</p>
          <p className="truncate text-sm font-semibold" title={current?.title}>{current?.title ?? t("music.choose")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={disabled} title={t("music.previous")} aria-label={t("music.previous")} onClick={player.previous}><SkipBack className="size-4" /></Button>
            <Button size="sm" disabled={disabled} onClick={() => active ? player.pause() : player.play()}>
              {active ? <Pause className="mr-1 size-4" /> : <Play className="mr-1 size-4" />}{t(active ? "music.pause" : "music.play")}
            </Button>
            <Button size="sm" variant="outline" disabled={disabled} aria-label={t("music.stop")} title={t("music.stop")} onClick={player.stop}><Square className="size-4" /></Button>
            <Button size="sm" variant="outline" disabled={disabled} aria-label={t("music.next")} title={t("music.next")} onClick={player.next}><SkipForward className="size-4" /></Button>
          </div>
          <input type="range" className="mt-3 w-full accent-primary" aria-label={t("music.position")} min={0} max={playback?.duration || 1} step={0.1} value={Math.min(playback?.currentTime ?? 0, playback?.duration || 1)} disabled={!playback?.duration} onChange={(e) => player.seek(Number(e.target.value))} />
          <div className="flex justify-between text-xs tabular-nums text-muted-foreground"><span>{time(playback?.currentTime ?? 0)}</span><span>{time(playback?.duration ?? 0)}</span></div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
            {t("music.volume")}
            <input type="range" className="min-w-0 flex-1 accent-primary" min={0} max={1} step={0.01} value={playback?.volume ?? 0.7} disabled={!ready || busy} onChange={(e) => player.volume(Number(e.target.value))} onPointerUp={() => void player.persistSettings()} onKeyUp={() => void player.persistSettings()} onBlur={() => void player.persistSettings()} />
            <span className="w-8 tabular-nums">{Math.round((playback?.volume ?? 0.7) * 100)}%</span>
          </label>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={playback?.repeat ?? false} disabled={!ready || busy} onChange={(e) => void player.repeat(e.target.checked)} />{t("music.repeat")}</label>
        </div>
        {library.tracks.length === 0 ? <p className="text-sm text-muted-foreground">{t("music.empty")}</p> : (
          <ol className="max-h-52 space-y-1 overflow-y-auto" aria-label={t("music.playlist")}>
            {library.tracks.map((track, index) => (
              <li key={track.id} className={`flex min-w-0 items-center gap-1 rounded-md p-1 ${track.id === current?.id ? "bg-primary/10" : "bg-background/40"}`}>
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded p-1.5 text-left text-xs hover:bg-muted" onClick={() => player.play(track.id)} aria-label={t("music.playTrack", { title: track.title })} aria-current={track.id === current?.id ? "true" : undefined} title={track.title}>
                  <span className="w-4 shrink-0 text-muted-foreground">{index + 1}</span><span className="truncate">{track.title}</span>
                </button>
                <button type="button" className="rounded p-1.5 hover:bg-muted disabled:opacity-30" disabled={busy || index === 0} aria-label={t("music.moveUp", { title: track.title })} onClick={() => void player.move(track.id, -1)}><ArrowUp className="size-3.5" /></button>
                <button type="button" className="rounded p-1.5 hover:bg-muted disabled:opacity-30" disabled={busy || index === library.tracks.length - 1} aria-label={t("music.moveDown", { title: track.title })} onClick={() => void player.move(track.id, 1)}><ArrowDown className="size-3.5" /></button>
                <button type="button" className="rounded p-1.5 hover:bg-destructive/20 disabled:opacity-30" disabled={busy} aria-label={t("music.remove", { title: track.title })} onClick={() => void player.remove(track.id)}><Trash2 className="size-3.5" /></button>
              </li>
            ))}
          </ol>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">{t("music.help")}</p>
      </>}
      {player.error && <p role="alert" className="text-sm text-destructive">{t(`music.${player.error}`)}</p>}
      {playback?.error && <p role="alert" className="text-sm text-destructive">{t("music.playError")}</p>}
      {player.failed.length > 0 && <p role="alert" className="text-sm text-destructive">{t("music.failedFiles", { names: player.failed.join(", ") })}</p>}
    </section>
  );
}

/** Always reachable, including when the music panel is hidden or a different tab is open. */
export function MusicPlayingIndicator({ player }: { player: MusicPlayerController }) {
  const { t } = useTranslation();
  if (!player.playback?.playing && !player.playback?.loading) return null;
  const track = player.library.tracks.find((item) => item.id === player.playback?.trackId);
  return <div className="flex min-w-0 items-center gap-2 rounded-lg border border-primary/40 px-2 py-1 text-xs" role="status">
    <Music2 className="size-3.5 shrink-0 text-primary" />
    <span className="max-w-40 truncate" title={track?.title}>{track?.title}</span>
    <button type="button" className="rounded p-1 hover:bg-muted" aria-label={t("music.stop")} title={t("music.stop")} onClick={player.stop}><Square className="size-3.5" /></button>
  </div>;
}
