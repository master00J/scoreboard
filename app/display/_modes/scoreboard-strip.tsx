"use client";

import { motion } from "framer-motion";
import type { Match } from "@/lib/types";
import { formatTime } from "@/lib/utils";
import { mediaUrl } from "@/lib/media-url";

export function ScoreboardStrip({
  match,
  elapsed,
  running,
  addedTime = 0,
  period,
}: {
  match: Match;
  elapsed: number;
  running: boolean;
  addedTime?: number;
  period?: string;
}) {
  return (
    <motion.div
      key="scoreboard-strip"
      initial={{ y: 180, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 180, opacity: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="absolute left-0 right-0 bottom-0"
      style={{ height: 180 }}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-slate-900/90 to-black" />
      <div
        className="absolute inset-x-0 top-0 h-[6px]"
        style={{
          background: `linear-gradient(90deg, ${match.homeTeam.primaryColor} 0%, ${match.homeTeam.primaryColor} 50%, ${match.awayTeam.primaryColor} 50%, ${match.awayTeam.primaryColor} 100%)`,
        }}
      />
      <div className="relative h-full flex items-center px-12">
        {/* Home */}
        <div className="flex items-center gap-6 flex-1">
          <TeamLogo team={match.homeTeam} size={120} />
          <div className="flex flex-col">
            <div className="text-[28px] uppercase text-white/50 tracking-widest leading-tight">
              {match.homeTeam.name}
            </div>
            <div
              className="text-[64px] font-black leading-none"
              style={{ color: match.homeTeam.primaryColor }}
            >
              {match.homeTeam.shortName}
            </div>
          </div>
        </div>
        {/* Score + Timer */}
        <div className="flex items-center gap-10 px-10">
          <div className="text-[120px] font-black tabular-nums leading-none text-white">
            {match.homeScore}
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="text-[24px] uppercase tracking-widest text-white/40">
              {period ?? "LIVE"}
            </div>
            <div
              className="text-[72px] font-black tabular-nums leading-none"
              style={{ color: running ? "#22c55e" : "#f59e0b" }}
            >
              {formatTime(elapsed)}
            </div>
            {addedTime > 0 && (
              <div className="mt-1 px-3 py-1 bg-amber-500 text-black rounded-md text-[24px] font-bold tabular-nums">
                +{addedTime}
              </div>
            )}
          </div>
          <div className="text-[120px] font-black tabular-nums leading-none text-white">
            {match.awayScore}
          </div>
        </div>
        {/* Away */}
        <div className="flex items-center gap-6 flex-1 justify-end">
          <div className="flex flex-col items-end">
            <div className="text-[28px] uppercase text-white/50 tracking-widest leading-tight">
              {match.awayTeam.name}
            </div>
            <div
              className="text-[64px] font-black leading-none"
              style={{ color: match.awayTeam.primaryColor }}
            >
              {match.awayTeam.shortName}
            </div>
          </div>
          <TeamLogo team={match.awayTeam} size={120} />
        </div>
      </div>
    </motion.div>
  );
}

export function TeamLogo({
  team,
  size,
}: {
  team: { logoPath: string | null; primaryColor: string; shortName: string };
  size: number;
}) {
  if (team.logoPath) {
    return (
      <img
        src={mediaUrl(team.logoPath)}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: "contain" }}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded-full font-black text-white"
      style={{
        width: size,
        height: size,
        background: team.primaryColor,
        fontSize: size * 0.4,
      }}
    >
      {team.shortName.slice(0, 2)}
    </div>
  );
}
