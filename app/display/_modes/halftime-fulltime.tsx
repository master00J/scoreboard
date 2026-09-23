"use client";

import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { Match } from "@/lib/types";
import { getSportProfile, sportBreakLabel } from "@/lib/sports";
import { tSportBreakLabel } from "@/lib/i18n/t-phase";
import { formatSetHistory } from "@/lib/volleyball";

export function HalfTimeMode({ match }: { match: Match }) {
  const { t } = useTranslation();
  const profile = getSportProfile(match.sport);
  const history = formatSetHistory(match.setHistory ?? []);
  const showSetsPrimary = profile.hasSets;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
      className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-black"
    >
      <div className="text-[96px] uppercase tracking-[0.3em] text-white/40 mb-8">
        {tSportBreakLabel(t, match.sport)}
      </div>
      <div className="flex items-center gap-16">
        <div className="text-[72px] font-bold text-white/80">
          {match.homeTeam.shortName}
        </div>
        <div className="text-[360px] font-black tabular-nums leading-none text-white">
          {showSetsPrimary ? match.homeSets : match.homeScore}
        </div>
        <div className="text-[240px] font-black text-white/30">-</div>
        <div className="text-[360px] font-black tabular-nums leading-none text-white">
          {showSetsPrimary ? match.awaySets : match.awayScore}
        </div>
        <div className="text-[72px] font-bold text-white/80">
          {match.awayTeam.shortName}
        </div>
      </div>
      {showSetsPrimary && (
        <div className="mt-10 text-5xl font-bold uppercase tracking-widest text-white/60">
          Set {match.homeScore} – {match.awayScore}
          {history ? ` · ${history}` : ""}
        </div>
      )}
    </motion.div>
  );
}

export function FullTimeMode({ match }: { match: Match }) {
  const { t } = useTranslation();
  const profile = getSportProfile(match.sport);
  const history = formatSetHistory(match.setHistory ?? []);
  const showSetsPrimary = profile.hasSets;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
      className="absolute inset-0 flex flex-col items-center justify-center"
      style={{
        background: `linear-gradient(135deg, ${match.homeTeam.primaryColor}40 0%, #000 50%, ${match.awayTeam.primaryColor}40 100%)`,
      }}
    >
      <div className="text-[120px] uppercase tracking-[0.3em] text-white/70 mb-12 font-bold">
        {profile.hasSets ? "Match" : "Full-time"}
      </div>
      <div className="flex items-center gap-20">
        <div className="flex flex-col items-center gap-4">
          <div
            className="text-[80px] font-black uppercase"
            style={{ color: match.homeTeam.primaryColor }}
          >
            {match.homeTeam.shortName}
          </div>
          <div className="text-[400px] font-black tabular-nums leading-none text-white">
            {showSetsPrimary ? match.homeSets : match.homeScore}
          </div>
        </div>
        <div className="text-[240px] font-black text-white/20">-</div>
        <div className="flex flex-col items-center gap-4">
          <div
            className="text-[80px] font-black uppercase"
            style={{ color: match.awayTeam.primaryColor }}
          >
            {match.awayTeam.shortName}
          </div>
          <div className="text-[400px] font-black tabular-nums leading-none text-white">
            {showSetsPrimary ? match.awaySets : match.awayScore}
          </div>
        </div>
      </div>
      {showSetsPrimary && history ? (
        <div className="mt-10 text-5xl font-bold uppercase tracking-widest text-white/60">
          {history}
        </div>
      ) : null}
    </motion.div>
  );
}
