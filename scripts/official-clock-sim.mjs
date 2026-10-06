/**
 * Nagebootste jurytafelconsole: stuurt een lopende basketbalklok en shotclock naar ArenaCue, zodat je
 * "Officiële klok volgen" kunt uitproberen zonder echte console.
 *
 * Gebruik:
 *   node scripts/official-clock-sim.mjs                      Bodet, belt in op 127.0.0.1:4001
 *   node scripts/official-clock-sim.mjs --protocol stramatel
 *   node scripts/official-clock-sim.mjs --protocol arenacue --udp --port 4010
 *   node scripts/official-clock-sim.mjs --host 192.168.1.20 --port 4001 --manual
 *
 * In ArenaCue (Voorbereiden → Officiële klok volgen): kies hetzelfde merk en "de console belt in op
 * deze pc" (of UDP met --udp). Zonder --manual speelt de simulator zelf: lopen, fluiten, resetten.
 * Met --manual: spatie = start/stop, r = shotclock 24, t = shotclock 14, b = shotclock uit/aan, q = stop.
 */
import dgram from "node:dgram";
import net from "node:net";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const protocol = option("protocol", "bodet");
const host = option("host", "127.0.0.1");
const port = Number(option("port", protocol === "arenacue" ? "4010" : "4001"));
const useUdp = flag("udp");
const manual = flag("manual");

if (!["bodet", "stramatel", "swisstiming", "arenacue"].includes(protocol)) {
  console.error(`Onbekend protocol "${protocol}". Kies bodet, stramatel, swisstiming of arenacue.`);
  process.exit(1);
}

/** De klokken aan de jurytafel. */
const table = { game: 600, shot: 24, running: false, shotBlank: false, lastAt: Date.now() };

function advance() {
  const now = Date.now();
  const passed = (now - table.lastAt) / 1000;
  table.lastAt = now;
  if (!table.running) return;
  table.game = Math.max(0, table.game - passed);
  if (!table.shotBlank) table.shot = Math.max(0, table.shot - passed);
  if (table.game <= 0 || table.shot <= 0) table.running = false;
}

const ceilSeconds = (value) => Math.ceil(value - 1e-9);
const ceilTenths = (value) => Math.ceil(value * 10 - 1e-9);
const pad = (value, width, fill = " ") => String(value).padStart(width, fill);

function bodetFrame(text, status) {
  const message = Buffer.from(text, "latin1");
  if (status !== undefined) message[2] = status;
  const body = Buffer.concat([Buffer.from([0x01, 0x7f, 0x02, 0x47]), message, Buffer.from([0x03])]);
  let lrc = 0;
  for (let i = 1; i < body.length; i++) lrc ^= body[i];
  lrc &= 0x7f;
  return Buffer.concat([body, Buffer.from([lrc < 0x20 ? lrc + 0x20 : lrc])]);
}

function frames() {
  const stopped = !table.running;
  const lastMinute = table.game < 60;
  const whole = ceilSeconds(table.game);
  const tenths = ceilTenths(table.game);
  const minutes = pad(Math.floor(whole / 60), 2);
  const seconds = pad(whole % 60, 2, "0");
  if (protocol === "bodet") {
    const clock = lastMinute ? `${pad(Math.floor(tenths / 10), 2, "0")}D${tenths % 10}` : `${minutes}${seconds}`;
    const status = stopped ? 0x82 : 0x80;
    return [
      bodetFrame(`18?5${clock}00  1 `, status),
      bodetFrame(`50?${pad(ceilSeconds(table.shot), 2)}`, status | (table.shotBlank ? 0x08 : 0)),
    ];
  }
  if (protocol === "stramatel") {
    // Type '3', 54 bytes; de vaste posities staan in lib/official-clock/protocols/stramatel.ts.
    const frame = Buffer.alloc(54, " ");
    frame[0] = 0xf8;
    frame.write("3", 1, "latin1");
    frame.write(lastMinute ? `${pad(Math.floor(tenths / 10), 2, "0")}${tenths % 10} ` : `${minutes}${seconds}`, 4, "latin1");
    frame.write(stopped ? "1" : "0", 20, "latin1");
    frame.write(pad(ceilSeconds(table.shot), 2), 48, "latin1");
    frame.write(stopped ? "1" : "0", 51, "latin1");
    frame.write(table.shotBlank ? "0" : "1", 52, "latin1");
    frame[53] = 0x0d;
    return [frame];
  }
  if (protocol === "swisstiming") {
    // Bericht 'D', 24 tekens; de vaste posities staan in lib/official-clock/protocols/swisstiming.ts.
    const body = Buffer.alloc(24, " ");
    body.write("D", 0, "latin1");
    body.write(lastMinute ? `${pad((tenths / 10).toFixed(1), 4)} ` : `${minutes}:${seconds}`, 1, "latin1");
    body.write(stopped ? "0" : "1", 18, "latin1");
    body.write(table.shotBlank ? "  " : pad(ceilSeconds(table.shot), 2), 22, "latin1");
    const framed = Buffer.concat([Buffer.from([0x02]), body, Buffer.from([0x03])]);
    return [Buffer.concat([framed, Buffer.from([framed.reduce((acc, byte) => acc ^ byte, 0)])])];
  }
  const reading = {
    clock: table.game < 60 ? ceilTenths(table.game) / 10 : ceilSeconds(table.game),
    clockRunning: table.running,
    shot: table.shotBlank ? null : ceilSeconds(table.shot),
    shotRunning: table.running && !table.shotBlank,
  };
  return [Buffer.from(`${JSON.stringify(reading)}\n`, "utf8")];
}

