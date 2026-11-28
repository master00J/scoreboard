"use client";

import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { Match, Team } from "@/lib/types";
import {
  shootoutIsSuddenDeath,
  shootoutMarks,
  shootoutTally,
  shootoutWinner,
  type PenaltyShootout,
  type ShootoutMark,
  type ShootoutSide,
} from "@/lib/penalty-shootout";
import { normalizeSport } from "@/lib/sports";
import { TeamLogo } from "./scoreboard-strip";

/** Hoeveel rondes het scherm hoogstens toont; een lange sudden death toont de laatste. */
const MAX_VISIBLE_MARKS = 8;

function Mark({ mark }: { mark: ShootoutMark }) {
  const style =
    mark === "scored"
      ? { background: "#22c55e", borderColor: "#86efac" }
      : mark === "missed"
        ? { background: "#dc2626", borderColor: "#fca5a5" }
        : { background: "transparent", borderColor: "rgba(255,255,255,0.35)" };
  return (
    <span
      className="relative flex shrink-0 items-center justify-center rounded-full font-black text-white"
      style={{
        width: "min(9cqh, 5cqw)",
        height: "min(9cqh, 5cqw)",
        borderWidth: "min(0.8cqh, 0.45cqw)",
        borderStyle: "solid",
        fontSize: "min(6cqh, 3.3cqw)",
        lineHeight: 1,
        ...style,
      }}
    >
      {mark === "missed" ? "✕" : null}
    </span>
  );
}

function TeamRow({
  team,
  marks,
  scored,
  winner,
}: {
  team: Team;
  marks: ShootoutMark[];
  scored: number;
  winner: boolean;
}) {
  return (
    <div
      className="flex w-full items-center rounded-[1.5cqh] px-[2cqw]"
      style={{
        gap: "min(3cqh, 1.6cqw)",
        height: "min(17cqh, 11cqw)",
        background: winner ? "rgba(34,197,94,0.16)" : "rgba(255,255,255,0.06)",
        border: winner ? "min(0.5cqh, 0.3cqw) solid rgba(134,239,172,0.8)" : "min(0.5cqh, 0.3cqw) solid transparent",
      }}
    >
      <TeamLogo
        team={team}
        style={{ width: "min(12cqh, 7cqw)", height: "min(12cqh, 7cqw)", flexShrink: 0 }}
      />
      <div
        className="min-w-0 flex-1 truncate font-black uppercase tracking-wide text-white"
        style={{ fontSize: "min(7cqh, 3.6cqw)", lineHeight: 1.1 }}
      >
        {team.shortName || team.name}
      </div>
      <div className="flex shrink-0 items-center" style={{ gap: "min(2cqh, 1.1cqw)" }}>
        {marks.map((mark, index) => (
          <Mark key={index} mark={mark} />
        ))}
      </div>
      <div
        className="shrink-0 text-right font-black tabular-nums text-white"
        style={{ fontSize: "min(13cqh, 7cqw)", lineHeight: 1, minWidth: "1.2em" }}
      >
        {scored}
      </div>
    </div>
  );
}

/**
 * Strafschoppenreeks of shoot-out op het stadionscherm. Alle maten volgen de container
 * (cqh/cqw), zodat het ook op een smal of exotisch LED-canvas binnen beeld blijft.
 */
export function ShootoutOverlay({ match, shootout }: { match: Match; shootout: PenaltyShootout }) {
  const { t } = useTranslation();
  const tally = shootoutTally(shootout);
  const winner = shootoutWinner(shootout);
  const marks = shootoutMarks(shootout, MAX_VISIBLE_MARKS);
  const suddenDeath = !winner && shootoutIsSuddenDeath(shootout);
  const title =
    normalizeSport(match.sport) === "HOCKEY" ? t("matchLive.shootoutTitleHockey") : t("matchLive.shootoutTitle");
  const winnerTeam: Team | null = winner === "home" ? match.homeTeam : winner === "away" ? match.awayTeam : null;
  const rows: { side: ShootoutSide; team: Team; scored: number }[] = [
    { side: "home", team: match.homeTeam, scored: tally.homeScored },
    { side: "away", team: match.awayTeam, scored: tally.awayScored },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="pointer-events-none absolute inset-0 z-[65] flex items-center justify-center bg-black/85"
      style={{ containerType: "size" }}
    >
      <div className="flex w-[88cqw] flex-col items-center" style={{ gap: "min(3cqh, 1.8cqw)" }}>
        <div className="flex items-baseline" style={{ gap: "min(3cqh, 2cqw)" }}>
          <div
            className="font-black uppercase text-amber-300"
            style={{ fontSize: "min(6cqh, 3.4cqw)", letterSpacing: "0.22em", lineHeight: 1 }}
          >
            {title}
          </div>
          <div
            className="font-black tabular-nums text-white/60"
            style={{ fontSize: "min(5cqh, 2.8cqw)", lineHeight: 1 }}
          >
            ({match.homeScore} – {match.awayScore})
          </div>
        </div>
        {rows.map((row) => (
          <TeamRow
            key={row.side}
            team={row.team}
            marks={marks[row.side]}
            scored={row.scored}
            winner={winner === row.side}
          />
        ))}
        <div
          className="font-black uppercase"
          style={{
            fontSize: "min(6cqh, 3.4cqw)",
            letterSpacing: "0.16em",
            lineHeight: 1,
            minHeight: "1em",
            color: winnerTeam ? "#86efac" : "#fcd34d",
          }}
        >
          {winnerTeam
            ? t("matchLive.shootoutWinner", { team: winnerTeam.shortName || winnerTeam.name })
            : suddenDeath
              ? t("matchLive.shootoutSuddenDeath")
              : null}
        </div>
      </div>
    </motion.div>
  );
}
