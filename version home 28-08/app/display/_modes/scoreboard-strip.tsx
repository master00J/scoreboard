"use client";

import type { CSSProperties, ReactNode } from "react";
import { motion } from "framer-motion";
import type { Match } from "@/lib/types";
import { DisplayMediaStage } from "@/components/display-media-stage";
import { StableClockText } from "@/components/stable-clock-text";
import { formatTime } from "@/lib/utils";
import { mediaUrl } from "@/lib/media-url";
import {
  frameGradientCss,
  mergeScoreboardTheme,
  type ResolvedScoreboardTheme,
} from "@/lib/scoreboard-theme";

export function ScoreboardStrip({
  match,
  elapsed,
  running,
  addedTime = 0,
  period,
  theme: themeProp,
}: {
  match: Match;
  elapsed: number;
  running: boolean;
  addedTime?: number;
  period?: string;
  theme?: ResolvedScoreboardTheme;
}) {
  const theme = themeProp ?? mergeScoreboardTheme(null);
  const accent = running ? theme.timerRunningColor : theme.timerPausedColor;
  return (
    <motion.div
      key="scoreboard-strip"
      initial={{ y: theme.stripHeightPx, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: theme.stripHeightPx, opacity: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="absolute left-0 right-0 bottom-0"
      style={{ height: theme.stripHeightPx, fontFamily: theme.fontFamily }}
    >
      <div className="absolute inset-0" style={{ background: frameGradientCss(theme) }} />
      <div
        className="absolute inset-x-0 top-0 h-[6px]"
        style={{
          background: `linear-gradient(90deg, ${match.homeTeam.primaryColor} 0%, ${match.homeTeam.primaryColor} 50%, ${match.awayTeam.primaryColor} 50%, ${match.awayTeam.primaryColor} 100%)`,
        }}
      />
      <div className="relative h-full flex items-center px-10">
        <div className="flex items-center gap-5 flex-1 min-w-0">
          {theme.showLogos ? <TeamLogo team={match.homeTeam} size={theme.stripLogoPx} /> : null}
          {theme.fullShowTeamNames ? (
            <div
              className={`font-black leading-none truncate ${theme.fullTeamNameUppercase ? "uppercase" : ""}`}
              style={{ fontSize: theme.stripPeriodPx + 8, color: theme.teamNameColor }}
            >
              {match.homeTeam.shortName || match.homeTeam.name}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-8 px-8 shrink-0">
          {theme.showScores ? (
            <div
              className="font-black tabular-nums leading-none"
              style={{ fontSize: theme.stripScorePx, color: theme.scoreColor }}
            >
              {match.homeScore}
            </div>
          ) : null}
          <div className="flex flex-col items-center gap-1">
            {theme.fullShowPeriod ? (
              <div
                className="uppercase tracking-widest text-white/50"
                style={{ fontSize: theme.stripPeriodPx }}
              >
                {period ?? "LIVE"}
              </div>
            ) : null}
            {theme.showClock ? (
              <StableClockText
                value={formatTime(elapsed)}
                className="font-black leading-none"
                style={{ fontSize: theme.stripTimerPx, color: accent }}
              />
            ) : null}
            {theme.showClock && theme.fullShowAddedTime && addedTime > 0 && (
              <div
                className="rounded-md px-3 py-1 font-bold tabular-nums"
                style={{
                  fontSize: Math.max(14, theme.stripPeriodPx),
                  background: accent,
                  color: "#0a0a0a",
                }}
              >
                +{addedTime}
              </div>
            )}
          </div>
          {theme.showScores ? (
            <div
              className="font-black tabular-nums leading-none"
              style={{ fontSize: theme.stripScorePx, color: theme.scoreColor }}
            >
              {match.awayScore}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-5 flex-1 justify-end min-w-0">
          {theme.fullShowTeamNames ? (
            <div
              className={`font-black leading-none truncate ${theme.fullTeamNameUppercase ? "uppercase" : ""}`}
              style={{ fontSize: theme.stripPeriodPx + 8, color: theme.teamNameColor }}
            >
              {match.awayTeam.shortName || match.awayTeam.name}
            </div>
          ) : null}
          {theme.showLogos ? <TeamLogo team={match.awayTeam} size={theme.stripLogoPx} /> : null}
        </div>
      </div>
    </motion.div>
  );
}

/** Onderstrip + content erboven (sponsors / leeg vlak). */
export function StripScoreboardLayout({
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
  return (
    <div className="absolute inset-0" style={{ fontFamily: theme.fontFamily }}>
      <div
        className="absolute overflow-hidden"
        style={{
          left: 0,
          right: 0,
          top: 0,
          bottom: theme.stripHeightPx,
          background: theme.contentAreaBg,
        }}
      >
        <DisplayMediaStage>{children}</DisplayMediaStage>
      </div>
      <ScoreboardStrip
        match={match}
        elapsed={elapsed}
        running={running}
        period={period}
        addedTime={addedTime}
        theme={theme}
      />
    </div>
  );
}

export function TeamLogo({
  team,
  size,
  className,
  style,
}: {
  team: { logoPath: string | null; primaryColor: string; shortName: string };
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const box = size != null ? { width: size, height: size } : undefined;
  if (team.logoPath) {
    return (
      <img
        src={mediaUrl(team.logoPath)}
        alt=""
        width={size}
        height={size}
        className={className}
        style={{ ...box, objectFit: "contain", ...style }}
      />
    );
  }
  return (
    <div
      className={`flex items-center justify-center rounded-full font-black text-white ${className ?? ""}`}
      style={{
        ...box,
        background: team.primaryColor,
        fontSize: size != null ? size * 0.4 : "40%",
        ...style,
      }}
    >
      {team.shortName.slice(0, 2)}
    </div>
  );
}
