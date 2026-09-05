"use client";

import { motion } from "framer-motion";
import type { Match } from "@/lib/types";
import { StableClockText } from "@/components/stable-clock-text";
import { formatTime } from "@/lib/utils";
import {
  type ResolvedScoreboardTheme,
  mergeScoreboardTheme,
  slotStyle,
} from "@/lib/scoreboard-theme";
import { TeamLogo } from "./scoreboard-strip";
import { getSportProfile, type SportProfile } from "@/lib/sports";

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
        timeouts={match.homeTimeouts}
        fouls={match.homeFouls}
        sets={match.homeSets}
        profile={profile}
        theme={theme}
        style={slotStyle(theme.fullSlots.home)}
      />
      <CenterBlock
        elapsed={elapsed}
        running={running}
        period={period}
        addedTime={addedTime}
        shotClock={shotClock}
        showShotClock={profile.shotClockPresets.length > 0}
        theme={theme}
        style={slotStyle(theme.fullSlots.clock)}
      />
      <TeamSide
        team={match.awayTeam}
        score={match.awayScore}
        timeouts={match.awayTimeouts}
        fouls={match.awayFouls}
        sets={match.awaySets}
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
  timeouts,
  fouls,
  sets,
  profile,
  theme,
  style,
}: {
  team: Match["homeTeam"];
  score: number;
  timeouts: number;
  fouls: number;
  sets: number;
  profile: SportProfile;
  theme: ResolvedScoreboardTheme;
  style: { left: string; top: string; width: string; height: string };
}) {
  const nameEl = theme.fullShowTeamNames ? (
    <div
      className={`max-w-full px-[4cqw] text-center font-bold leading-tight ${theme.fullTeamNameUppercase ? "uppercase tracking-wide" : ""}`}
      style={{
        fontSize: `min(${theme.fullTeamNamePx}px, 14cqh, 12cqw)`,
        color: theme.teamNameColor,
        textShadow: "0 4px 24px rgba(0,0,0,0.45)",
      }}
    >
      <span className="line-clamp-3">{team.shortName || team.name}</span>
    </div>
  ) : null;
  const logoEl = theme.showLogos ? (
    <TeamLogo
      team={team}
      style={{
        width: "min(78cqw, 48cqh)",
        height: "min(78cqw, 48cqh)",
        maxWidth: "100%",
        maxHeight: theme.showScores ? "56%" : "86%",
      }}
    />
  ) : null;
  const scoreEl = theme.showScores ? (
    <div
      className="font-black tabular-nums leading-none"
      style={{
        fontSize: `min(${theme.fullScorePx}px, 40cqh, 50cqw)`,
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
        className="flex h-full w-full flex-col items-center justify-center min-w-0"
        style={{ gap: `${Math.min(theme.fullTeamStackGapPx, 12)}cqh` }}
      >
        {stack}
        {(profile.timeoutLimitForPeriod(1) > 0 || profile.statLabel || profile.hasSets) && (
          <div className="flex flex-wrap items-center justify-center gap-[2cqw] text-center font-bold uppercase tracking-wider text-white/65"
            style={{ fontSize: "min(18px, 8cqh, 10cqw)" }}
          >
            {profile.hasSets && <span>Sets {sets}</span>}
            {profile.timeoutLimitForPeriod(1) > 0 && <span>TO {timeouts}</span>}
            {profile.statLabel && <span>{profile.statLabel} {fouls}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function CenterBlock({
  elapsed,
  running,
  period,
  addedTime,
  shotClock,
  showShotClock,
  theme,
  style,
}: {
  elapsed: number;
  running: boolean;
  period: string;
  addedTime: number;
  shotClock: number;
  showShotClock: boolean;
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
              value={formatTime(elapsed)}
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
        {showShotClock && (
          <div className="mt-[2cqh] rounded-xl border border-red-400/50 bg-red-600/15 px-[6cqw] py-[3cqh] text-center">
            <div className="text-[min(14px,6cqh)] font-bold uppercase tracking-[0.3em] text-red-200/80">
              Shotclock
            </div>
            <div className="mt-[1cqh] font-black tabular-nums leading-none text-red-400"
              style={{ fontSize: "min(64px, 28cqh, 24cqw)" }}
            >
              {Math.ceil(shotClock)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
