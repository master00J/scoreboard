"use client";

import { motion } from "framer-motion";
import type { Match, Player } from "@/lib/types";
import { mediaUrl } from "@/lib/media-url";

export function GoalMode({
  match,
  scorer,
  side,
}: {
  match: Match;
  scorer: Player | null;
  side: "home" | "away";
}) {
  const team = side === "home" ? match.homeTeam : match.awayTeam;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${team.primaryColor} 0%, ${team.secondaryColor} 100%)`,
      }}
    >
      <motion.div
        initial={{ scale: 2.2, opacity: 0 }}
        animate={{ scale: 1, opacity: 0.1 }}
        className="absolute inset-0 flex items-center justify-center text-white font-black leading-none whitespace-nowrap"
        style={{ fontSize: 640 }}
      >
        GOAL
      </motion.div>
      <div className="relative z-10 flex items-center gap-10 w-full px-14">
        {scorer?.photoPath ? (
          <img
            src={mediaUrl(scorer.photoPath)}
            alt=""
            className="rounded-2xl object-cover"
            style={{ width: 360, height: 480 }}
          />
        ) : (
          <div
            className="rounded-2xl bg-black/25 flex items-center justify-center text-white font-black flex-shrink-0"
            style={{ width: 360, height: 480, fontSize: 260 }}
          >
            {scorer?.number ?? "?"}
          </div>
        )}
        <div className="flex flex-col text-white min-w-0">
          <motion.div
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="font-black leading-none tracking-tight"
            style={{ fontSize: 180, textShadow: "0 10px 40px rgba(0,0,0,0.4)" }}
          >
            GOAL!
          </motion.div>
          {scorer && (
            <motion.div
              initial={{ x: 60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="mt-4"
            >
              <div
                className="font-bold uppercase text-white/80 leading-none"
                style={{ fontSize: 52 }}
              >
                #{scorer.number}
              </div>
              <div
                className="font-bold leading-tight mt-1"
                style={{ fontSize: 64 }}
              >
                {scorer.firstName}
              </div>
              <div
                className="font-black leading-none uppercase truncate"
                style={{ fontSize: 88 }}
              >
                {scorer.lastName}
              </div>
            </motion.div>
          )}
          <div
            className="font-semibold mt-6 text-white/70 uppercase truncate"
            style={{ fontSize: 32 }}
          >
            {team.name}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
