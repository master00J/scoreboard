"use client";

import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { Match } from "@/lib/types";
import { getSportProfile } from "@/lib/sports";
import { tSportBreakLabel } from "@/lib/i18n/t-phase";

export function HalfTimeMode({ match }: { match: Match }) {
  const { t } = useTranslation();
  const profile = getSportProfile(match.sport);
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
          {match.homeScore}
        </div>
        <div className="text-[240px] font-black text-white/30">-</div>
        <div className="text-[360px] font-black tabular-nums leading-none text-white">
          {match.awayScore}
        </div>
        <div className="text-[72px] font-bold text-white/80">
          {match.awayTeam.shortName}
        </div>
      </div>
      {profile.hasSets && (
        <div className="mt-10 text-5xl font-bold uppercase tracking-widest text-white/60">
          {t("sports.sets", { home: match.homeSets, away: match.awaySets })}
        </div>
      )}
    </motion.div>
  );
}

export function FullTimeMode({ match }: { match: Match }) {
  const { t } = useTranslation();
  const profile = getSportProfile(match.sport);
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
        {t("sports.fullTime")}
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
            {match.homeScore}
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
            {match.awayScore}
          </div>
        </div>
      </div>
      {profile.hasSets && (
        <div className="mt-10 text-5xl font-bold uppercase tracking-widest text-white/60">
          {t("sports.sets", { home: match.homeSets, away: match.awaySets })}
        </div>
      )}
    </motion.div>
  );
}
