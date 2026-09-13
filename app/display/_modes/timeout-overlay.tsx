"use client";

import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { Match } from "@/lib/types";

function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-9));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

export function TimeoutOverlay({
  match,
  side,
  remaining,
}: {
  match: Match;
  side: "home" | "away" | "technical" | null;
  remaining: number;
}) {
  const { t } = useTranslation();
  if (remaining <= 0) return null;
  const teamName =
    side === "home" ? match.homeTeam.shortName || match.homeTeam.name
    : side === "away" ? match.awayTeam.shortName || match.awayTeam.name
    : null;
  const label =
    side === "technical"
      ? t("matchLive.technicalTimeout")
      : teamName
        ? `${t("matchLive.timeoutRunning")} · ${teamName}`
        : t("matchLive.timeoutRunning");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="pointer-events-none absolute inset-x-0 top-0 z-[70] flex justify-center pt-10"
    >
      <div className="rounded-2xl border-2 border-amber-400/80 bg-black/80 px-12 py-6 text-center shadow-[0_20px_80px_rgba(0,0,0,0.55)]">
        <div className="text-2xl font-black uppercase tracking-[0.28em] text-amber-200">
          {label}
        </div>
        <div className="mt-2 font-black tabular-nums leading-none text-amber-300" style={{ fontSize: 96 }}>
          {formatCountdown(remaining)}
        </div>
      </div>
    </motion.div>
  );
}
