"use client";

import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { Match } from "@/lib/types";
import { getSportProfile } from "@/lib/sports";

function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-9));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

export function BreakOverlay({
  match,
  remaining,
  baseSec,
}: {
  match: Match;
  remaining: number;
  baseSec: number;
}) {
  const { t } = useTranslation();
  if (remaining <= 0) return null;
  const profile = getSportProfile(match.sport);
  const main = Number(match.halfBreakSec) > 0 ? Number(match.halfBreakSec) : profile.breakDurationSec;
  const short = Number(match.shortBreakSec) > 0 ? Number(match.shortBreakSec) : profile.shortBreakDurationSec;
  const isMain = Math.abs(baseSec - main) <= Math.abs(baseSec - short);
  const label = isMain ? t("matchLive.mainBreak") : t("matchLive.quarterBreak");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="pointer-events-none absolute inset-x-0 bottom-[8%] z-[65] flex justify-center"
    >
      <div className="rounded-2xl border-2 border-sky-300/80 bg-black/80 px-14 py-6 text-center shadow-[0_20px_80px_rgba(0,0,0,0.55)]">
        <div className="text-3xl font-black uppercase tracking-[0.28em] text-sky-200">{label}</div>
        <div className="mt-2 font-black tabular-nums leading-none text-white" style={{ fontSize: 120 }}>
          {formatCountdown(remaining)}
        </div>
      </div>
    </motion.div>
  );
}
