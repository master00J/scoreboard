"use client";

import { motion } from "framer-motion";
import type { Player } from "@/lib/types";

export function CardMode({
  player,
  color,
  minute,
}: {
  player: Player | null;
  color: "YELLOW" | "RED";
  minute: number;
}) {
  const bg = color === "YELLOW" ? "#fbbf24" : "#dc2626";
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 flex items-center justify-center bg-slate-950 px-10"
    >
      <div className="flex items-center gap-10 w-full">
        <motion.div
          initial={{ rotate: -20, scale: 0.7, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 180, damping: 18 }}
          className="rounded-xl shadow-2xl flex-shrink-0"
          style={{
            width: 300,
            height: 440,
            background: bg,
          }}
        />
        {player && (
          <div className="flex flex-col min-w-0 flex-1">
            <div
              className="uppercase tracking-[0.3em] text-white/40"
              style={{ fontSize: 36 }}
            >
              {color === "YELLOW" ? "Yellow card" : "Red card"} · {minute}'
            </div>
            <div
              className="font-bold text-white/80 mt-2"
              style={{ fontSize: 52 }}
            >
              #{player.number}
            </div>
            <div
              className="font-black text-white leading-none mt-2 truncate"
              style={{ fontSize: 88 }}
            >
              {player.firstName}
            </div>
            <div
              className="font-black text-white leading-none uppercase truncate"
              style={{ fontSize: 128 }}
            >
              {player.lastName}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
