"use client";

import { Fragment } from "react";
import { formatTime } from "@/lib/utils";
import type { Match } from "@/lib/types";
import {
  type ResolvedScoreboardTheme,
  frameGradientCss,
  mergeScoreboardTheme,
} from "@/lib/scoreboard-theme";
import { TeamLogo } from "./scoreboard-strip";

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
  theme: themeProp,
  children,
}: {
  match: Match;
  elapsed: number;
  running: boolean;
  period: string;
  addedTime?: number;
  theme?: ResolvedScoreboardTheme;
  children?: React.ReactNode;
}) {
  const theme = themeProp ?? mergeScoreboardTheme(null);
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
        style={{ width: barW, height: 1080, background: grad }}
      />
      <div
        className="absolute bottom-0 z-0"
        style={{ left: barW, right: 0, height: barH, background: grad }}
      />

      <div
        className="absolute z-20 flex flex-col"
        style={{ left: 0, top: 0, width: barW, height: 1080 - barH }}
      >
        {theme.leftColumnOrder.map((seg, i) => (
          <Fragment key={`${seg}-${i}`}>
            {i > 0 && <Divider />}
            {seg === "home" && (
              <div className="flex min-h-0 flex-1 flex-col">
                <TeamBlock team={match.homeTeam} score={match.homeScore} theme={theme} />
              </div>
            )}
            {seg === "timer" && (
              <TimerBlock
                elapsed={elapsed}
                running={running}
                period={period}
                addedTime={addedTime}
                theme={theme}
              />
            )}
            {seg === "away" && (
              <div className="flex min-h-0 flex-1 flex-col">
                <TeamBlock team={match.awayTeam} score={match.awayScore} theme={theme} />
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
        {children}
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
  theme,
}: {
  team: Match["homeTeam"];
  score: number;
  theme: ResolvedScoreboardTheme;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-4">
      <TeamLogo team={team} size={theme.leftLogoPx} />
      <div
        className="font-black tabular-nums leading-none text-white"
        style={{
          fontSize: theme.leftScorePx,
          textShadow: "0 4px 20px rgba(0,0,0,0.4)",
        }}
      >
        {score}
      </div>
    </div>
  );
}

function TimerBlock({
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
      className="flex shrink-0 flex-col items-center justify-center"
      style={{ height: theme.leftTimerBlockHeightPx }}
    >
      <div
        className="uppercase leading-none tracking-[0.25em] text-white/70"
        style={{ fontSize: theme.leftPeriodPx }}
      >
        {period}
      </div>
      <div
        className="mt-2 font-black tabular-nums leading-none text-white"
        style={{
          fontSize: theme.leftTimerPx,
          textShadow: "0 4px 18px rgba(0,0,0,0.4)",
          opacity: running ? 1 : 0.75,
          color: accent,
        }}
      >
        {formatTime(elapsed)}
      </div>
      {addedTime > 0 && (
        <div
          className="mt-2 rounded px-3 py-1 font-black tabular-nums text-white"
          style={{
            fontSize: Math.max(14, theme.leftTimerPx * 0.42),
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
