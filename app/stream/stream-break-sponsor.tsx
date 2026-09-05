"use client";

import { useStreamSponsorPlaylist } from "@/lib/use-stream-sponsor-playlist";
import type { StreamSponsorSlotView } from "@/lib/use-stream-sponsor-slot";
import type { Match } from "@/lib/types";
import { StreamHdMedia } from "@/app/stream/stream-hd-media";

export function StreamBreakSponsorOverlay({
  slot,
  match,
}: {
  slot: StreamSponsorSlotView;
  match: Match | null;
}) {
  const { slide, next, onVideoEnded } = useStreamSponsorPlaylist(slot, match);
  if (!slide) return null;

  return (
    <div className="absolute inset-0 z-30 overflow-hidden bg-black">
      <div className="absolute inset-0">
        <StreamHdMedia
          src={slide.src}
          type={slide.type}
          title={slide.title}
          onEnded={onVideoEnded}
        />
      </div>
      {next ? (
        <div className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0" aria-hidden>
          {next.type === "VIDEO" ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={next.src} preload="auto" muted playsInline />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={next.src} alt="" />
          )}
        </div>
      ) : null}
    </div>
  );
}
