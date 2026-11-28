"use client";

import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { Match, Team } from "@/lib/types";
import {
  shootoutIsSuddenDeath,
  shootoutMarks,
  shootoutNextSide,
  shootoutTally,
  shootoutWinner,
  type PenaltyShootout,
  type ShootoutMark,
  type ShootoutSide,
} from "@/lib/penalty-shootout";
import { normalizeSport } from "@/lib/sports";
import { mediaUrl } from "@/lib/media-url";
import { scoreboardSurfaceBackgroundPath, type ResolvedScoreboardTheme } from "@/lib/scoreboard-theme";
import { TeamLogo } from "./scoreboard-strip";

/** Hoeveel rondes het scherm hoogstens toont; een lange sudden death toont de laatste. */
const MAX_VISIBLE_MARKS = 8;

const SCORED = "#22c55e";
const MISSED = "#ef4444";

function Mark({ mark, next }: { mark: ShootoutMark; next?: boolean }) {
  const size = "min(7.5cqh, 3.6cqw)";
  const base = {
    width: size,
    height: size,
    borderWidth: "min(0.7cqh, 0.34cqw)",
    borderStyle: "solid" as const,
    fontSize: "min(4.6cqh, 2.2cqw)",
    lineHeight: 1,
  };
  const style =
    mark === "scored"
      ? { background: SCORED, borderColor: SCORED }
      : mark === "missed"
        ? { background: MISSED, borderColor: MISSED }
        : next
          ? { background: "rgba(252,211,77,0.18)", borderColor: "#fcd34d" }
          : { background: "transparent", borderColor: "rgba(255,255,255,0.32)" };
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-black text-white"
      style={{ ...base, ...style }}
    >
      {mark === "missed" ? "✕" : null}
    </span>
  );
}

/** Eén ploeg: logo, naam en de trappen eronder. De zijde bepaalt de uitlijning naar het midden toe. */
function TeamColumn({
  team,
  marks,
  winner,
  dimmed,
  up,
}: {
  team: Team;
  marks: ShootoutMark[];
  winner: boolean;
  dimmed: boolean;
  /** Deze ploeg trapt nu: de eerstvolgende lege cirkel licht op. */
  up: boolean;
}) {
  const nextIndex = up ? marks.findIndex((mark) => mark === "pending") : -1;
  return (
    <div
      className="flex min-w-0 flex-1 flex-col items-center"
      style={{ gap: "min(3cqh, 1.6cqw)", opacity: dimmed ? 0.55 : 1, transition: "opacity 400ms" }}
    >
      <TeamLogo
        team={team}
        style={{ width: "min(26cqh, 15cqw)", height: "min(26cqh, 15cqw)", flexShrink: 0 }}
      />
      <div
        className="w-full truncate text-center font-black uppercase text-white"
        style={{
          fontSize: "min(6.5cqh, 3.2cqw)",
          letterSpacing: "0.06em",
          lineHeight: 1.1,
          color: winner ? "#ffffff" : undefined,
        }}
      >
        {team.shortName || team.name}
      </div>
      <div className="flex flex-wrap items-center justify-center" style={{ gap: "min(1.6cqh, 0.8cqw)" }}>
        {marks.map((mark, index) => (
          <Mark key={index} mark={mark} next={index === nextIndex} />
        ))}
      </div>
    </div>
  );
}

/**
 * Strafschoppenreeks of shoot-out op het stadionscherm: een eigen, volledig dekkend scherm in de
 * huisstijl (lettertype en achtergrond van het volledige scorebord), zodat er niets van het
 * scorebord eronder door schemert. Alle maten volgen de container (cqh/cqw), zodat het ook op een
 * smal of exotisch LED-canvas binnen beeld blijft.
 */
