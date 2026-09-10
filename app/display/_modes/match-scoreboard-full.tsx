"use client";

import { motion } from "framer-motion";
import type { Match } from "@/lib/types";
import { StableClockText } from "@/components/stable-clock-text";
import {
  type ResolvedScoreboardTheme,
  mergeScoreboardTheme,
  slotStyle,
} from "@/lib/scoreboard-theme";
import { TeamLogo } from "./scoreboard-strip";
import { formatSportClock, getSportProfile, type SportProfile } from "@/lib/sports";
import { SportMatchMeta, SportTeamExtras, sportHasTeamExtras } from "./sport-score-extras";

/**
 * Volledig scherm tijdens de match zonder sponsorpaneel: thuis, klok en uit
 * op vrije vakken (fullSlots).
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
  const profile = getSportProfile(match.sport);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="absolute inset-0"
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
        profile={profile}
        theme={theme}
        style={slotStyle(theme.fullSlots.home)}
      />
      <CenterBlock
        match={match}
        elapsed={elapsed}
        running={running}
        period={period}
        addedTime={addedTime}
        shotClock={shotClock}
        theme={theme}
        style={slotStyle(theme.fullSlots.clock)}
      />
      <TeamSide
        team={match.awayTeam}
        score={match.awayScore}
        match={match}
        side="away"
        profile={profile}
        theme={theme}
        style={slotStyle(theme.fullSlots.away)}
      />
    </motion.div>
  );
}

function TeamSide({
  team,
  score,
  match,
  side,
  profile,
  theme,
  style,
}: {
  team: Match["homeTeam"];
  score: number;
  match: Match;
  side: "home" | "away";
  profile: SportProfile;
  theme: ResolvedScoreboardTheme;
  style: { left: string; top: string; width: string; height: string };
}) {
  const nameEl = theme.fullShowTeamNames ? (
    <div
      className={`max-w-full shrink-0 px-[4cqw] text-center font-bold leading-tight ${theme.fullTeamNameUppercase ? "uppercase tracking-wide" : ""}`}
      style={{
        fontSize: `min(${theme.fullTeamNamePx}px, 14cqh, 12cqw)`,
        color: theme.teamNameColor,
        textShadow: "0 4px 24px rgba(0,0,0,0.45)",
      }}
    >
      <span className="line-clamp-3">{team.shortName || team.name}</span>
    </div>
  ) : null;
  const showExtras = sportHasTeamExtras(profile.id);
  const logoEl = theme.showLogos ? (
    <TeamLogo
      team={team}
      style={{
        width: "min(78cqw, 48cqh)",
        height: "min(78cqw, 48cqh)",
        maxWidth: "100%",
        maxHeight: showExtras && theme.showScores ? "42%" : theme.showScores ? "56%" : "86%",
        flexShrink: 1,
        minHeight: 0,
      }}
    />
  ) : null;
  const scoreEl = theme.showScores ? (
    <div
      className="shrink-0 font-black tabular-nums leading-none"
      style={{
        fontSize: `min(${theme.fullScorePx}px, ${showExtras ? 32 : 40}cqh, 50cqw)`,
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
      className="absolute z-10 box-border overflow-hidden"
      style={{ ...style, containerType: "size" }}
    >
      <div
        className="flex h-full min-h-0 w-full min-w-0 flex-col items-center justify-center"
        style={{ gap: `${Math.min(theme.fullTeamStackGapPx, 12)}cqh` }}
      >
        {stack}
        {showExtras && (
          <SportTeamExtras
            match={match}
            side={side}
            style={{ fontSize: "clamp(11px, 5.5cqw, 18px)", paddingBlock: "0.4em" }}
          />
        )}
      </div>
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
  style,
}: {
  match: Match;
  elapsed: number;
  running: boolean;
  period: string;
  addedTime: number;
  shotClock: number;
  theme: ResolvedScoreboardTheme;
  style: { left: string; top: string; width: string; height: string };
}) {
  const accent = running ? theme.timerRunningColor : theme.timerPausedColor;
  return (
    <div
      className="absolute z-10 box-border overflow-hidden"
      style={{ ...style, containerType: "size" }}
    >
      <div
        className="flex h-full w-full flex-col items-center justify-center min-w-0"
        style={{ gap: `${Math.min(theme.fullCenterStackGapPx, 10)}cqh` }}
      >
        {theme.fullShowPeriod && (
          <div
            className="uppercase leading-none tracking-[0.35em] text-white/55"
            style={{ fontSize: `min(${theme.fullPeriodPx}px, 14cqh, 10cqw)` }}
          >
            {period}
          </div>
        )}
        <div className="flex items-end justify-center gap-[4cqw]">
          {theme.showClock && (
            <StableClockText
              value={formatSportClock(match.sport, elapsed)}
              className="font-black leading-none text-white"
              style={{
                fontSize: `min(${theme.fullTimerPx}px, 42cqh, 36cqw)`,
                textShadow: "0 6px 36px rgba(0,0,0,0.5)",
                opacity: running ? 1 : 0.82,
                color: accent,
              }}
            />
          )}
          {theme.showClock && theme.fullShowAddedTime && addedTime > 0 && (
            <div
              className="mb-[2cqh] rounded-md px-[4cqw] py-[2cqh] font-black tabular-nums"
              style={{
                fontSize: `min(${Math.max(18, theme.fullTimerPx * 0.27)}px, 16cqh, 12cqw)`,
                background: accent,
                color: "#0a0a0a",
              }}
            >
              +{addedTime}
            </div>
          )}
        </div>
        <SportMatchMeta match={match} shotClock={shotClock} scale={1} />
      </div>
    </div>
  );
}
