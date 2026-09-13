"use client";

import type { LivestreamSponsorPosition } from "@/lib/livestream";
import { resolveSponsorStripEdge } from "@/lib/stream-layer-layout";
import type { StreamOverlayClip } from "@/lib/stream-program-clip";
import { StreamHdMedia } from "@/app/stream/stream-hd-media";

export function StreamClipLayer({
  clip,
  variant,
  sponsorPosition,
  scorePosition,
  scoreVisible,
  stripHeightPx,
  onEnded,
}: {
  clip: StreamOverlayClip;
  variant: "pip" | "fullscreen";
  sponsorPosition: LivestreamSponsorPosition;
  scorePosition: "top" | "bottom";
  scoreVisible: boolean;
  stripHeightPx: number;
  onEnded?: () => void;
}) {
  if (variant === "fullscreen") {
    return (
      <div className="absolute inset-0 z-30 overflow-hidden bg-black">
        <div className="absolute inset-0">
          <StreamHdMedia src={clip.src} type={clip.type} title={clip.title} onEnded={() => onEnded?.()} />
        </div>
      </div>
    );
  }

  const edge = resolveSponsorStripEdge(sponsorPosition, scorePosition, scoreVisible);
  const scoreOffset = scoreVisible ? stripHeightPx + 12 : 24;
  const plateStyle =
    edge === "top"
      ? { top: scoreVisible && scorePosition === "top" ? scoreOffset : 24 }
      : { bottom: scoreVisible && scorePosition === "bottom" ? scoreOffset : 24 };

  return (
    <div className="absolute left-1/2 z-20 w-[42%] max-w-[720px] -translate-x-1/2" style={plateStyle}>
      <div className="relative aspect-video overflow-hidden rounded-md bg-black shadow-[0_8px_32px_rgba(0,0,0,0.55)] ring-1 ring-white/15">
        <StreamHdMedia src={clip.src} type={clip.type} title={clip.title} onEnded={() => onEnded?.()} />
      </div>
    </div>
  );
}
