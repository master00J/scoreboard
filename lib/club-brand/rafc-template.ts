/**
 * Schermindeling van Royal Antwerp FC (marcom i-schermen 26/27), opgebouwd uit gewone elementen van
 * "Scherm indelen", zodat de club alles kan verslepen en aanpassen. Maten komen uit hun voorbeelden
 * (3840x2160), hier in pixels van een 1920x1080-raster en omgerekend naar procenten.
 *
 * - Volledig scorebord: rood vlak, Pro League-logo in een witte tab bovenaan, logo's links en rechts,
 *   de stand als één regel in het midden en de klok in een wit trapezium onderaan.
 * - Scorebord + sponsoring: de clip als 16:9 links in een rood vak over de volle breedte (links of
 *   rechts is een keuze in de editor), daaronder een rode balk met logo, score, de klok in een wit trapezium, score en logo.
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
  // Het videovak loopt over de volle breedte: de clip staat als 16:9 tegen de linkerkant en de rest is
  // rood, zodat het scherm gevuld is. In "Scherm indelen" kiest de club zelf links, midden of rechts.
  { id: "sponsor", type: "media", ...box(0, 0, W, 864), style: { background: RAFC_RED, mediaFit: "left" } },
  { id: "rafc-bar", type: "shape", ...box(0, 864, W, 216), style: { background: RAFC_RED } },
  // Logo, score, klok, score en logo staan gecentreerd onder de clip (0-1536 px, midden 768), niet
  // onder het hele scherm. Kiest de club de clip rechts, dan schuiven ze in de editor mee.
  // Wit trapezium voor de klok: bovenaan 480 px, onderaan 548 px.
  { id: "rafc-clock-tab", type: "shape", ...box(494, 864, 548, 216), style: { background: "#ffffff", taper: -6.2 } },
  { id: "home", type: "teamLogo", side: "home", ...around(122, 972, 200, 200) },
  { id: "homeScore", type: "teamScore", side: "home", ...around(364, 972, 240, 216), style: { fontScale: 1.53 } },
  { id: "clock", type: "clock", ...around(768, 972, 480, 216), style: { color: "#000000", fontScale: 0.88 } },
  { id: "awayScore", type: "teamScore", side: "away", ...around(1172, 972, 240, 216), style: { fontScale: 1.53 } },
  { id: "away", type: "teamLogo", side: "away", ...around(1414, 972, 220, 216) },
  { id: "shotClock", type: "shotClock", hidden: true, ...box(1296, 880, 200, 90) },
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
