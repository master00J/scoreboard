"use client";

import { motion } from "framer-motion";
import type { Match } from "@/lib/types";
import { formatTime } from "@/lib/utils";
import {
  type ResolvedScoreboardTheme,
  mergeScoreboardTheme,
} from "@/lib/scoreboard-theme";
import { TeamLogo } from "./scoreboard-strip";

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
  theme: themeProp,
}: {
  match: Match;
  elapsed: number;
  running: boolean;
  period: string;
  addedTime?: number;
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
      <TeamSide team={match.homeTeam} score={match.homeScore} theme={theme} />
      <CenterBlock
        elapsed={elapsed}
        running={running}
        period={period}
        addedTime={addedTime}
        theme={theme}
      />
      <TeamSide team={match.awayTeam} score={match.awayScore} theme={theme} />
    </motion.div>
  );
}

function TeamSide({
  team,
  score,
  theme,
}: {
  team: Match["homeTeam"];
  score: number;
  theme: ResolvedScoreboardTheme;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center z-10 min-w-0"
      style={{
        gap: theme.fullTeamStackGapPx,
        paddingLeft: theme.fullSidePaddingPx,
        paddingRight: theme.fullSidePaddingPx,
      }}
    >
      <TeamLogo team={team} size={theme.fullLogoPx} />
      {theme.fullShowTeamNames && (
        <div
          className={`max-w-full px-2 text-center font-bold leading-tight text-white/88 ${theme.fullTeamNameUppercase ? "uppercase tracking-wide" : ""}`}
          style={{
            fontSize: theme.fullTeamNamePx,
            textShadow: "0 4px 24px rgba(0,0,0,0.45)",
          }}
        >
          <span className="line-clamp-3">{team.shortName || team.name}</span>
        </div>
      )}
      <div
        className="font-black tabular-nums leading-none text-white"
        style={{
          fontSize: theme.fullScorePx,
          textShadow: "0 8px 40px rgba(0,0,0,0.55)",
        }}
      >
        {score}
      </div>
    </div>
  );
}

function CenterBlock({
  elapsed,
  running,
  period,
  addedTime,
  theme,
}: {
  elapsed: number;
  running: boolean;
  period: string;
  addedTime: number;
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
      <div
        className="font-black tabular-nums leading-none text-white"
        style={{
          fontSize: theme.fullTimerPx,
          textShadow: "0 6px 36px rgba(0,0,0,0.5)",
          opacity: running ? 1 : 0.82,
          color: accent,
        }}
      >
        {formatTime(elapsed)}
      </div>
      {theme.fullShowAddedTime && addedTime > 0 && (
        <div
          className="rounded-md px-4 py-2 font-black tabular-nums"
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
  );
}
