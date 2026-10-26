"use client";

import type { ReactNode } from "react";
import type { Match } from "@/lib/types";
import type { ResolvedScoreboardTheme } from "@/lib/scoreboard-theme";
import { CustomScoreboardLayout } from "./custom-scoreboard-layout";
import { LeftScoreboardLayout } from "./left-scoreboard-layout";
import { MatchScoreboardFull } from "./match-scoreboard-full";
import { StripScoreboardLayout } from "./scoreboard-strip";

/** Zelfde bord als in Scherm indelen, op ware stadiongrootte. */
export function ScoreboardLayoutBoard({
  theme,
  match,
  elapsed,
  running,
  period,
  addedTime = 0,
  shotClock = 0,
  children,
}: {
  theme: ResolvedScoreboardTheme;
  match: Match;
  elapsed: number;
  running: boolean;
  period: string;
  addedTime?: number;
  shotClock?: number;
  children?: ReactNode;
}) {
  const props = { match, elapsed, running, period, addedTime, shotClock, theme };
  switch (theme.layoutMode) {
    case "custom":
      return <CustomScoreboardLayout {...props}>{children}</CustomScoreboardLayout>;
    case "bottom-strip":
      return <StripScoreboardLayout {...props}>{children}</StripScoreboardLayout>;
    case "full":
      return <MatchScoreboardFull {...props} />;
    default:
      return <LeftScoreboardLayout {...props}>{children}</LeftScoreboardLayout>;
  }
}
