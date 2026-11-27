/**
 * Schermindeling van Royal Antwerp FC (marcom i-schermen 26/27), opgebouwd uit gewone elementen van
 * "Scherm indelen", zodat de club alles kan verslepen en aanpassen. Maten komen uit hun voorbeelden
 * (3840x2160), hier in pixels van een 1920x1080-raster en omgerekend naar procenten.
 *
 * - Volledig scorebord: rood vlak, Pro League-logo in een witte tab bovenaan, logo's links en rechts,
 *   de stand als één regel in het midden en de klok in een wit trapezium onderaan.
 * - Scorebord + sponsoring: de clip in een 16:9-vak bovenaan (zwart ernaast), daaronder een rode balk
 *   met logo, score, de klok in een wit trapezium, score en logo.
 */

import type { LayoutElement } from "../scoreboard-elements";
import type { ScoreboardTheme } from "../scoreboard-theme";
import { RAFC_FONT_FAMILY } from "./rafc-font";

export const RAFC_RED = "#C10503";

const W = 1920;
const H = 1080;
const pct = (v: number, total: number) => Math.round((v / total) * 1000) / 10;

/** Vak in pixels (links, boven, breedte, hoogte) naar procenten. */
function box(left: number, top: number, width: number, height: number) {
  return { x: pct(left, W), y: pct(top, H), w: pct(width, W), h: pct(height, H) };
}

/** Vak in pixels rond een middelpunt. */
function around(cx: number, cy: number, width: number, height: number) {
  return box(cx - width / 2, cy - height / 2, width, height);
}

const FULL: LayoutElement[] = [
  { id: "rafc-bg", type: "shape", ...box(0, 0, W, H), style: { background: RAFC_RED } },
  // Witte tab bovenaan: 590 px breed, onderaan 39 px per kant smaller.
  { id: "rafc-league-tab", type: "shape", ...box(665, 0, 590, 110), style: { background: "#ffffff", taper: 6.6 } },
  { id: "rafc-league-logo", type: "image", src: "brand:league", ...around(960, 55, 330, 66) },
  { id: "home", type: "teamLogo", side: "home", ...around(266, 509, 480, 600), style: { fontScale: 1.27 } },
  { id: "away", type: "teamLogo", side: "away", ...around(1661, 509, 480, 600), style: { fontScale: 1.27 } },
  { id: "rafc-score", type: "scoreLine", ...around(960, 509, 820, 580), style: { color: "#ffffff" } },
  { id: "homeScore", type: "teamScore", side: "home", hidden: true, ...box(560, 650, 200, 200) },
  { id: "awayScore", type: "teamScore", side: "away", hidden: true, ...box(1160, 650, 200, 200) },
  // Witte tab onderaan: 922 px breed, bovenaan 56 px per kant smaller.
  { id: "rafc-clock-tab", type: "shape", ...box(499, 830, 922, 250), style: { background: "#ffffff", taper: -6.1 } },
  { id: "clock", type: "clock", ...around(960, 975, 720, 180), style: { color: RAFC_RED, fontScale: 1.74 } },
  { id: "shotClock", type: "shotClock", hidden: true, ...box(840, 700, 240, 100) },
];

const SPONSOR: LayoutElement[] = [
  { id: "sponsor", type: "media", ...box(192, 0, 1536, 864) },
  { id: "rafc-bar", type: "shape", ...box(0, 864, W, 216), style: { background: RAFC_RED } },
  // Wit trapezium voor de klok: bovenaan 480 px, onderaan 548 px.
  { id: "rafc-clock-tab", type: "shape", ...box(686, 864, 548, 216), style: { background: "#ffffff", taper: -6.2 } },
  { id: "home", type: "teamLogo", side: "home", ...around(206, 972, 200, 200) },
  { id: "homeScore", type: "teamScore", side: "home", ...around(494, 972, 360, 216), style: { fontScale: 1.53 } },
  { id: "clock", type: "clock", ...around(960, 972, 480, 216), style: { color: "#000000", fontScale: 0.88 } },
  { id: "awayScore", type: "teamScore", side: "away", ...around(1440, 972, 360, 216), style: { fontScale: 1.53 } },
  { id: "away", type: "teamLogo", side: "away", ...around(1723, 972, 220, 216) },
  { id: "shotClock", type: "shotClock", hidden: true, ...box(1500, 880, 200, 90) },
];

/** De volledige indeling zoals ze in `AppSettings.scoreboardThemeJson` en in de bibliotheek staat. */
export const RAFC_SCOREBOARD_THEME: ScoreboardTheme = {
  layoutMode: "custom",
  fontFamily: `"${RAFC_FONT_FAMILY}", "Archivo", "Arial Black", system-ui, sans-serif`,
  textShadows: false,
  clockDigitEm: 0.9,
  plainDigits: true,
  contentAreaBg: "#000000",
  scoreColor: "#ffffff",
  timerRunningColor: RAFC_RED,
  timerPausedColor: RAFC_RED,
  fullTeamRadialAlphaHex: "00",
  fullShowPeriod: false,
  fullShowAddedTime: false,
  fullShowTeamNames: false,
  showLogos: true,
  showScores: true,
  showClock: true,
  // De livestream-vlakken blijven op de standaard (die ontbreken hier bewust).
  elements: { full: FULL, sponsor: SPONSOR } as unknown as ScoreboardTheme["elements"],
};
