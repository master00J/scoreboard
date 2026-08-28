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
      <div className="flex max-w-full flex-wrap justify-center gap-10 px-6">
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
  const displayName = `${player.firstName} ${player.lastName}`.trim();
  const nameLen = displayName.length;
  const nameFontSize = nameLen > 34 ? 28 : nameLen > 26 ? 34 : nameLen > 20 ? 38 : 44;
  return (
    <motion.div
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4 }}
      // Vaste breedte: OUT/IN even groot, naam wrapt eronder i.p.v. de kaart te verbreden.
      className="flex w-[380px] max-w-[min(380px,calc(50vw-48px))] shrink-0 flex-col items-center"
    >
      <div className="mb-3 flex items-center gap-3">
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
          className="w-full rounded-xl object-cover"
          style={{ aspectRatio: "380 / 440", border: `5px solid ${color}` }}
        />
      ) : (
        <div
          className="flex aspect-[380/440] w-full items-center justify-center rounded-xl bg-slate-800 font-black text-white"
          style={{
            border: `5px solid ${color}`,
            fontSize: 240,
          }}
        >
          {player.number}
        </div>
      )}
      <div className="mt-3 font-bold text-white/70" style={{ fontSize: 32 }}>
        #{player.number}
      </div>
      <div
        className="w-full px-1 text-center font-black uppercase leading-snug text-white break-words"
        style={{ fontSize: nameFontSize }}
      >
        {displayName}
      </div>
    </motion.div>
  );
}
