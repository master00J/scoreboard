import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { OfficialClockHandle } from "../electron/official-clock";
import { bodetLrc } from "../lib/official-clock/protocols/bodet";
import type { OfficialClockStatus } from "../lib/official-clock/types";
import { formatSportClock } from "../lib/sports";
import { computeElapsedSeconds, computeShotClockSeconds } from "../lib/timer";

/**
 * De hele keten zonder vensters: een nagebootste Bodet-console stuurt over een echte TCP-verbinding,
 * de dienst leest mee, en de echte runtime (commando's, tick-loop, SQLite) stuurt de klok bij.
 * Loopt in echte tijd, dus de grenzen hieronder zijn ruimer dan in de gesimuleerde tests in lib/.
 */

const PERIOD_SEC = 600;
let tmpDir: string;
let prisma: PrismaClient;
let runtime: typeof import("../electron/runtime");
let service: OfficialClockHandle;
let console_: net.Socket;
let status: OfficialClockStatus | null = null;
const logLines: string[] = [];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as net.AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

/** Bericht zoals een Scorepad het stuurt: SOH 7F STX 47 <tekst> ETX LRC. */
function frame(text: string, status?: number): Buffer {
  const message = Buffer.from(text, "latin1");
  if (status !== undefined) message[2] = status;
  const body = Buffer.concat([Buffer.from([0x01, 0x7f, 0x02, 0x47]), message, Buffer.from([0x03])]);
  return Buffer.concat([body, Buffer.from([bodetLrc(body, 1, body.length - 1)])]);
}

/** De klokken aan de jurytafel. `send()` stuurt wat het bord op dat moment toont. */
const table = {
  game: 120,
  gameRunning: false,
  shot: 24,
  shotRunning: false,
  shotBlank: false,
  lastStepAt: 0,
  step() {
    const now = Date.now();
    const passed = this.lastStepAt ? (now - this.lastStepAt) / 1000 : 0;
    this.lastStepAt = now;
    if (this.gameRunning) this.game = Math.max(0, this.game - passed);
    if (this.shotRunning) this.shot = Math.max(0, this.shot - passed);
    // Op nul stopt de console zelf, en de shotclock met haar.
    if (this.game <= 0) this.gameRunning = this.shotRunning = false;
  },
  send() {
    this.step();
    const whole = Math.ceil(this.game - 1e-9);
    const mmss = `${String(Math.floor(whole / 60)).padStart(2, " ")}${String(whole % 60).padStart(2, "0")}`;
    // Bericht 18: "18", statusbyte, sport 5, MMSS, time-outs, twee spaties, periode, spatie.
    console_.write(frame(`18?5${mmss}00  1 `, this.gameRunning ? 0x80 : 0x82));
    const shotStatus = (this.shotRunning ? 0x80 : 0x82) | (this.shotBlank ? 0x08 : 0);
    console_.write(frame(`50?${String(Math.ceil(this.shot - 1e-9)).padStart(2, " ")}`, shotStatus));
  },
};

async function snapshot() {
  const state = await prisma.displayState.findUnique({ where: { id: 1 } });
  if (!state) throw new Error("no display state");
  const now = Date.now();
  return {
    state,
    gameRemaining: PERIOD_SEC - computeElapsedSeconds(state, now),
    shotRemaining: computeShotClockSeconds(state, now),
  };
}

/** Laat de console `ms` lang tien keer per seconde sturen en meet intussen het verschil met ArenaCue. */
async function play(ms: number) {
  const until = Date.now() + ms;
  let maxGameGap = 0;
  let maxShotGap = 0;
  while (Date.now() < until) {
    table.send();
    await sleep(50);
    table.step();
    const now = await snapshot();
    maxGameGap = Math.max(maxGameGap, Math.abs(now.gameRemaining - table.game));
    if (!table.shotBlank && !now.state.shotClockOff) {
      maxShotGap = Math.max(maxShotGap, Math.abs(now.shotRemaining - table.shot));
    }
    await sleep(50);
  }
  return { maxGameGap, maxShotGap };
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arenacue-official-clock-"));
  process.env.DATABASE_URL = `file:${path.join(tmpDir, "test.db").replace(/\\/g, "/")}?connection_limit=1`;
  runtime = await import("../electron/runtime");
  await runtime.initDesktopRuntime({
    getControlWindow: () => null,
    getDisplayWindow: () => null,
    getStreamWindow: () => null,
    log: (line) => logLines.push(line),
  });
  prisma = (await import("../lib/prisma")).prisma;

  const home = await prisma.team.create({
    data: { name: "Thuis", shortName: "THU", primaryColor: "#111111", secondaryColor: "#ffffff" },
  });
  const away = await prisma.team.create({
    data: { name: "Uit", shortName: "UIT", primaryColor: "#222222", secondaryColor: "#ffffff" },
  });
  const match = await prisma.match.create({
    data: {
      homeTeamId: home.id,
      awayTeamId: away.id,
      sport: "BASKETBALL",
      currentPeriod: 1,
      periodDurationSec: PERIOD_SEC,
      status: "FIRST_HALF",
    } as never,
  });
  expect((await runtime.runCommand({ type: "match:setActive", matchId: match.id })).ok).toBe(true);

  const port = await freePort();
  const settingsPath = path.join(tmpDir, "official-clock.json");
  fs.writeFileSync(settingsPath, JSON.stringify({ enabled: true, protocol: "bodet", connection: "tcp-listen", port }));
  const { startOfficialClock } = await import("../electron/official-clock");
  service = startOfficialClock({
    settingsPath,
    captureDir: path.join(tmpDir, "captures"),
    runtime: {
      getContext: () => runtime.getOfficialClockContext(),
      sync: (targets) => runtime.syncOfficialClock(targets),
      setHornMute: (mute) => runtime.setOfficialClockHornMute(mute),
    },
    log: (line) => logLines.push(line),
    onStatus: (next) => {
      status = next;
    },
    signalTimeoutMs: 700,
  });

  await sleep(200);
  console_ = net.connect({ host: "127.0.0.1", port });
  await new Promise<void>((resolve, reject) => {
    console_.once("connect", () => resolve());
    console_.once("error", reject);
  });
}, 60_000);

