"use client";

/**
 * Stadionscherm in de huisstijl van Royal Antwerp FC (marcom i-schermen 26/27): groot scorebord,
 * klein scorebord onder een clip, gele / rode / tweede gele kaart en wissel. Maten komen uit hun
 * voorbeelden (3840x2160), hier in een raster van 1920x1080 en geschaald met container-eenheden, zodat
 * het op elke canvasgrootte klopt (ook een HD-ledscherm van 1280x720).
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { motion } from "framer-motion";
import { CLUB_BRAND } from "@/lib/club-brand";
import { CLUB_FONT_STACK } from "@/lib/club-brand/font";
import { mediaUrl } from "@/lib/media-url";
import { formatSportClock } from "@/lib/sports";
import type { Match, Player, Team } from "@/lib/types";

export const RAFC_RED = "#C10503";
export const RAFC_YELLOW = "#FFC422";
/** Uitgaande speler bij een wissel: donkerrood op rood. */
export const RAFC_DARK_RED = "#550000";

/** px in het 1920x1080-raster naar container-eenheden. */
const cw = (px: number) => `${(px / 19.2).toFixed(4)}cqw`;
const ch = (px: number) => `${(px / 10.8).toFixed(4)}cqh`;
const pct = (x: number, y: number) => `${((x / 1920) * 100).toFixed(3)}% ${((y / 1080) * 100).toFixed(3)}%`;

function Canvas({ background, children, style }: { background: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ containerType: "size", background, fontFamily: CLUB_FONT_STACK, ...style }}
    >
      {children}
    </div>
  );
}

/** Tekst of beeld met het midden op (x, y) in het raster. */
function At({ x, y, children, style }: { x: number; y: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      className="absolute flex items-center justify-center whitespace-nowrap"
      style={{ left: cw(x), top: ch(y), transform: "translate(-50%, -50%)", ...style }}
    >
      {children}
    </div>
  );
}

function TeamCrest({ team, x, y, height, width }: { team: Team; x: number; y: number; height: number; width: number }) {
  const src = team.logoPath ? mediaUrl(team.logoPath) : "";
  return (
    <At x={x} y={y} style={{ width: cw(width), height: cw(height) }}>
      {src ? (
        <img src={src} alt={team.name} className="h-full w-full object-contain" draggable={false} />
      ) : (
        <span className="font-black uppercase text-white" style={{ fontSize: cw(Math.round(height * 0.2)) }}>
          {team.shortName || team.name}
        </span>
      )}
    </At>
  );
}

/**
 * Klok met vaste breedte per teken, zodat hij niet verspringt. Zalando Sans Expanded heeft brede cijfers;
 * de gewone klokcomponent rekent met smallere en liet ze overlappen.
 */
function ClubClock({ value, style }: { value: string; style: CSSProperties }) {
  return (
    <span role="timer" aria-label={value} className="inline-flex items-baseline justify-center leading-none" style={style}>
      {Array.from(value).map((c, i) => (
        <span key={i} aria-hidden className="inline-block text-center" style={{ width: c === ":" || c === "." ? "0.38em" : "0.9em" }}>
          {c}
        </span>
      ))}
    </span>
  );
}

/** Lettergrootte van de score: smaller naarmate er meer cijfers zijn, zodat ze tussen de logo's past. */
function scoreFontPx(text: string, base: number): number {
  const extra = Math.max(0, text.length - 3);
  return Math.round(base * Math.pow(0.8, extra));
}

type BoardProps = {
  match: Match;
  elapsed: number;
  running: boolean;
  period: string;
  addedTime?: number;
  shotClock?: number;
  children?: ReactNode;
  instant?: boolean;
};

