"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Team } from "@/lib/types";
import type { ResolvedScoreboardTheme } from "@/lib/scoreboard-theme";
import { ScoreboardLayoutBoard } from "@/app/display/_modes/scoreboard-layout-board";
import {
  SCOREBOARD_PREVIEW_ADDED_TIME,
  SCOREBOARD_PREVIEW_AWAY,
  SCOREBOARD_PREVIEW_ELAPSED,
  SCOREBOARD_PREVIEW_HOME,
  buildScoreboardPreviewMatch,
} from "@/lib/scoreboard-preview-match";

/** Logisch canvas van het stadionscherm; previews schalen hiervandaan naar kaartbreedte. */
const PREVIEW_CANVAS_W = 1920;
const PREVIEW_CANVAS_H = 1080;

function PreviewSixteenByNinePlate() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-zinc-800 via-zinc-900 to-black">
      <div className="rounded border border-white/25 px-[4%] py-[2%] text-[min(8cqw,42px)] font-black tracking-[0.28em] text-white/55">
        16:9
      </div>
      <div className="mt-[2%] text-[min(3.4cqw,22px)] uppercase tracking-[0.2em] text-white/35">Video</div>
    </div>
  );
}

export function ScoreboardThemePreview({
  theme,
  homeTeam,
  awayTeam,
}: {
  theme: ResolvedScoreboardTheme;
  homeTeam?: Team | null;
  awayTeam?: Team | null;
}) {
  const { t } = useTranslation();
  const match = buildScoreboardPreviewMatch({
    home:
      homeTeam ?? {
        ...SCOREBOARD_PREVIEW_HOME,
        name: t("common.home"),
        shortName: t("common.home").slice(0, 3).toUpperCase(),
      },
    away:
      awayTeam ?? {
        ...SCOREBOARD_PREVIEW_AWAY,
        name: t("common.away"),
        shortName: t("common.away").slice(0, 3).toUpperCase(),
      },
  });
  const period = t("sports.period.half1");
  const video = <PreviewSixteenByNinePlate />;
  const board = (
    <ScoreboardLayoutBoard
      theme={theme}
      match={match}
      elapsed={SCOREBOARD_PREVIEW_ELAPSED}
      running
      period={period}
      addedTime={SCOREBOARD_PREVIEW_ADDED_TIME}
    >
      {video}
    </ScoreboardLayoutBoard>
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-black">
      <PreviewCanvas>{board}</PreviewCanvas>
    </div>
  );
}

/**
 * Schaalt het 1920×1080-scorebord naar de kaartbreedte.
 *
 * `scale()` verwacht een getal: `calc(100cqw / 1920)` is een lengte en wordt door de
 * browser genegeerd, waardoor het bord op ware grootte uit de kaart liep. Delen door
 * `1920px` levert wél een verhouding op. De ResizeObserver-fallback dekt engines zonder
 * container-query-units af, zodat de preview nooit ongeschaald blijft staan.
 */
function PreviewCanvas({ children }: { children: React.ReactNode }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [measuredScale, setMeasuredScale] = useState<number | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const supportsCqw =
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("width", "1cqw");
    if (supportsCqw) {
      setMeasuredScale(null);
      return;
    }
    const update = () => {
      const width = el.getBoundingClientRect().width;
      setMeasuredScale(width > 0 ? width / PREVIEW_CANVAS_W : null);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      className="relative w-full overflow-hidden [container-type:inline-size]"
      style={{ aspectRatio: "16 / 9" }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: PREVIEW_CANVAS_W,
          height: PREVIEW_CANVAS_H,
          transform:
            measuredScale != null
              ? `scale(${measuredScale})`
              : `scale(calc(100cqw / ${PREVIEW_CANVAS_W}px))`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
