"use client";

import type { ReactNode } from "react";
import type { Match } from "@/lib/types";
import { scoreboardEditorShowsLeftFrame, type ResolvedScoreboardTheme } from "@/lib/scoreboard-theme";
import type { LayoutPreviewSurface } from "@/lib/scoreboard-preview-match";
import { CustomScoreboardLayout } from "./custom-scoreboard-layout";
import { LeftScoreboardLayout } from "./left-scoreboard-layout";
import { MatchScoreboardFull } from "./match-scoreboard-full";
import { StripScoreboardLayout } from "./scoreboard-strip";

/** Plaatshouder voor de sponsorclip in de editor en bij "Probeer op scherm". */
export function SponsorVideoPlate() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-zinc-800 via-zinc-900 to-black">
      <div className="rounded border border-white/25 px-[4%] py-[2%] text-[min(8cqw,42px)] font-black tracking-[0.28em] text-white/55">
        16:9
      </div>
      <div className="mt-[2%] text-[min(3.4cqw,22px)] uppercase tracking-[0.2em] text-white/35">Video</div>
    </div>
  );
}

/**
 * Eén vlak uit Scherm indelen, precies zoals het canvas het tekent. "Probeer op scherm" gebruikt
 * hetzelfde component, zodat het stadionscherm niet een ander vlak of frame kan kiezen dan de editor.
 */
export function ScoreboardSurfaceBoard({
  surface,
  theme,
  match,
  elapsed,
  running,
  period,
  addedTime = 0,
  shotClock = 0,
}: {
  surface: LayoutPreviewSurface;
  theme: ResolvedScoreboardTheme;
  match: Match;
  elapsed: number;
  running: boolean;
  period: string;
  addedTime?: number;
  shotClock?: number;
}) {
  const props = { match, elapsed, running, period, addedTime, shotClock, theme };
  if (surface === "full") return <MatchScoreboardFull {...props} />;
  const video = <SponsorVideoPlate />;
  if (scoreboardEditorShowsLeftFrame(theme)) return <LeftScoreboardLayout {...props}>{video}</LeftScoreboardLayout>;
  if (theme.layoutMode === "bottom-strip") return <StripScoreboardLayout {...props}>{video}</StripScoreboardLayout>;
  return <CustomScoreboardLayout {...props}>{video}</CustomScoreboardLayout>;
}

/** Kaartvoorbeeld van een opgeslagen indeling in de Layout-bibliotheek. */
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