/** Groot scorebord: rood vlak, logo's links en rechts, score in het midden, klok onderaan in een wit vlak. */
export function RafcBigScore({ match, elapsed, instant = false }: BoardProps) {
  const score = `${match.homeScore}-${match.awayScore}`;
  const league = CLUB_BRAND?.leagueLogoSrc ?? null;
  return (
    <motion.div
      className="absolute inset-0"
      initial={instant ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      <Canvas background={RAFC_RED}>
        {league ? (
          <>
            <div
              className="absolute inset-0 bg-white"
              style={{ clipPath: `polygon(${pct(665, 0)}, ${pct(1255, 0)}, ${pct(1216, 110)}, ${pct(704, 110)})` }}
            />
            <At x={960} y={55} style={{ width: cw(330), height: cw(66) }}>
              <img src={league} alt="" className="h-full w-full object-contain" draggable={false} />
            </At>
          </>
        ) : null}
        <TeamCrest team={match.homeTeam} x={264} y={509} width={420} height={528} />
        <TeamCrest team={match.awayTeam} x={1661} y={509} width={440} height={528} />
        <At x={960} y={509}>
          <span className="font-black leading-none text-white" style={{ fontSize: cw(scoreFontPx(score, 360)), fontWeight: 900 }}>
            {score}
          </span>
        </At>
        <div
          className="absolute inset-0 bg-white"
          style={{ clipPath: `polygon(${pct(555, 830)}, ${pct(1361, 830)}, ${pct(1421, 1080)}, ${pct(499, 1080)})` }}
        />
        <At x={960} y={958}>
          <ClubClock value={formatSportClock(match.sport, elapsed)} style={{ fontSize: cw(150), fontWeight: 900, color: RAFC_RED }} />
        </At>
      </Canvas>
    </motion.div>
  );
}

/**
 * Klein scorebord tijdens een clip: de clip boven in een 16:9-vak (zwart ernaast), onderaan een rode balk
 * met logo, score, de klok in een wit vlak, score en logo.
 */
export function RafcSmallScore({ match, elapsed, children }: BoardProps) {
  return (
    <Canvas background="#000">
      <div className="absolute overflow-hidden" style={{ left: cw(192), top: 0, width: cw(1536), height: ch(864) }}>
        {children}
      </div>
      <div className="absolute inset-x-0 bottom-0" style={{ height: ch(216), background: RAFC_RED }} />
      <div
        className="absolute inset-0 bg-white"
        style={{ clipPath: `polygon(${pct(720, 864)}, ${pct(1200, 864)}, ${pct(1234, 1080)}, ${pct(686, 1080)})` }}
      />
      <TeamCrest team={match.homeTeam} x={206} y={972} width={150} height={150} />
      <At x={494} y={972}>
        <span className="leading-none text-white" style={{ fontSize: cw(205), fontWeight: 900 }}>
          {match.homeScore}
        </span>
      </At>
      <At x={960} y={975}>
        <ClubClock value={formatSportClock(match.sport, elapsed)} style={{ fontSize: cw(80), fontWeight: 900, color: "#000" }} />
      </At>
      <At x={1440} y={972}>
        <span className="leading-none text-white" style={{ fontSize: cw(205), fontWeight: 900 }}>
          {match.awayScore}
        </span>
      </At>
      <TeamCrest team={match.awayTeam} x={1723} y={972} width={170} height={160} />
    </Canvas>
  );
}

/** Familienaam in hoofdletters; zonder familienaam de voornaam. */
function shirtName(player: Player | null): string {
  if (!player) return "";
  return (player.lastName || player.firstName || "").toUpperCase();
}

/** Lange namen kleiner, zodat ze binnen het vlak blijven. */
function nameFontPx(name: string, base: number, maxChars: number): number {
  return name.length > maxChars ? Math.round((base * maxChars) / name.length) : base;
}

const slideIn = {
  initial: { x: -240, opacity: 0, filter: "blur(28px)" },
  animate: { x: 0, opacity: 1, filter: "blur(0px)" },
  transition: { duration: 0.5, ease: [0.2, 0.8, 0.2, 1] as [number, number, number, number] },
};

export type RafcCardColor = "YELLOW" | "RED" | "YELLOW_RED";

/** Kaart: wit vlak, de kaart(en) links, rugnummer en naam in RAFC-rood. */
export function RafcCard({ player, color }: { player: Player | null; color: RafcCardColor }) {
  const name = shirtName(player);
  return (
    <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <Canvas background="#fff">
        <motion.div className="absolute inset-0" {...slideIn}>
          {color === "YELLOW" || color === "YELLOW_RED" ? (
            <div className="absolute" style={{ left: cw(223), top: ch(308), width: cw(329), height: ch(463), background: RAFC_YELLOW }} />
          ) : null}
          {color === "RED" || color === "YELLOW_RED" ? (
            <div
              className="absolute"
              style={{
                left: cw(color === "YELLOW_RED" ? 274 : 223),
                top: ch(color === "YELLOW_RED" ? 359 : 308),
                width: cw(329),
                height: ch(463),
                background: RAFC_RED,
              }}
            />
          ) : null}
        </motion.div>
        {player ? (
          <motion.div className="absolute inset-0" {...slideIn} transition={{ ...slideIn.transition, delay: 0.08 }}>
            <At x={1234} y={414}>
              <span className="leading-none" style={{ fontSize: cw(470), fontWeight: 900, color: RAFC_RED }}>
                {player.number}
              </span>
            </At>
            <At x={1236} y={795}>
              <span className="leading-none" style={{ fontSize: cw(nameFontPx(name, 100, 12)), fontWeight: 400, color: RAFC_RED }}>
                {name}
              </span>
            </At>
          </motion.div>
        ) : null}
      </Canvas>
    </motion.div>
  );
}

function Triangle({ up, color, size }: { up: boolean; color: string; size: number }) {
  return (
    <svg viewBox="0 0 100 80" style={{ width: cw(size), height: cw(size * 0.8) }} aria-hidden>
      <polygon points={up ? "50,0 100,80 0,80" : "0,0 100,0 50,80"} fill={color} />
    </svg>
  );
}

/** Woord dat binnenkomt met vervagende kopieën erboven en eronder, zoals in de wissel- en goalvideo's. */
function EchoWord({ word }: { word: string }) {
  const copies = [-3, -2, -1, 1, 2, 3];
  const fontPx = nameFontPx(word, 120, 12);
  return (
    <>
      {copies.map((n) => (
        <motion.div
          key={n}
          className="absolute inset-0"
          initial={{ y: 0, opacity: 0 }}
          animate={{ y: `${n * 7}cqh`, opacity: [0, 0.55 - Math.abs(n) * 0.12, 0] }}
          transition={{ duration: 1.1, ease: "easeOut" }}
        >
          <At x={960} y={540}>
            <span className="leading-none text-white" style={{ fontSize: cw(fontPx), fontWeight: 900 }}>
              {word}
            </span>
          </At>
        </motion.div>
      ))}
      <motion.div className="absolute inset-0" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.35 }}>
        <At x={960} y={540}>
          <span className="leading-none text-white" style={{ fontSize: cw(fontPx), fontWeight: 900 }}>
            {word}
          </span>
        </At>
      </motion.div>
    </>
  );
}

