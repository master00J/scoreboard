"use client";

import { useTranslation } from "react-i18next";
import { ScaleContainer } from "@/components/scale-container";
import type { Team } from "@/lib/types";
import type { ResolvedScoreboardTheme } from "@/lib/scoreboard-theme";
import { SCOREBOARD_CANVAS_H, SCOREBOARD_CANVAS_W } from "@/lib/scoreboard-theme";
import { ScoreboardSurfaceBoard } from "@/app/display/_modes/scoreboard-layout-board";
import {
  SCOREBOARD_PREVIEW_ADDED_TIME,
  SCOREBOARD_PREVIEW_AWAY,
  SCOREBOARD_PREVIEW_ELAPSED,
  SCOREBOARD_PREVIEW_HOME,
  buildScoreboardPreviewMatch,
  layoutLibraryPreviewSurface,
} from "@/lib/scoreboard-preview-match";

export function ScoreboardThemePreview({
  theme,
  homeTeam,
  awayTeam,
  canvasWidth = SCOREBOARD_CANVAS_W,
  canvasHeight = SCOREBOARD_CANVAS_H,
}: {
  theme: ResolvedScoreboardTheme;
  homeTeam?: Team | null;
  awayTeam?: Team | null;
  canvasWidth?: number;
  canvasHeight?: number;
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
  const width = Math.max(320, canvasWidth);
  const height = Math.max(180, canvasHeight);

  return (
    <div className="mx-auto w-full max-w-[22rem]">
      <div
        className="relative w-full overflow-hidden rounded-xl border border-border bg-black"
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        <ScaleContainer variant="embedded" width={width} height={height} scalingMode="contain">
          <ScoreboardSurfaceBoard
            surface={layoutLibraryPreviewSurface(theme)}
            theme={theme}
            match={match}
            elapsed={SCOREBOARD_PREVIEW_ELAPSED}
            running
            period={t("sports.period.half1")}
            addedTime={SCOREBOARD_PREVIEW_ADDED_TIME}
          />
        </ScaleContainer>
      </div>
    </div>
  );
}
