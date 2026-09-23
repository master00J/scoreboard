"use client";

import type { ReactNode } from "react";
import { StableClockText } from "@/components/stable-clock-text";
import { formatSportClock } from "@/lib/sports";
import type { Match } from "@/lib/types";
import { mediaUrl } from "@/lib/media-url";
import {
  mergeScoreboardTheme,
  slotStyle,
  type ResolvedScoreboardTheme,
} from "@/lib/scoreboard-theme";
import { getSportProfile } from "@/lib/sports";
import { DisplayMediaStage } from "@/components/display-media-stage";
import { TeamLogo } from "./scoreboard-strip";
import { ShotClockReadout, SportMatchMeta, SportTeamExtras, useShotClockOff } from "./sport-score-extras";

export function CustomScoreboardLayout({
  match,
  elapsed,
  running,
  period,
  addedTime = 0,
  shotClock = 0,
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
  const showShot = getSportProfile(match.sport).shotClockPresets.length > 0 && !useShotClockOff();
  const frameSrc = mediaUrl(theme.leftFrameBackgroundPath);

  return (
    <div className="absolute inset-0" style={{ fontFamily: theme.fontFamily, background: theme.contentAreaBg }}>
      {frameSrc ? (
        <img
          src={frameSrc}
          alt=""
          className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
        />
      ) : null}
      <div className="absolute z-10 overflow-hidden" style={slotStyle(theme.slots.sponsor)}>
        <DisplayMediaStage>{children}</DisplayMediaStage>
      </div>

      <TeamLogoChip
        team={match.homeTeam}
        match={match}
        side="home"
        theme={theme}
        style={slotStyle(theme.slots.home)}
      />
      <TeamScoreChip
        score={match.homeScore}
        match={match}
        side="home"
        theme={theme}
        style={slotStyle(theme.slots.homeScore)}
      />
      <TeamLogoChip
        team={match.awayTeam}
        match={match}
        side="away"
        theme={theme}
        style={slotStyle(theme.slots.away)}
      />
      <TeamScoreChip
        score={match.awayScore}
        match={match}
        side="away"
        theme={theme}
        style={slotStyle(theme.slots.awayScore)}
      />

      {theme.showClock || theme.fullShowPeriod || getSportProfile(match.sport).hasSets || getSportProfile(match.sport).shotClockPresets.length > 0 ? (
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
                value={formatSportClock(match.sport, elapsed)}
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
            <SportMatchMeta match={match} shotClock={shotClock} />
          </div>
        </div>
      ) : null}
      {showShot ? (
        <div
          className="absolute z-20 box-border overflow-hidden"
          style={{ ...slotStyle(theme.slots.shotClock), containerType: "size" }}
        >
          <ShotClockReadout seconds={shotClock} fontSize="min(72cqh, 80cqw)" />
        </div>
      ) : null}
    </div>
  );
}

function TeamLogoChip({
  team,
  match,
  side,
  theme,
  style,
}: {
  team: Match["homeTeam"];
  match: Match;
  side: "home" | "away";
  theme: ResolvedScoreboardTheme;
  style: { left: string; top: string; width: string; height: string };
}) {
  return (
    <div className="absolute z-20 box-border overflow-hidden" style={{ ...style, containerType: "size" }}>
      <div className="flex h-full w-full flex-col items-center justify-center gap-[4cqh] px-[8cqw] py-[8cqh]">
        {theme.showLogos ? (
          <TeamLogo
            team={team}
            style={{
              width: "min(86cqw, 78cqh)",
              height: "min(86cqw, 78cqh)",
              maxWidth: "100%",
              maxHeight: theme.fullShowTeamNames ? "72%" : "92%",
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
        {!theme.showScores ? <SportTeamExtras match={match} side={side} compact /> : null}
      </div>
    </div>
  );
}

function TeamScoreChip({
  score,
  match,
  side,
  theme,
  style,
}: {
  score: number;
  match: Match;
  side: "home" | "away";
  theme: ResolvedScoreboardTheme;
  style: { left: string; top: string; width: string; height: string };
}) {
  if (!theme.showScores) return null;
  return (
    <div className="absolute z-20 box-border overflow-hidden" style={{ ...style, containerType: "size" }}>
      <div className="flex h-full w-full flex-col items-center justify-center gap-[6cqh] px-[6cqw] py-[6cqh]">
        <div
          className="shrink-0 font-black tabular-nums leading-none"
          style={{
            fontSize: "min(72cqh, 58cqw, 220px)",
            color: theme.scoreColor,
            textShadow: "0 4px 18px rgba(0,0,0,0.45)",
          }}
        >
          {score}
        </div>
        <SportTeamExtras match={match} side={side} compact />
      </div>
    </div>
  );
}