const SUB_INTRO_MS = 1300;

/** Wissel: rood vlak, eerst "SUBSTITUTION", dan links de speler die eruit gaat (donker) en rechts wie erin komt. */
export function RafcSubstitution({
  playerIn,
  playerOut,
}: {
  team: Team | null;
  playerIn: Player | null;
  playerOut: Player | null;
  minute: number;
  showMinute?: boolean;
}) {
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setIntro(false), SUB_INTRO_MS);
    return () => window.clearTimeout(id);
  }, []);
  const outName = shirtName(playerOut);
  const inName = shirtName(playerIn);
  return (
    <motion.div className="absolute inset-0 z-[20]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <Canvas background={RAFC_RED}>
        {intro ? (
          <EchoWord word="SUBSTITUTION" />
        ) : (
          <>
            {playerOut ? (
              <motion.div className="absolute inset-0" {...slideIn}>
                <At x={459} y={451}>
                  <span className="leading-none" style={{ fontSize: cw(470), fontWeight: 900, color: RAFC_DARK_RED }}>
                    {playerOut.number}
                  </span>
                </At>
                <At x={459} y={765}>
                  <span className="leading-none" style={{ fontSize: cw(nameFontPx(outName, 95, 10)), fontWeight: 400, color: RAFC_DARK_RED }}>
                    {outName}
                  </span>
                </At>
                <At x={461} y={1000} style={{ gap: cw(36) }}>
                  <Triangle up={false} color={RAFC_DARK_RED} size={90} />
                  <span className="leading-none" style={{ fontSize: cw(66), fontWeight: 800, color: RAFC_DARK_RED }}>
                    OUT
                  </span>
                </At>
              </motion.div>
            ) : null}
            {playerIn ? (
              <motion.div className="absolute inset-0" {...slideIn} transition={{ ...slideIn.transition, delay: 0.12 }}>
                <At x={1452} y={132} style={{ gap: cw(36) }}>
                  <Triangle up color="#fff" size={94} />
                  <span className="leading-none text-white" style={{ fontSize: cw(66), fontWeight: 800 }}>
                    IN
                  </span>
                </At>
                <At x={1459} y={451}>
                  <span className="leading-none text-white" style={{ fontSize: cw(470), fontWeight: 900 }}>
                    {playerIn.number}
                  </span>
                </At>
                <At x={1459} y={765}>
                  <span className="leading-none text-white" style={{ fontSize: cw(nameFontPx(inName, 95, 10)), fontWeight: 800 }}>
                    {inName}
                  </span>
                </At>
              </motion.div>
            ) : null}
          </>
        )}
      </Canvas>
    </motion.div>
  );
}
