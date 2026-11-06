"use client";

import { useTranslation } from "react-i18next";
import type { LivestreamSponsorPosition } from "@/lib/livestream";
import { resolveSponsorStripEdge } from "@/lib/stream-layer-layout";
import { useStreamSponsorPlaylist } from "@/lib/use-stream-sponsor-playlist";
import type { StreamSponsorSlotView } from "@/lib/use-stream-sponsor-slot";
import type { Match } from "@/lib/types";
import { StreamHdMedia } from "@/app/stream/stream-hd-media";

/**
 * Alleen de huidige sponsor, zonder eigen plek: voor het sponsorvak van een eigen overlay-indeling.
 * Geen sponsor ingepland: niets (doorzichtig), of in de indeling-editor een gestippeld vak.
 */
export function StreamSponsorMedia({
  slot,
  match,
  placeholder = false,
}: {
  slot: StreamSponsorSlotView;
  match: Match | null;
  placeholder?: boolean;
}) {
  const { t } = useTranslation();
  const { slide, onVideoEnded } = useStreamSponsorPlaylist(slot, match);
  if (!slot.current || !slide) {
    if (!placeholder) return null;
    return (
      <div className="grid h-full w-full place-items-center rounded-md border-2 border-dashed border-amber-300/70 bg-amber-300/10 text-[11px] font-semibold text-amber-100">
        {t("livestream.designerSponsorHere")}
      </div>
    );
  }
  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <StreamHdMedia src={slide.src} type={slide.type} title={slide.title} onEnded={onVideoEnded} />
    </div>
  );
}

export function StreamSponsorLayer({
  slot,
  match,
  style,
  sponsorPosition,
  scorePosition,
  scoreVisible,
  stripHeightPx,
  placeholder = false,
}: {
  slot: StreamSponsorSlotView;
  match: Match | null;
  style: "logos" | "lowerthird";
  sponsorPosition: LivestreamSponsorPosition;
  scorePosition: "top" | "bottom";
  scoreVisible: boolean;
  stripHeightPx: number;
  /**
   * In de indeling-editor: staat er nu geen sponsor ingepland, toon dan een gestippeld vak op de
   * plek en in de maat waar hij komt, zodat je ziet hoe score en sponsor samen vallen.
   */
  placeholder?: boolean;
}) {
  const { t } = useTranslation();
  const { slide, onVideoEnded } = useStreamSponsorPlaylist(slot, match);
  const showing = Boolean(slot.current && slide);
  if (!showing && !placeholder) return null;

  const edge = resolveSponsorStripEdge(sponsorPosition, scorePosition, scoreVisible);
  const scoreOffset = scoreVisible ? stripHeightPx + 12 : 24;
  const plateStyle =
    edge === "top"
      ? { top: scoreVisible && scorePosition === "top" ? scoreOffset : 24 }
      : { bottom: scoreVisible && scorePosition === "bottom" ? scoreOffset : 24 };

  const widthClass = style === "lowerthird" ? "w-[36%] max-w-[640px]" : "w-[42%] max-w-[720px]";

  if (!showing || !slide) {
    return (
      <div className={`pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 ${widthClass}`} style={plateStyle}>
        <div className="grid aspect-video place-items-center rounded-md border-2 border-dashed border-amber-300/70 bg-amber-300/10 px-2 text-center text-[11px] font-semibold text-amber-100">
          {t("livestream.designerSponsorHere")}
        </div>
        {style === "lowerthird" ? (
          <div className="mt-1 truncate text-center text-[10px] font-semibold text-amber-100/80 drop-shadow">
            {t("livestream.designerSponsorName")}
          </div>
        ) : null}
      </div>
    );
  }

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
