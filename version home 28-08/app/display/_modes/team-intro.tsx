"use client";

import { motion } from "framer-motion";
import type { Match } from "@/lib/types";
import { TeamLogo } from "./scoreboard-strip";

export function TeamIntroMode({ match }: { match: Match }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
      className="absolute inset-0 flex items-center justify-center"
      style={{
        background: `linear-gradient(135deg, ${match.homeTeam.primaryColor} 0%, #0b0c10 50%, ${match.awayTeam.primaryColor} 100%)`,
      }}
    >
      <div className="flex items-center justify-center gap-24 w-full px-24">
        <motion.div
          initial={{ x: -120, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="flex flex-col items-center gap-8"
        >
          <TeamLogo team={match.homeTeam} size={420} />
          <div className="text-[96px] font-black text-white uppercase tracking-tight text-center">
            {match.homeTeam.name}
          </div>
          <div
            className="text-[56px] font-bold uppercase tracking-widest"
            style={{ color: match.homeTeam.primaryColor }}
          >
            {match.homeTeam.shortName}
          </div>
        </motion.div>

        <motion.div
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-[220px] font-black text-white/20"
        >
          VS
        </motion.div>

        <motion.div
          initial={{ x: 120, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="flex flex-col items-center gap-8"
        >
          <TeamLogo team={match.awayTeam} size={420} />
          <div className="text-[96px] font-black text-white uppercase tracking-tight text-center">
            {match.awayTeam.name}
          </div>
          <div
            className="text-[56px] font-bold uppercase tracking-widest"
            style={{ color: match.awayTeam.primaryColor }}
          >
            {match.awayTeam.shortName}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
