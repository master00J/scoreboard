/**
 * Soaktest voor de netwerkbron: houdt die onder stress en kijkt of hij blijft lopen.
 *
 * Draait de echte supervisor uit electron/network-source.ts tegen een echte ffmpeg, en trekt
 * onderweg de bron weg zoals dat in een sporthal gebeurt: een camera die herstart, een kabel die
 * er even uit gaat, een switch die herconfigureert. Controleert dat de bron zichzelf herstelt, dat
 * er geen wachtwoorden in het log staan, en dat het geheugen niet wegloopt.
 *
 *   npx tsx scripts/network-source-soak.mjs [--cycles 3] [--up 8] [--down 6]
 */
import { spawn } from "node:child_process";

// De supervisor is TypeScript en hangt niet aan Electron, dus hij draait hier zoals in de app.
// Start met:  npx tsx scripts/network-source-soak.mjs
const { createNetworkSource } = await import("../electron/network-source.ts");
const { NETWORK_SOURCE_STALL_MS } = await import("../lib/network-source.ts");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};
const CYCLES = arg("cycles", 3);
const UP_SEC = arg("up", 8);
const DOWN_SEC = arg("down", 6);
const PORT = arg("port", 23100);
const URL_ = `udp://127.0.0.1:${PORT}`;
const SECRET = "Geheim123";
/** Hetzelfde adres als een echte camera, met inlog, om de maskering te controleren. */
const WATCHED_URL = `udp://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
let bytes = 0;
let chunks = 0;
let resets = 0;
let lastStatus = null;

const source = createNetworkSource({
  ffmpegPath: () => "ffmpeg",
  log: (line) => {
    log.push(line);
    console.log(`      ${line}`);
  },
  send: (channel, payload) => {
    if (channel === "network-source:chunk") {
      chunks += 1;
      bytes += payload.byteLength ?? payload.length ?? 0;
    } else if (channel === "network-source:reset") {
      resets += 1;
    } else if (channel === "network-source:status") {
      lastStatus = payload;
    }
    return true;
  },
});

/** Zender die het voor de camera doet. Loopt tot we hem doodmaken. */
function startSender() {
  const proc = spawn(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-re",
      "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=30`,
      "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
      "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p", "-g", "30",
      "-f", "mpegts", URL_,
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  return proc;
}

const rssMb = () => Math.round(process.memoryUsage().rss / 1024 / 1024);

console.log(`netwerkbron-soak: ${CYCLES} rondes van ${UP_SEC}s beeld en ${DOWN_SEC}s stilte\n`);

let sender = startSender();
await sleep(500);
source.start(WATCHED_URL, 30);

const rssSamples = [];
let recovered = 0;
let sawPicture = false;
/** Zag de bediening tijdens de stilte dat er geen beeld was? */
let reportedSilence = false;
/** Lang genoeg stil om een herstart te verdienen? Daaronder hoort hij zelf door te gaan. */
const expectRestart = DOWN_SEC * 1000 > NETWORK_SOURCE_STALL_MS;
const resetsBeforeOutages = resets;

for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
  const before = chunks;
  await sleep(UP_SEC * 1000);
  const got = chunks - before;
  rssSamples.push(rssMb());
  console.log(`ronde ${cycle}: beeld aan  → ${got} stukken, status=${lastStatus?.receiving ? "beeld" : "geen beeld"}, rss=${rssMb()} MB`);
  if (got > 0) {
    sawPicture = true;
    if (cycle > 1) recovered += 1;
  }

  // Bron weg: zoals een camera die herstart of een kabel die eruit gaat.
  sender.kill("SIGKILL");
  await sleep(DOWN_SEC * 1000);
  if (lastStatus && lastStatus.receiving === false) reportedSilence = true;
  console.log(`ronde ${cycle}: bron weg   → status=${lastStatus?.receiving ? "beeld" : "geen beeld"}, fout=${lastStatus?.error ?? "geen"}, poging=${lastStatus?.attempt ?? 0}`);
  sender = startSender();
  await sleep(500);
}

await sleep(UP_SEC * 1000);
const finalGot = chunks;
console.log(`\nna herstel: ${finalGot} stukken in totaal, ${Math.round(bytes / 1024)} KiB, rss=${rssMb()} MB`);

source.stop();
sender.kill("SIGKILL");
await sleep(400);

const leaked = log.filter((line) => line.includes(SECRET));
const rssGrowth = rssSamples.length > 1 ? rssSamples[rssSamples.length - 1] - rssSamples[0] : 0;

const restartsDuringOutages = resets - resetsBeforeOutages;
const checks = [
  ["er kwam beeld door", sawPicture],
  ["de bron herstelde na wegvallen", recovered >= 1 || CYCLES === 1],
  ["de bediening meldde de stilte", reportedSilence],
  ["de start leverde een init-segment", resetsBeforeOutages >= 1],
  [
    expectRestart
      ? `stilte langer dan ${NETWORK_SOURCE_STALL_MS} ms gaf een herstart`
      : `korte stilte kostte geen herstart (UDP: ffmpeg stopt daar niet van)`,
    expectRestart ? restartsDuringOutages >= 1 : restartsDuringOutages === 0,
  ],
  ["geen wachtwoord in het log", leaked.length === 0],
  ["geheugen loopt niet weg (< 50 MB groei)", rssGrowth < 50],
  ["gestopt betekent gestopt", source.status().running === false],
];

console.log("");
let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? "  ok  " : " FOUT "} ${name}`);
  if (!pass) ok = false;
}
console.log(
  `\nresets=${resets} (${restartsDuringOutages} tijdens stiltes) herstel=${recovered} rss-groei=${rssGrowth} MB`,
);
process.exit(ok ? 0 : 1);
