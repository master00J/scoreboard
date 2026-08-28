"use client";

import type { ReactNode } from "react";
import { StableClockText } from "@/components/stable-clock-text";
import { formatTime } from "@/lib/utils";
import type { Match } from "@/lib/types";
import {
  mergeScoreboardTheme,
  slotStyle,
  type ResolvedScoreboardTheme,
} from "@/lib/scoreboard-theme";
import { DisplayMediaStage } from "@/components/display-media-stage";
import { TeamLogo } from "./scoreboard-strip";

export function CustomScoreboardLayout({
  match,
  elapsed,
  running,
  period,
  addedTime = 0,
  theme: themeProp,
  children,
}: {
  match: Match;
  elapsed: number;
  running: boolean;
  period: string;
  addedTime?: number;
  shotClock?: number;
  theme?: ResolvedScoreboardTheme;
  children?: ReactNode;
}) {
  const theme = themeProp ?? mergeScoreboardTheme(null);
  const accent = running ? theme.timerRunningColor : theme.timerPausedColor;

  return (
    <div className="absolute inset-0" style={{ fontFamily: theme.fontFamily, background: theme.contentAreaBg }}>
      <div className="absolute overflow-hidden" style={slotStyle(theme.slots.sponsor)}>
        <DisplayMediaStage>{children}</DisplayMediaStage>
      </div>

      <TeamChip
        team={match.homeTeam}
        score={match.homeScore}
        theme={theme}
        style={slotStyle(theme.slots.home)}
      />
      <TeamChip
        team={match.awayTeam}
        score={match.awayScore}
        theme={theme}
        style={slotStyle(theme.slots.away)}
      />

      {theme.showClock || theme.fullShowPeriod ? (
        <div
          className="absolute z-20 box-border overflow-hidden"
          style={{ ...slotStyle(theme.slots.clock), containerType: "size" }}
        >
          <div className="flex h-full w-full flex-col items-center justify-center px-[8cqw] py-[10cqh]">
            {theme.fullShowPeriod ? (
              <div
                className="uppercase tracking-[0.2em] text-white/60"
                style={{ fontSize: "min(18cqh, 12cqw, 28px)" }}
              >
                {period}
              </div>
            ) : null}
            {theme.showClock ? (
              <StableClockText
                value={formatTime(elapsed)}
                className="font-black leading-none"
                style={{
                  fontSize: "min(42cqh, 28cqw, 160px)",
                  color: accent,
                  textShadow: "0 4px 18px rgba(0,0,0,0.45)",
                }}
              />
            ) : null}
            {theme.showClock && theme.fullShowAddedTime && addedTime > 0 ? (
              <div
                className="mt-[4cqh] rounded px-[4cqw] py-[2cqh] font-black tabular-nums"
                style={{
                  fontSize: "min(16cqh, 10cqw, 28px)",
                  background: accent,
                  color: "#0a0a0a",
                }}
              >
                +{addedTime}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TeamChip({
  team,
  score,
  theme,
  style,
}: {
  team: Match["homeTeam"];
  score: number;
  theme: ResolvedScoreboardTheme;
  style: { left: string; top: string; width: string; height: string };
}) {
  const logoBox = theme.showScores || theme.fullShowTeamNames
    ? "min(78cqw, 48cqh)"
    : "min(86cqw, 76cqh)";
  const scoreSize = theme.showLogos || theme.fullShowTeamNames
    ? "min(32cqh, 34cqw, 180px)"
    : "min(50cqh, 40cqw, 220px)";

  return (
    <div className="absolute z-20 box-border overflow-hidden" style={{ ...style, containerType: "size" }}>
      <div className="flex h-full w-full flex-col items-center justify-center gap-[4cqh] px-[8cqw] py-[8cqh]">
        {theme.showLogos ? (
          <TeamLogo
            team={team}
            style={{
              width: logoBox,
              height: logoBox,
              maxWidth: "100%",
              maxHeight: theme.showScores ? "56%" : "86%",
              flexShrink: 1,
            }}
          />
        ) : null}
        {theme.fullShowTeamNames ? (
          <div
            className={`max-w-full truncate text-center font-bold ${theme.fullTeamNameUppercase ? "uppercase" : ""}`}
            style={{ fontSize: "min(14cqh, 12cqw, 36px)", color: theme.teamNameColor }}
          >
            {team.shortName || team.name}
          </div>
        ) : null}
        {theme.showScores ? (
          <div
            className="shrink-0 font-black tabular-nums leading-none"
            style={{
              fontSize: scoreSize,
              color: theme.scoreColor,
              textShadow: "0 4px 18px rgba(0,0,0,0.45)",
            }}
          >
            {score}
          </div>
        ) : null}
      </div>
    </div>
  );
}
