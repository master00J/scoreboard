"use client";

import { motion } from "framer-motion";
import type { Player, Team } from "@/lib/types";
import { mediaUrl } from "@/lib/media-url";

export function SubstitutionMode({
  team,
  playerIn,
  playerOut,
  minute,
}: {
  team: Team | null;
  playerIn: Player | null;
  playerOut: Player | null;
  minute: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950"
    >
      <div
        className="uppercase tracking-[0.3em] text-white/40 mb-6 truncate px-10 text-center"
        style={{ fontSize: 40 }}
      >
        Substitution · {team?.name ?? ""} · {minute}'
      </div>
      <div className="flex gap-8">
        <PlayerCard player={playerOut} label="OUT" color="#ef4444" arrow="↓" />
        <PlayerCard player={playerIn} label="IN" color="#22c55e" arrow="↑" />
      </div>
    </motion.div>
  );
}

function PlayerCard({
  player,
  label,
  color,
  arrow,
}: {
  player: Player | null;
  label: string;
  color: string;
  arrow: string;
}) {
  if (!player) return null;
  return (
    <motion.div
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center"
      style={{ width: 420 }}
    >
      <div className="flex items-center gap-3 mb-3">
        <span className="font-black leading-none" style={{ fontSize: 48, color }}>
          {arrow}
        </span>
        <span className="font-black uppercase" style={{ fontSize: 48, color }}>
          {label}
        </span>
      </div>
      {(player.subImagePath ?? player.photoPath) ? (
        <img
          src={mediaUrl(player.subImagePath ?? player.photoPath)}
          alt=""
          className="rounded-xl object-cover"
          style={{ width: 380, height: 440, border: `5px solid ${color}` }}
        />
      ) : (
        <div
          className="rounded-xl flex items-center justify-center text-white font-black bg-slate-800"
          style={{
            width: 380,
            height: 440,
            border: `5px solid ${color}`,
            fontSize: 240,
          }}
        >
          {player.number}
        </div>
      )}
      <div
        className="font-bold text-white/70 mt-3"
        style={{ fontSize: 32 }}
      >
        #{player.number}
      </div>
      <div
        className="font-black text-white uppercase text-center leading-tight truncate w-full px-2"
        style={{ fontSize: 44 }}
      >
        {player.firstName} {player.lastName}
      </div>
    </motion.div>
  );
}
