"use client";

import { Fragment } from "react";
import { StableClockText } from "@/components/stable-clock-text";
import type { Match } from "@/lib/types";
import {
  type ResolvedScoreboardTheme,
  frameGradientCss,
  mergeScoreboardTheme,
} from "@/lib/scoreboard-theme";
import { DisplayMediaStage } from "@/components/display-media-stage";
import { TeamLogo } from "./scoreboard-strip";
import { formatSportClock, getSportProfile, type SportProfile } from "@/lib/sports";
import { SportMatchMeta, SportTeamExtras, sportHasTeamExtras } from "./sport-score-extras";

/**
 * Vast 1920×1080-layout tijdens actieve match / sponsor naast scorebord.
 *
 * L-frame: linker kolom en onderrail volgens thema (breedte/hoogte/kleuren).
 * Blokken (thuis / klok / uit) kunnen via `leftColumnOrder` worden herschikt.
 */
export function LeftScoreboardLayout({
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
  children?: React.ReactNode;
}) {
  const theme = themeProp ?? mergeScoreboardTheme(null);
  const profile = getSportProfile(match.sport);
  const barW = theme.leftBarWidthPx;
  const barH = theme.bottomBarHeightPx;
  const grad = frameGradientCss(theme);

  return (
    <div
      className="absolute inset-0"
      style={{ fontFamily: theme.fontFamily }}
    >
      <div
        className="absolute left-0 top-0 z-0"
        style={{ width: barW, height: "100%", background: grad }}
      />
      <div
        className="absolute bottom-0 z-0"
        style={{ left: barW, right: 0, height: barH, background: grad }}
      />

      <div
        className="absolute z-20 flex flex-col"
        style={{ left: 0, top: 0, width: barW, height: `calc(100% - ${barH}px)` }}
      >
        {theme.leftColumnOrder.map((seg, i) => (
          <Fragment key={`${seg}-${i}`}>
            {i > 0 && <Divider />}
            {seg === "home" && (
              <div className="flex min-h-0 flex-1 flex-col">
                <TeamBlock
                  team={match.homeTeam}
                  score={match.homeScore}
                  match={match}
                  side="home"
                  profile={profile}
                  theme={theme}
                />
              </div>
            )}
            {seg === "timer" && (
              <TimerBlock
                match={match}
                elapsed={elapsed}
                running={running}
                period={period}
                addedTime={addedTime}
                shotClock={shotClock}
                theme={theme}
              />
            )}
            {seg === "away" && (
              <div className="flex min-h-0 flex-1 flex-col">
                <TeamBlock
                  team={match.awayTeam}
                  score={match.awayScore}
                  match={match}
                  side="away"
                  profile={profile}
                  theme={theme}
                />
              </div>
            )}
          </Fragment>
        ))}
      </div>

      <div
        className="absolute z-10 overflow-hidden"
        style={{
          left: barW,
          top: 0,
          right: 0,
          bottom: barH,
          background: theme.contentAreaBg,
        }}
      >
        <DisplayMediaStage>{children}</DisplayMediaStage>
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div
      className="mx-6 shrink-0"
      style={{
        height: 2,
        background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)",
      }}
    />
  );
}

function TeamBlock({
  team,
  score,
  match,
  side,
  profile,
  theme,
}: {
  team: Match["homeTeam"];
  score: number;
  match: Match;
  side: "home" | "away";
  profile: SportProfile;
  theme: ResolvedScoreboardTheme;
}) {
  const showExtras = sportHasTeamExtras(profile.id);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-4">
      {theme.showLogos ? (
        <TeamLogo
          team={team}
          size={theme.leftLogoPx}
          style={{ maxHeight: showExtras ? "38%" : "56%", width: "auto" }}
        />
      ) : null}
      {theme.fullShowTeamNames ? (
        <div
          className={`max-w-full shrink-0 px-2 text-center font-bold leading-tight ${theme.fullTeamNameUppercase ? "uppercase tracking-wide" : ""}`}
          style={{
            fontSize: Math.max(12, theme.leftPeriodPx + 4),
            color: theme.teamNameColor,
          }}
        >
          <span className="line-clamp-2">{team.shortName || team.name}</span>
        </div>
      ) : null}
      {theme.showScores ? (
      <div
        className="shrink-0 font-black tabular-nums leading-none"
        style={{
          fontSize: showExtras ? Math.round(theme.leftScorePx * 0.78) : theme.leftScorePx,
          color: theme.scoreColor,
          textShadow: "0 4px 20px rgba(0,0,0,0.4)",
        }}
      >
        {score}
      </div>
      ) : null}
      {showExtras && (
        <SportTeamExtras
          match={match}
          side={side}
          className="flex w-full max-w-full shrink-0 flex-nowrap justify-center gap-1.5 px-2 text-center text-[13px] font-bold uppercase leading-none tracking-wide text-white/65"
        />
      )}
    </div>
  );
}

function TimerBlock({
  match,
  elapsed,
  running,
  period,
  addedTime,
  shotClock,
  theme,
}: {
  match: Match;
  elapsed: number;
  running: boolean;
  period: string;
  addedTime: number;
  shotClock: number;
  theme: ResolvedScoreboardTheme;
}) {
  const accent = running ? theme.timerRunningColor : theme.timerPausedColor;
  return (
    <div
      className="flex shrink-0 flex-col items-center justify-center"
      style={{ height: theme.leftTimerBlockHeightPx }}
    >
      {theme.fullShowPeriod ? (
      <div
        className="uppercase leading-none tracking-[0.25em] text-white/70"
        style={{ fontSize: theme.leftPeriodPx }}
      >
        {period}
      </div>
      ) : null}
      <div className="mt-2 flex items-end justify-center gap-3">
        {theme.showClock ? (
        <StableClockText
          value={formatSportClock(match.sport, elapsed)}
          className="font-black leading-none text-white"
          style={{
            fontSize: theme.leftTimerPx,
            textShadow: "0 4px 18px rgba(0,0,0,0.4)",
            opacity: running ? 1 : 0.75,
            color: accent,
          }}
        />
        ) : null}
        {theme.showClock && theme.fullShowAddedTime && addedTime > 0 && (
          <div
            className="mb-1 rounded px-3 py-1 font-black tabular-nums text-white"
            style={{
              fontSize: Math.max(14, theme.leftTimerPx * 0.35),
              background: accent,
              color: "#0a0a0a",
            }}
          >
            +{addedTime}
          </div>
        )}
      </div>
      <div className="mt-2">
        <SportMatchMeta match={match} shotClock={shotClock} scale={0.6} />
      </div>
    </div>
  );
}
