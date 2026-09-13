"use client";

import type { LivestreamSponsorPosition } from "@/lib/livestream";
import { resolveSponsorStripEdge } from "@/lib/stream-layer-layout";
import { useStreamSponsorPlaylist } from "@/lib/use-stream-sponsor-playlist";
import type { StreamSponsorSlotView } from "@/lib/use-stream-sponsor-slot";
import type { Match } from "@/lib/types";
import { StreamHdMedia } from "@/app/stream/stream-hd-media";

export function StreamSponsorLayer({
  slot,
  match,
  style,
  sponsorPosition,
  scorePosition,
  scoreVisible,
  stripHeightPx,
}: {
  slot: StreamSponsorSlotView;
  match: Match | null;
  style: "logos" | "lowerthird";
  sponsorPosition: LivestreamSponsorPosition;
  scorePosition: "top" | "bottom";
  scoreVisible: boolean;
  stripHeightPx: number;
}) {
  const { slide, onVideoEnded } = useStreamSponsorPlaylist(slot, match);
  if (!slot.current || !slide) return null;

  const edge = resolveSponsorStripEdge(sponsorPosition, scorePosition, scoreVisible);
  const scoreOffset = scoreVisible ? stripHeightPx + 12 : 24;
  const plateStyle =
    edge === "top"
      ? { top: scoreVisible && scorePosition === "top" ? scoreOffset : 24 }
      : { bottom: scoreVisible && scorePosition === "bottom" ? scoreOffset : 24 };

  const widthClass = style === "lowerthird" ? "w-[36%] max-w-[640px]" : "w-[42%] max-w-[720px]";

  return (
    <div className={`absolute left-1/2 z-20 -translate-x-1/2 ${widthClass}`} style={plateStyle}>
      <div className="relative aspect-video overflow-hidden rounded-md bg-black shadow-[0_8px_32px_rgba(0,0,0,0.55)] ring-1 ring-white/15">
        <StreamHdMedia src={slide.src} type={slide.type} title={slide.title} onEnded={onVideoEnded} />
      </div>
      {style === "lowerthird" ? (
        <div className="mt-1.5 truncate text-center text-sm font-semibold text-white drop-shadow">
          {slide.sponsorName}
        </div>
      ) : null}
    </div>
  );
}
