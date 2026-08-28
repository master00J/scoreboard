"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Player, Team } from "@/lib/types";
import { mediaUrl } from "@/lib/media-url";
import {
  reportDisplayMediaDiagnostic,
  videoElementDiagnosticFields,
} from "@/lib/report-display-media-diagnostic";

export function PlayerIntroMode({
  player,
  team,
}: {
  player: Player;
  team: Team;
}) {
  const lineupVideoRef = useRef<HTMLVideoElement>(null);

  const lineupSrc = player.lineupVideoPath ? mediaUrl(player.lineupVideoPath) : "";

  useEffect(() => {
    if (!lineupSrc || !lineupVideoRef.current) return;
    const v = lineupVideoRef.current;
    v.currentTime = 0;
    const t = window.setTimeout(() => void v.play().catch(() => {}), 0);
    return () => clearTimeout(t);
  }, [lineupSrc, player.id]);

  if (lineupSrc) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        className="absolute inset-0 bg-black overflow-hidden"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={player.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0"
          >
            {/* Geen tekst-overlay: staat in de custom lineup-video. Één keer afspelen, laatste frame blijft staan. */}
            <video
              ref={lineupVideoRef}
              key={`${player.id}-${lineupSrc}`}
              src={lineupSrc}
              className="absolute inset-0 h-full w-full object-cover"
              muted
              playsInline
              loop={false}
              autoPlay
              onLoadedMetadata={(e) =>
                reportDisplayMediaDiagnostic(
                  {
                    source: "player-intro",
                    event: "loaded_metadata",
                    mediaId: player.id,
                    mediaTitle: `${player.firstName} ${player.lastName}`.trim(),
                    mediaPath: player.lineupVideoPath ?? undefined,
                    ...videoElementDiagnosticFields(e.currentTarget),
                    atMs: Date.now(),
                  },
                  5000,
                )
              }
              onStalled={(e) =>
                reportDisplayMediaDiagnostic(
                  {
                    source: "player-intro",
                    event: "stalled",
                    mediaId: player.id,
                    mediaPath: player.lineupVideoPath ?? undefined,
                    ...videoElementDiagnosticFields(e.currentTarget),
                    atMs: Date.now(),
                  },
                  15000,
                )
              }
              onWaiting={(e) =>
                reportDisplayMediaDiagnostic(
                  {
                    source: "player-intro",
                    event: "waiting",
                    mediaId: player.id,
                    mediaPath: player.lineupVideoPath ?? undefined,
                    ...videoElementDiagnosticFields(e.currentTarget),
                    atMs: Date.now(),
                  },
                  15000,
                )
              }
              onError={(e) =>
                reportDisplayMediaDiagnostic(
                  {
                    source: "player-intro",
                    event: "error",
                    mediaId: player.id,
                    mediaPath: player.lineupVideoPath ?? undefined,
                    ...videoElementDiagnosticFields(e.currentTarget),
                    atMs: Date.now(),
                  },
                  0,
                )
              }
            />
          </motion.div>
        </AnimatePresence>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="absolute inset-0 flex items-center justify-center"
      style={{
        background: `linear-gradient(135deg, ${team.primaryColor} 0%, #050607 100%)`,
      }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={player.id}
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          transition={{ duration: 0.4 }}
          className="flex items-center gap-24 w-full px-24"
        >
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="rounded-[32px] flex items-center justify-center text-white font-black leading-none"
            style={{
              width: 620,
              height: 820,
              background: `linear-gradient(135deg, ${team.primaryColor}, ${team.secondaryColor})`,
              fontSize: 540,
              textShadow: "0 20px 80px rgba(0,0,0,0.4)",
            }}
          >
            {player.number}
          </motion.div>
          <div className="flex-1 flex flex-col">
            {player.photoPath && (
              <img
                src={mediaUrl(player.photoPath)}
                alt=""
                className="rounded-xl mb-8 object-cover"
                style={{ width: 520, height: 520 }}
              />
            )}
            <motion.div
              initial={{ x: 60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.25 }}
              className="text-[72px] font-semibold text-white/70 uppercase tracking-widest"
            >
              {player.position ?? "Player"}
            </motion.div>
            <motion.div
              initial={{ x: 60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.35 }}
              className="text-[96px] font-bold text-white leading-tight"
            >
              {player.firstName}
            </motion.div>
            <motion.div
              initial={{ x: 60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.45 }}
              className="text-[160px] font-black text-white uppercase leading-none"
            >
              {player.lastName}
            </motion.div>
          </div>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
