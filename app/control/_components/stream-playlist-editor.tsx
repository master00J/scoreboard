"use client";

import type { TFunction } from "i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/form";
import { isVideoMediaPath, mediaPathFileName } from "@/lib/livestream";
import {
  appendPlaylistItems,
  createPlaylistItem,
  movePlaylistItem,
  PLAYLIST_ITEM_LIMIT,
  sanitizePlaylistDurationSec,
  type LivestreamPlaylistItem,
} from "@/lib/stream-playlist";
import type { MediaItem } from "@/lib/types";

export function StreamPlaylistEditor({
  items,
  loop,
  disabled,
  library,
  t,
  onItems,
  onLoop,
  onPickFiles,
}: {
  items: LivestreamPlaylistItem[];
  loop: boolean;
  disabled?: boolean;
  library?: MediaItem[] | null;
  t: TFunction;
  onItems: (items: LivestreamPlaylistItem[]) => void;
  onLoop: (loop: boolean) => void;
  onPickFiles: () => Promise<string[]>;
}) {
  const full = items.length >= PLAYLIST_ITEM_LIMIT;
  const visibleLibrary = (library ?? []).filter((item) => item.active !== false && !item.hideFromLibrary);

  const addPaths = (paths: string[], durations?: Array<number | undefined>) => {
    const extra = paths
      .map((path, index) => createPlaylistItem({ path, durationSec: durations?.[index] }))
      .filter((item): item is LivestreamPlaylistItem => Boolean(item));
    if (extra.length === 0) return;
    onItems(appendPlaylistItems(items, extra));
  };

  return (
    <div className="flex flex-col gap-1.5" data-stream-playlist-editor>
      {items.length === 0 ? (
        <p className="px-0.5 text-[10px] leading-snug text-muted-foreground">{t("livestream.playlistEmpty")}</p>
      ) : (
        <ol className="max-h-40 space-y-0.5 overflow-y-auto">
          {items.map((item, index) => {
            const video = isVideoMediaPath(item.path);
            return (
              <li key={item.id} className="flex items-center gap-1 rounded bg-zinc-900/80 px-1 py-0.5">
                <span className="w-4 shrink-0 text-center text-[10px] text-white/40">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-100" title={item.path}>
                  {mediaPathFileName(item.path)}
                </span>
                <Input
                  type="number"
                  min={video ? 0 : 1}
                  max={3600}
                  step={1}
                  disabled={disabled}
                  aria-label={t("livestream.playlistDuration")}
                  title={t("livestream.playlistDurationHint")}
                  placeholder={video ? t("livestream.playlistDurationAuto") : "8"}
                  className="h-6 w-14 px-1 text-center text-[11px]"
                  value={video && item.durationSec === 0 ? "" : item.durationSec}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const durationSec = sanitizePlaylistDurationSec(raw === "" ? 0 : Number(raw), item.path);
                    onItems(items.map((row) => (row.id === item.id ? { ...row, durationSec } : row)));
                  }}
                />
                <span className="shrink-0 text-[10px] text-white/40">s</span>
                <button
                  type="button"
                  aria-label={t("livestream.playlistMoveUp")}
                  disabled={disabled || index === 0}
                  onClick={() => onItems(movePlaylistItem(items, item.id, -1))}
                  className="h-6 w-5 rounded text-[10px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={t("livestream.playlistMoveDown")}
                  disabled={disabled || index === items.length - 1}
                  onClick={() => onItems(movePlaylistItem(items, item.id, 1))}
                  className="h-6 w-5 rounded text-[10px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={t("livestream.playlistRemoveItem")}
                  disabled={disabled}
                  onClick={() => onItems(items.filter((row) => row.id !== item.id))}
                  className="h-6 w-5 rounded text-[11px] text-zinc-400 hover:bg-red-700 hover:text-white disabled:opacity-30"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p className="px-0.5 text-[10px] leading-snug text-muted-foreground">{t("livestream.playlistDurationHint")}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          disabled={disabled || full}
          onClick={() => {
            void (async () => {
              const paths = await onPickFiles();
              addPaths(paths);
            })();
          }}
        >
          {t("livestream.playlistAddFiles")}
        </Button>
        {visibleLibrary.length > 0 ? (
          <Select
            className="h-7 min-w-[8rem] flex-1 text-[11px]"
            disabled={disabled || full}
            value=""
            onChange={(e) => {
              const media = visibleLibrary.find((entry) => entry.id === e.target.value);
              if (!media) return;
              addPaths(
                [media.path],
                [media.type === "IMAGE" ? media.durationSec : 0],
              );
            }}
          >
            <option value="">{t("livestream.mediaFromLibrary")}</option>
            {visibleLibrary.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title || mediaPathFileName(entry.path)}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
      {full ? <p className="text-[10px] text-amber-200/90">{t("livestream.playlistFull")}</p> : null}
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={loop}
          disabled={disabled}
          onChange={(e) => onLoop(e.target.checked)}
        />
        {t("livestream.mediaLoop")}
      </label>
    </div>
  );
}
