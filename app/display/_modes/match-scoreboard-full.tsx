"use client";

import { motion } from "framer-motion";
import type { Match } from "@/lib/types";
import { StableClockText } from "@/components/stable-clock-text";
import { formatTime } from "@/lib/utils";
import {
  type ResolvedScoreboardTheme,
  mergeScoreboardTheme,
} from "@/lib/scoreboard-theme";
import { TeamLogo } from "./scoreboard-strip";
import { SportMatchMeta, SportTeamExtras } from "./sport-score-extras";

/**
 * Volledig scherm tijdens de match zonder sponsorpaneel: thuis links, uit rechts,
 * timer en periode in het midden (horizontaal scorebord).
 */
export function MatchScoreboardFull({
  match,
  elapsed,
  running,
  period,
  addedTime = 0,
  shotClock = 0,
  theme: themeProp,
}: {
  match: Match;
  elapsed: number;
  running: boolean;
  period: string;
  addedTime?: number;
  shotClock?: number;
  theme?: ResolvedScoreboardTheme;
}) {
  const theme = themeProp ?? mergeScoreboardTheme(null);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="absolute inset-0 flex flex-row items-stretch justify-between"
      style={{
        fontFamily: theme.fontFamily,
        background: `
          radial-gradient(ellipse 55% 70% at 18% 50%, ${match.homeTeam.primaryColor}${theme.fullTeamRadialAlphaHex} 0%, transparent 65%),
          radial-gradient(ellipse 55% 70% at 82% 50%, ${match.awayTeam.primaryColor}${theme.fullTeamRadialAlphaHex} 0%, transparent 65%),
          ${theme.contentAreaBg}`,
      }}
    >
      <TeamSide
        team={match.homeTeam}
        score={match.homeScore}
        match={match}
        side="home"
        theme={theme}
      />
      <CenterBlock
        match={match}
        elapsed={elapsed}
        running={running}
        period={period}
        addedTime={addedTime}
        shotClock={shotClock}
        theme={theme}
      />
      <TeamSide
        team={match.awayTeam}
        score={match.awayScore}
        match={match}
        side="away"
        theme={theme}
      />
    </motion.div>
  );
}

function TeamSide({
  team,
  score,
  match,
  side,
  theme,
}: {
  team: Match["homeTeam"];
  score: number;
  match: Match;
  side: "home" | "away";
  theme: ResolvedScoreboardTheme;
}) {
  const nameEl = theme.fullShowTeamNames ? (
        <div
          className={`max-w-full px-2 text-center font-bold leading-tight ${theme.fullTeamNameUppercase ? "uppercase tracking-wide" : ""}`}
          style={{
            fontSize: theme.fullTeamNamePx,
            color: theme.teamNameColor,
            textShadow: "0 4px 24px rgba(0,0,0,0.45)",
          }}
        >
          <span className="line-clamp-3">{team.shortName || team.name}</span>
        </div>
      ) : null;
  const logoEl = theme.showLogos ? <TeamLogo team={team} size={theme.fullLogoPx} /> : null;
  const scoreEl = theme.showScores ? (
        <div
          className="font-black tabular-nums leading-none"
          style={{
            fontSize: theme.fullScorePx,
            color: theme.scoreColor,
            textShadow: "0 8px 40px rgba(0,0,0,0.55)",
          }}
        >
          {score}
        </div>
      ) : null;
  const stack =
    theme.fullTeamStackOrder === "name-logo-score"
      ? [nameEl, logoEl, scoreEl]
      : theme.fullTeamStackOrder === "logo-score-name"
        ? [logoEl, scoreEl, nameEl]
        : theme.fullTeamStackOrder === "score-name-logo"
          ? [scoreEl, nameEl, logoEl]
          : [logoEl, nameEl, scoreEl];

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center z-10 min-w-0"
      style={{
        gap: theme.fullTeamStackGapPx,
        paddingLeft: theme.fullSidePaddingPx,
        paddingRight: theme.fullSidePaddingPx,
      }}
    >
      {stack}
      <SportTeamExtras match={match} side={side} />
    </div>
  );
}

function CenterBlock({
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
      className="flex shrink-0 flex-col items-center justify-center z-10 min-w-0"
      style={{
        width: theme.fullCenterWidthPx,
        gap: theme.fullCenterStackGapPx,
      }}
    >
      {theme.fullShowPeriod && (
        <div
          className="uppercase leading-none tracking-[0.35em] text-white/55"
          style={{ fontSize: theme.fullPeriodPx }}
        >
          {period}
        </div>
      )}
      <div className="flex items-end justify-center gap-4">
        {theme.showClock && (
        <StableClockText
          value={formatTime(elapsed)}
          className="font-black leading-none text-white"
          style={{
            fontSize: theme.fullTimerPx,
            textShadow: "0 6px 36px rgba(0,0,0,0.5)",
            opacity: running ? 1 : 0.82,
            color: accent,
          }}
        />
        )}
        {theme.showClock && theme.fullShowAddedTime && addedTime > 0 && (
          <div
            className="mb-1 rounded-md px-4 py-2 font-black tabular-nums"
            style={{
              fontSize: Math.max(18, theme.fullTimerPx * 0.27),
              background: accent,
              color: "#0a0a0a",
            }}
          >
            +{addedTime}
          </div>
        )}
      </div>
      <SportMatchMeta match={match} shotClock={shotClock} />
    </div>
  );
}