let send = () => {};
let socket = null;

function connectTcp() {
  socket = net.connect({ host, port });
  socket.on("connect", () => console.log(`Verbonden met ${host}:${port} (${protocol}).`));
  socket.on("error", (err) => console.log(`Geen verbinding met ${host}:${port}: ${err.message}. Nieuwe poging…`));
  socket.on("close", () => setTimeout(connectTcp, 2000));
  send = (buffer) => {
    if (socket && !socket.destroyed && socket.writable) socket.write(buffer);
  };
}

if (useUdp) {
  const udp = dgram.createSocket("udp4");
  udp.on("error", (err) => console.log(`UDP-fout: ${err.message}`));
  send = (buffer) => udp.send(buffer, port, host);
  console.log(`Stuurt ${protocol} via UDP naar ${host}:${port}.`);
} else {
  connectTcp();
}

/** Automatisch spelverloop: per stap wat de jurytafel doet en hoe lang dat duurt. */
const script = [
  { seconds: 3, apply: () => undefined },
  { seconds: 9, apply: () => (table.running = true) },
  { seconds: 3, apply: () => (table.running = false) },
  { seconds: 0.5, apply: () => (table.shot = 14) },
  { seconds: 8, apply: () => (table.running = true) },
  { seconds: 2, apply: () => ((table.running = false), (table.shot = 24)) },
  { seconds: 12, apply: () => (table.running = true) },
  { seconds: 3, apply: () => (table.running = false) },
];
let stepIndex = -1;
let stepEndsAt = 0;

function runScript() {
  if (Date.now() < stepEndsAt) return;
  stepIndex = (stepIndex + 1) % script.length;
  if (table.game <= 0) {
    table.game = 600;
    table.shot = 24;
  }
  if (table.shot <= 0) table.shot = 24;
  script[stepIndex].apply();
  stepEndsAt = Date.now() + script[stepIndex].seconds * 1000;
}

if (manual && process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (key) => {
    const ch = key.toString();
    advance();
    if (ch === " ") table.running = !table.running && table.game > 0 && (table.shot > 0 || table.shotBlank);
    if (ch === "r") table.shot = 24;
    if (ch === "t") table.shot = 14;
    if (ch === "b") table.shotBlank = !table.shotBlank;
    if (ch === "q" || ch === "\u0003") process.exit(0);
  });
  console.log("Handbediening: spatie = start/stop, r = 24, t = 14, b = shotclock uit/aan, q = stop.");
}

let lastPrinted = "";
setInterval(() => {
  advance();
  if (!manual) runScript();
  for (const frame of frames()) send(frame);
  const whole = ceilSeconds(table.game);
  const line = `${Math.floor(whole / 60)}:${pad(whole % 60, 2, "0")} ${table.running ? "loopt" : "staat stil"} · shotclock ${
    table.shotBlank ? "uit" : ceilSeconds(table.shot)
  }`;
  if (line !== lastPrinted) {
    lastPrinted = line;
    console.log(line);
  }
}, protocol === "stramatel" ? 200 : 100);
