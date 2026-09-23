"use client";

import { motion } from "framer-motion";
import { StableClockText } from "@/components/stable-clock-text";
import type { Match } from "@/lib/types";
import { mediaUrl } from "@/lib/media-url";
import {
  type ResolvedScoreboardTheme,
  mergeScoreboardTheme,
  slotStyle,
} from "@/lib/scoreboard-theme";
import { formatSportClock, getSportProfile } from "@/lib/sports";
import { TeamLogo } from "./scoreboard-strip";
import { ShotClockReadout, SportMatchMeta, SportTeamExtras, useShotClockOff } from "./sport-score-extras";

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
  const shotOff = useShotClockOff();
  const showShot = getSportProfile(match.sport).shotClockPresets.length > 0 && !shotOff;
  const backgroundSrc = mediaUrl(theme.fullBackgroundPath);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="absolute inset-0"
      style={{
        fontFamily: theme.fontFamily,
        background: theme.contentAreaBg,
      }}
    >
      {backgroundSrc ? (
        <img
          src={backgroundSrc}
          alt=""
          className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
        />
      ) : null}
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background: `
            radial-gradient(ellipse 55% 70% at 18% 50%, ${match.homeTeam.primaryColor}${theme.fullTeamRadialAlphaHex} 0%, transparent 65%),
            radial-gradient(ellipse 55% 70% at 82% 50%, ${match.awayTeam.primaryColor}${theme.fullTeamRadialAlphaHex} 0%, transparent 65%)`,
        }}
      />
      <TeamSide
        team={match.homeTeam}
        match={match}
        side="home"
        theme={theme}
        style={slotStyle(theme.fullSlots.home)}
      />
      <TeamScore
        score={match.homeScore}
        match={match}
        side="home"
        theme={theme}
        style={slotStyle(theme.fullSlots.homeScore)}
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
      {showShot ? (
        <div
          className="absolute z-10 box-border overflow-hidden"
          style={{ ...slotStyle(theme.fullSlots.shotClock), containerType: "size" }}
        >
          <ShotClockReadout seconds={shotClock} fontSize="min(72cqh, 78cqw)" />
        </div>
      ) : null}
      <TeamSide
        team={match.awayTeam}
        match={match}
        side="away"
        theme={theme}
        style={slotStyle(theme.fullSlots.away)}
      />
      <TeamScore
        score={match.awayScore}
        match={match}
        side="away"
        theme={theme}
        style={slotStyle(theme.fullSlots.awayScore)}
      />
    </motion.div>
  );
}

function TeamSide({
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
  const logoEl = theme.showLogos ? (
    <TeamLogo
      team={team}
      style={{
        width: "min(86cqw, 78cqh)",
        height: "min(86cqw, 78cqh)",
        maxWidth: "100%",
        maxHeight: theme.fullShowTeamNames ? "72%" : "92%",
        flexShrink: 1,
        minHeight: 0,
      }}
    />
  ) : null;
  const nameFirst =
    theme.fullTeamStackOrder === "name-logo-score" || theme.fullTeamStackOrder === "score-name-logo";
  const stack = nameFirst ? [nameEl, logoEl] : [logoEl, nameEl];

  return (
    <div className="absolute z-10 box-border overflow-hidden" style={{ ...style, containerType: "size" }}>
      <div
        className="flex h-full w-full flex-col items-center justify-center min-w-0"
        style={{ gap: `${Math.min(theme.fullTeamStackGapPx, 10)}cqh` }}
      >
        {stack}
        {!theme.showScores ? <SportTeamExtras match={match} side={side} /> : null}
      </div>
    </div>
  );
}

function TeamScore({
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
    <div className="absolute z-10 box-border overflow-hidden" style={{ ...style, containerType: "size" }}>
      <div className="flex h-full w-full flex-col items-center justify-center gap-[6cqh] px-[4cqw] py-[4cqh]">
        <div
          className="shrink-0 font-black tabular-nums leading-none"
          style={{
            fontSize: `min(${theme.fullScorePx}px, 72cqh, 70cqw)`,
            color: theme.scoreColor,
            textShadow: "0 8px 40px rgba(0,0,0,0.55)",
          }}
        >
          {score}
        </div>
        <SportTeamExtras match={match} side={side} />
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
        {theme.showClock ? (
          <div className="flex items-end justify-center gap-4">
            <StableClockText
              value={formatSportClock(match.sport, elapsed)}
              className="font-black leading-none"
              style={{
                fontSize: `min(${theme.fullTimerPx}px, 48cqh, 36cqw)`,
                color: accent,
                textShadow: "0 6px 36px rgba(0,0,0,0.5)",
                opacity: running ? 1 : 0.82,
              }}
            />
            {theme.fullShowAddedTime && addedTime > 0 ? (
              <div
                className="mb-1 rounded-md px-4 py-2 font-black tabular-nums"
                style={{
                  fontSize: `min(${Math.max(18, theme.fullTimerPx * 0.27)}px, 16cqh, 12cqw)`,
                  background: accent,
                  color: "#0a0a0a",
                }}
              >
                +{addedTime}
              </div>
            ) : null}
          </div>
        ) : null}
        <SportMatchMeta match={match} shotClock={shotClock} />
      </div>
    </div>
  );
}
