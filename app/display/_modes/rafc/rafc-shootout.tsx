"use client";

/**
 * Strafschoppenreeks in de huisstijl van Royal Antwerp FC, naar hun groot scorebord (marcom 26/27):
 * rood vlak, witte schuine tab bovenaan met de titel, witte logo's en een grote witte stand, de
 * trappen per ploeg eronder en een witte tab onderaan met wie aan de beurt is of wie wint.
 * Maten in pixels op een 1920x1080-raster, omgerekend naar container-eenheden.
 */

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
} from "@/lib/penalty-shootout";
import { FitText } from "@/components/fit-text";
import { TeamLogo } from "../scoreboard-strip";
import { At, Canvas, ch, cw, RAFC_DARK_RED, RAFC_RED, RAFC_YELLOW } from "./rafc-visuals";

/** Hoeveel trappen per ploeg in beeld; een lange sudden death toont de laatste. */
const MAX_VISIBLE_MARKS = 7;
const WHITE = "#ffffff";

/** Wit trapezium: `narrowBottom` = onderaan smaller (tab bovenaan), anders bovenaan smaller. */
function Tab({
  left,
  top,
  width,
  height,
  narrowBottom,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  narrowBottom: boolean;
}) {
  const inset = 6.4;
  return (
    <div
      className="absolute"
      style={{
        left: cw(left),
        top: ch(top),
        width: cw(width),
        height: ch(height),
        background: WHITE,
        clipPath: narrowBottom
          ? `polygon(0% 0%, 100% 0%, ${100 - inset}% 100%, ${inset}% 100%)`
          : `polygon(${inset}% 0%, ${100 - inset}% 0%, 100% 100%, 0% 100%)`,
      }}
    />
  );
}

function Kick({ mark, next }: { mark: ShootoutMark; next: boolean }) {
  const size = cw(62);
  const ring = cw(6);
  const style =
    mark === "scored"
      ? { background: WHITE, border: `${ring} solid ${WHITE}` }
      : mark === "missed"
        ? { background: RAFC_DARK_RED, border: `${ring} solid ${RAFC_DARK_RED}` }
        : next
          ? { background: "rgba(255,196,34,0.28)", border: `${ring} solid ${RAFC_YELLOW}` }
          : { background: "transparent", border: `${ring} solid rgba(255,255,255,0.45)` };
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full leading-none"
      style={{ width: size, height: size, color: WHITE, fontSize: cw(34), fontWeight: 900, ...style }}
    >
      {mark === "missed" ? "✕" : null}
    </span>
  );
}

function TeamSide({
  team,
  marks,
  x,
  up,
  dimmed,
}: {
  team: Team;
  marks: ShootoutMark[];
  x: number;
  up: boolean;
  dimmed: boolean;
}) {
  const nextIndex = up ? marks.findIndex((mark) => mark === "pending") : -1;
  return (
    <div style={{ opacity: dimmed ? 0.45 : 1, transition: "opacity 500ms" }}>
      <At x={x} y={455}>
        <TeamLogo team={team} style={{ width: cw(400), height: ch(430) }} />
      </At>
      <At x={x} y={735}>
        <span className="leading-none" style={{ fontSize: cw(58), fontWeight: 800, color: WHITE }}>
          {(team.shortName || team.name).toUpperCase()}
        </span>
      </At>
      <At x={x} y={835} style={{ gap: cw(18) }}>
        {marks.map((mark, index) => (
          <Kick key={index} mark={mark} next={index === nextIndex} />
        ))}
      </At>
    </div>
  );
}

export function RafcShootout({ match, shootout }: { match: Match; shootout: PenaltyShootout }) {
  const { t } = useTranslation();
  const tally = shootoutTally(shootout);
  const winner = shootoutWinner(shootout);
  const next = winner ? null : shootoutNextSide(shootout);
  const marks = shootoutMarks(shootout, MAX_VISIBLE_MARKS);
  const suddenDeath = !winner && shootoutIsSuddenDeath(shootout);
  const nameOf = (team: Team) => team.shortName || team.name;
  const status = winner
    ? t("matchLive.shootoutWinner", { team: nameOf(winner === "home" ? match.homeTeam : match.awayTeam) })
    : suddenDeath
      ? t("matchLive.shootoutSuddenDeath")
      : next
        ? t("matchLive.shootoutNextUp", { team: nameOf(next === "home" ? match.homeTeam : match.awayTeam) })
        : "";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="pointer-events-none absolute inset-0 z-[65]"
      data-shootout-screen
    >
      <Canvas background={RAFC_RED}>
        <Tab left={560} top={0} width={800} height={130} narrowBottom />
        <At x={960} y={64}>
          <span className="leading-none" style={{ fontSize: cw(60), fontWeight: 900, color: RAFC_RED }}>
            {t("matchLive.shootoutTitle").toUpperCase()}
          </span>
        </At>
        <At x={960} y={188}>
          <span
            className="leading-none"
            style={{ fontSize: cw(34), fontWeight: 700, color: "rgba(255,255,255,0.75)", letterSpacing: "0.06em" }}
          >
            {t("matchLive.shootoutMatchScore", { home: match.homeScore, away: match.awayScore }).toUpperCase()}
          </span>
        </At>

        <TeamSide team={match.homeTeam} marks={marks.home} x={330} up={next === "home"} dimmed={winner === "away"} />
        <TeamSide team={match.awayTeam} marks={marks.away} x={1590} up={next === "away"} dimmed={winner === "home"} />

        {/* De stand van de reeks in het midden; te breed (sudden death, 10-9) krimpt binnen het vak. */}
        <div
          className="absolute flex items-center justify-center"
          style={{ left: cw(600), top: ch(250), width: cw(720), height: ch(420) }}
          data-fit-box
        >
          <FitText className="leading-none" style={{ fontSize: cw(330), fontWeight: 900, color: WHITE, whiteSpace: "nowrap" }}>
            {`${tally.homeScored}-${tally.awayScored}`}
          </FitText>
        </div>

        {status ? (
          <>
            <Tab left={499} top={930} width={922} height={150} narrowBottom={false} />
            <At x={960} y={1005}>
              <span className="leading-none" style={{ fontSize: cw(54), fontWeight: 900, color: RAFC_RED }}>
                {status.toUpperCase()}
              </span>
            </At>
          </>
        ) : null}
      </Canvas>
    </motion.div>
  );
}