afterAll(async () => {
  console_?.destroy();
  service?.stop();
  runtime?.disposeDesktopRuntime();
  await prisma?.$disconnect();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* Windows houdt de database soms nog even vast */
  }
});

describe("official clock, console to stadium screen", () => {
  it("takes over the stopped clocks of the console", async () => {
    // De eerste berichten komen binnen voordat de dienst weet of de sport op- of aftelt; even doorsturen.
    await play(1500);
    const now = await snapshot();
    expect(status?.link).toBe("receiving");
    expect(status?.followingGameClock).toBe(true);
    expect(status?.followingShotClock).toBe(true);
    expect(now.state.timerRunning).toBe(false);
    expect(formatSportClock("BASKETBALL", now.gameRemaining)).toBe("02:00");
    expect(now.state.shotClockRunning).toBe(false);
    expect(now.shotRemaining).toBe(24);
  });

  it("starts with the console and stays close to it while play runs", async () => {
    table.gameRunning = table.shotRunning = true;
    await play(400);
    const gaps = await play(3000);
    const now = await snapshot();
    expect(now.state.timerRunning).toBe(true);
    expect(now.state.shotClockRunning).toBe(true);
    // Berichten om de 0,1 s over een lokale verbinding, plus onze controle om de 0,1 s.
    expect(gaps.maxGameGap).toBeLessThan(0.4);
    expect(gaps.maxShotGap).toBeLessThan(0.4);
  });

  it("stops with the whistle and then shows exactly what the board shows", async () => {
    table.step();
    table.gameRunning = table.shotRunning = false;
    await play(800);
    const now = await snapshot();
    expect(now.state.timerRunning).toBe(false);
    expect(now.state.shotClockRunning).toBe(false);
    expect(formatSportClock("BASKETBALL", now.gameRemaining)).toBe(formatSportClock("BASKETBALL", table.game));
    expect(Math.ceil(now.shotRemaining - 1e-9)).toBe(Math.ceil(table.shot - 1e-9));
  });

  it("follows a shot clock reset and a blanked shot clock", async () => {
    table.shot = 14;
    await play(500);
    let now = await snapshot();
    expect(now.shotRemaining).toBe(14);
    expect(now.state.shotClockRunning).toBe(false);

    table.shotBlank = true;
    await play(500);
    now = await snapshot();
    expect(now.state.shotClockOff).toBe(true);

    table.shotBlank = false;
    table.gameRunning = table.shotRunning = true;
    await play(1200);
    now = await snapshot();
    expect(now.state.shotClockOff).toBe(false);
    expect(now.state.shotClockRunning).toBe(true);
    expect(Math.abs(now.shotRemaining - table.shot)).toBeLessThan(0.4);
  });

  it("closes the period once, with the console, and follows it into the next period", async () => {
    // De jurytafel corrigeert de klok naar 1,4 s; die loopt af.
    table.step();
    table.game = 1.4;
    await play(2500);
    let now = await snapshot();
    expect(table.game).toBe(0);
    expect(now.state.timerRunning).toBe(false);
    expect(now.gameRemaining).toBe(0);
    // ArenaCue sloot de periode zelf af, precies één keer.
    expect(logLines.filter((line) => /periode-einde/.test(line))).toHaveLength(1);

    // De volgende periode staat klaar aan de jurytafel; in ArenaCue is de periode nog niet gewisseld.
    table.game = 600;
    table.shot = 24;
    await play(600);
    now = await snapshot();
    expect(formatSportClock("BASKETBALL", now.gameRemaining)).toBe("10:00");
    expect(now.state.timerRunning).toBe(false);

    table.gameRunning = table.shotRunning = true;
    await play(1200);
    now = await snapshot();
    expect(now.state.timerRunning).toBe(true);
    expect(Math.abs(now.gameRemaining - table.game)).toBeLessThan(0.4);
    expect(logLines.filter((line) => /periode-einde/.test(line))).toHaveLength(1);
  });

  it("falls back to ArenaCue's own clock when the signal drops, and manual control still works", async () => {
    // Geen berichten meer terwijl de klok loopt: ArenaCue telt zelf door.
    const before = await snapshot();
    await sleep(1300);
    expect(status?.link).toBe("lost");
    const after = await snapshot();
    expect(after.state.timerRunning).toBe(true);
    expect(after.gameRemaining).toBeLessThan(before.gameRemaining - 1);

    // De operator neemt het over met de gewone knoppen; niets zet dat terug.
    expect((await runtime.runCommand({ type: "timer:pause" })).ok).toBe(true);
    expect((await runtime.runCommand({ type: "shotclock:reset", seconds: 24 })).ok).toBe(true);
    await sleep(400);
    const manual = await snapshot();
    expect(manual.state.timerRunning).toBe(false);
    expect(manual.shotRemaining).toBe(24);
    expect(status?.followingGameClock).toBe(false);
  });

  it("writes nothing while following is switched off", async () => {
    service.saveSettings({ ...service.getSettings(), enabled: false });
    await sleep(300);
    expect(service.getStatus().link).toBe("off");
    const before = (await snapshot()).state.updatedAt.getTime();
    await sleep(500);
    expect((await snapshot()).state.updatedAt.getTime()).toBe(before);
    expect(logLines.filter((line) => /bijsturen/.test(line))).toEqual([]);
  });
});
