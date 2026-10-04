"use client";

import type { CSSProperties, ReactNode } from "react";
import { StableClockText } from "@/components/stable-clock-text";
import { formatSportClock } from "@/lib/sports";
import type { Match } from "@/lib/types";
import { mediaUrl } from "@/lib/media-url";
import { mergeScoreboardTheme, type ResolvedScoreboardTheme } from "@/lib/scoreboard-theme";
import type { LayoutElement } from "@/lib/scoreboard-elements";
import { getSportProfile } from "@/lib/sports";
import { DisplayMediaStage } from "@/components/display-media-stage";
import { ExtraElement, elementBoxStyle, elementInnerStyle } from "./layout-elements";
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
  const profile = getSportProfile(match.sport);
  const showShot = profile.shotClockPresets.length > 0 && !useShotClockOff();
  const showClockBlock =
    theme.showClock || theme.fullShowPeriod || profile.hasSets || profile.shotClockPresets.length > 0;
  const frameSrc = mediaUrl(theme.leftFrameBackgroundPath || theme.scoreboardBackgroundPath);

  return (
    <div className="absolute inset-0" style={{ fontFamily: theme.fontFamily, background: theme.contentAreaBg }}>
      {frameSrc ? (
        <img
          src={frameSrc}
          alt=""
          className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
        />
      ) : null}
      {theme.elements.sponsor.map((element, index) => {
        if (element.hidden) return null;
        const box = elementBoxStyle(element, index);
        const inner = elementInnerStyle(element);
        const side = element.side === "away" ? "away" : "home";
        switch (element.type) {
          case "media":
            return (
              <div key={element.id} className="absolute overflow-hidden" style={box}>
                <DisplayMediaStage>{children}</DisplayMediaStage>
              </div>
            );
          case "teamLogo":
            return (
              <TeamLogoChip
                key={element.id}
                team={side === "away" ? match.awayTeam : match.homeTeam}
                match={match}
                side={side}
                theme={theme}
                element={element}
                style={box}
                inner={inner}
              />
            );
          case "teamScore":
            return (
              <TeamScoreChip
                key={element.id}
                score={side === "away" ? match.awayScore : match.homeScore}
                match={match}
                side={side}
                theme={theme}
                element={element}
                style={box}
                inner={inner}
              />
            );
          case "clock":
            if (!showClockBlock) return null;
            return (
              <div
                key={element.id}
                className="absolute box-border overflow-hidden"
                style={{ ...box, containerType: "size" }}
              >
                <div
                  className="flex h-full w-full flex-col items-center justify-center px-[8cqw] py-[10cqh]"
                  style={inner}
                >
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
                        color: element.style?.color ?? accent,
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
            );
          case "shotClock":
            if (!showShot) return null;
            return (
              <div
                key={element.id}
                className="absolute box-border overflow-hidden"
                style={{ ...box, containerType: "size" }}
              >
                <ShotClockReadout seconds={shotClock} fontSize="min(72cqh, 80cqw)" />
              </div>
            );
          default:
            return (
              <ExtraElement
                key={element.id}
                element={element}
                index={index}
                match={match}
                period={period}
                theme={theme}
              />
            );
        }
      })}
    </div>
  );
}

function TeamLogoChip({
  team,
  match,
  side,
  theme,
  element,
  style,
  inner,
}: {
  team: Match["homeTeam"];
  match: Match;
  side: "home" | "away";
  theme: ResolvedScoreboardTheme;
  element: LayoutElement;
  style: CSSProperties;
  inner: CSSProperties | undefined;
}) {
  return (
    <div className="absolute box-border overflow-hidden" style={{ ...style, containerType: "size" }}>
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-[4cqh] px-[8cqw] py-[8cqh]"
        style={inner}
      >
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
            style={{ fontSize: "min(14cqh, 12cqw, 36px)", color: element.style?.color ?? theme.teamNameColor }}
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
  element,
  style,
  inner,
}: {
  score: number;
  match: Match;
  side: "home" | "away";
  theme: ResolvedScoreboardTheme;
  element: LayoutElement;
  style: CSSProperties;
  inner: CSSProperties | undefined;
}) {
  if (!theme.showScores) return null;
  return (
    <div className="absolute box-border overflow-hidden" style={{ ...style, containerType: "size" }}>
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-[6cqh] px-[6cqw] py-[6cqh]"
        style={inner}
      >
        <div
          className="shrink-0 font-black tabular-nums leading-none"
          style={{
            fontSize: "min(72cqh, 58cqw, 220px)",
            color: element.style?.color ?? theme.scoreColor,
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