export function ShootoutOverlay({
  match,
  shootout,
  theme,
}: {
  match: Match;
  shootout: PenaltyShootout;
  theme: ResolvedScoreboardTheme;
}) {
  const { t } = useTranslation();
  const tally = shootoutTally(shootout);
  const winner = shootoutWinner(shootout);
  const next = winner ? null : shootoutNextSide(shootout);
  const marks = shootoutMarks(shootout, MAX_VISIBLE_MARKS);
  const suddenDeath = !winner && shootoutIsSuddenDeath(shootout);
  const title =
    normalizeSport(match.sport) === "HOCKEY" ? t("matchLive.shootoutTitleHockey") : t("matchLive.shootoutTitle");
  const winnerTeam: Team | null = winner === "home" ? match.homeTeam : winner === "away" ? match.awayTeam : null;
  const background = mediaUrl(scoreboardSurfaceBackgroundPath(theme, "full"));
  const sides: { side: ShootoutSide; team: Team }[] = [
    { side: "home", team: match.homeTeam },
    { side: "away", team: match.awayTeam },
  ];
  const status = winnerTeam
    ? t("matchLive.shootoutWinner", { team: winnerTeam.shortName || winnerTeam.name })
    : suddenDeath
      ? t("matchLive.shootoutSuddenDeath")
      : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="pointer-events-none absolute inset-0 z-[65] overflow-hidden"
      style={{ containerType: "size", fontFamily: theme.fontFamily, background: "#05070b" }}
      data-shootout-screen
    >
      {background ? (
        <>
          <img src={background} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0" style={{ background: "rgba(3,5,9,0.72)" }} />
        </>
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse at 50% 40%, #16202e 0%, #05070b 70%)" }}
        />
      )}

      <div
        className="relative flex h-full w-full flex-col items-center justify-center"
        style={{ padding: "min(6cqh, 4cqw) min(5cqw, 8cqh)", gap: "min(4cqh, 2.4cqw)" }}
      >
        <div className="flex flex-col items-center" style={{ gap: "min(1.6cqh, 1cqw)" }}>
          <div
            className="font-black uppercase text-amber-300"
            style={{ fontSize: "min(6cqh, 3.2cqw)", letterSpacing: "0.28em", lineHeight: 1, paddingLeft: "0.28em" }}
          >
            {title}
          </div>
          <div
            className="font-bold uppercase tabular-nums text-white/55"
            style={{ fontSize: "min(3.6cqh, 1.9cqw)", letterSpacing: "0.14em", lineHeight: 1 }}
          >
            {t("matchLive.shootoutMatchScore", { home: match.homeScore, away: match.awayScore })}
          </div>
        </div>

        <div className="flex w-full items-center" style={{ gap: "min(3cqh, 2cqw)" }}>
          <TeamColumn
            team={sides[0]!.team}
            marks={marks.home}
            winner={winner === "home"}
            dimmed={winner === "away"}
            up={next === "home"}
          />
          <div
            className="flex shrink-0 items-center font-black tabular-nums text-white"
            style={{ fontSize: "min(30cqh, 15cqw)", lineHeight: 1, gap: "0.18em" }}
          >
            <span style={{ color: winner === "away" ? "rgba(255,255,255,0.55)" : undefined }}>{tally.homeScored}</span>
            <span className="text-white/40" style={{ fontSize: "0.6em" }}>
              –
            </span>
            <span style={{ color: winner === "home" ? "rgba(255,255,255,0.55)" : undefined }}>{tally.awayScored}</span>
          </div>
          <TeamColumn
            team={sides[1]!.team}
            marks={marks.away}
            winner={winner === "away"}
            dimmed={winner === "home"}
            up={next === "away"}
          />
        </div>

        <div
          className="font-black uppercase"
          style={{
            fontSize: "min(5.5cqh, 3cqw)",
            letterSpacing: "0.18em",
            lineHeight: 1,
            minHeight: "1em",
            color: winnerTeam ? "#86efac" : "#fcd34d",
          }}
        >
          {status}
        </div>
      </div>
    </motion.div>
  );
}
