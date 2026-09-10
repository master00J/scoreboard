import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { Command } from "../lib/validation/commands";

/**
 * Handler-tests op een echte, tijdelijke SQLite-database: hetzelfde schema-pad als de app
 * (server/db-init.ts) en dezelfde transactie-aanroep als runtime.runCommand.
 */
let tmpDir: string;
let prisma: PrismaClient;
let handleCommand: (typeof import("./handlers"))["handleCommand"];
let readJournalMode: (typeof import("./db-init"))["readJournalMode"];

async function run(cmd: Command) {
  return prisma.$transaction((tx) => handleCommand(cmd, tx), { maxWait: 10_000, timeout: 20_000 });
}

async function seedMatch(sport: string, extra: Record<string, unknown> = {}) {
  const home = await prisma.team.create({
    data: { name: "Thuis", shortName: "THU", primaryColor: "#111111", secondaryColor: "#ffffff" },
  });
  const away = await prisma.team.create({
    data: { name: "Uit", shortName: "UIT", primaryColor: "#222222", secondaryColor: "#ffffff" },
  });
  for (let n = 1; n <= 12; n += 1) {
    await prisma.player.create({
      data: { teamId: home.id, number: n, firstName: `H${n}`, lastName: "Speler" },
    });
    await prisma.player.create({
      data: { teamId: away.id, number: n, firstName: `A${n}`, lastName: "Speler" },
    });
  }
  const match = await prisma.match.create({
    data: {
      homeTeamId: home.id,
      awayTeamId: away.id,
      sport,
      currentPeriod: 1,
      status: "FIRST_HALF",
      ...extra,
    } as never,
  });
  await run({ type: "match:setActive", matchId: match.id });
  return match;
}

async function state() {
  const s = await prisma.displayState.findUnique({ where: { id: 1 } });
  if (!s) throw new Error("no state");
  return s;
}

async function matchRow(id: string) {
  const m = await prisma.match.findUnique({ where: { id } });
  if (!m) throw new Error("no match");
  return m;
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arenacue-handlers-"));
  process.env.DATABASE_URL = `file:${path.join(tmpDir, "test.db").replace(/\\/g, "/")}?connection_limit=1`;
  const dbInit = await import("./db-init");
  readJournalMode = dbInit.readJournalMode;
  await dbInit.ensureSqliteSchema();
  prisma = (await import("../lib/prisma")).prisma;
  handleCommand = (await import("./handlers")).handleCommand;
});

afterAll(async () => {
  await prisma?.$disconnect();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* Windows kan het bestand nog even vasthouden */
  }
});

beforeEach(async () => {
  await prisma.matchEvent.deleteMany();
  await prisma.displayState.deleteMany();
  await prisma.match.deleteMany();
  await prisma.player.deleteMany();
  await prisma.team.deleteMany();
});

describe("database-initialisatie", () => {
  it("zet WAL aan zonder te crashen op PRAGMA-resultaten", async () => {
    expect(await readJournalMode()).toBe("wal");
  });
});

describe("voetbal", () => {
  it("zet de 2e helft op de ingestelde periodeduur en werkt de periode bij", async () => {
    const m = await seedMatch("FOOTBALL", { periodDurationSec: 2400, halfDurationSec: 2400 });
    await run({ type: "timer:preset", preset: "SECOND_HALF" });
    const s = await state();
    expect(s.timerBaseSec).toBe(2400);
    expect(s.timerRunning).toBe(false);
    const row = await matchRow(m.id);
    expect(row.currentPeriod).toBe(2);
    expect(row.status).toBe("SECOND_HALF");

    await run({ type: "timer:preset", preset: "ET1" });
    expect((await state()).timerBaseSec).toBe(4800);
    expect((await matchRow(m.id)).currentPeriod).toBe(3);
    expect((await matchRow(m.id)).status).toBe("EXTRA_TIME");
  });

  it("leidt de periode af als alleen een status binnenkomt (fasenknoppen, mobiel)", async () => {
    const m = await seedMatch("FOOTBALL");
    await run({ type: "match:setStatus", status: "SECOND_HALF" });
    expect((await matchRow(m.id)).currentPeriod).toBe(2);
    await run({ type: "match:setStatus", status: "HALF_TIME" });
    expect((await state()).timerRunning).toBe(false);
  });

  it("logt een doelpunt met periode en klokstand en draait het terug via undo", async () => {
    const m = await seedMatch("FOOTBALL");
    await run({ type: "timer:set", seconds: 1500 });
    await run({ type: "goal:trigger", side: "home" });
    expect((await matchRow(m.id)).homeScore).toBe(1);
    const ev = await prisma.matchEvent.findFirst({ where: { matchId: m.id, type: "GOAL" } });
    expect(ev?.period).toBe(1);
    expect(ev?.clockSec).toBe(1500);
    await run({ type: "event:undo", eventId: ev!.id });
    expect((await matchRow(m.id)).homeScore).toBe(0);
  });
});

describe("basketbal", () => {
  it("logt punten met terugdraai-info en maakt ze ongedaan", async () => {
    const m = await seedMatch("BASKETBALL", { periodDurationSec: 600 });
    await run({ type: "score:adjust", side: "away", delta: 3 });
    await run({ type: "score:adjust", side: "away", delta: 2 });
    expect((await matchRow(m.id)).awayScore).toBe(5);
    const events = await prisma.matchEvent.findMany({ where: { matchId: m.id, type: "POINT" }, orderBy: { createdAt: "asc" } });
    expect(events).toHaveLength(2);
    expect(JSON.parse(events[0]!.metaJson ?? "{}")).toMatchObject({ side: "away", delta: 3, from: 0, to: 3 });
    await run({ type: "event:undo", eventId: events[0]!.id });
    expect((await matchRow(m.id)).awayScore).toBe(2);
  });

  it("kent verlenging: 5 minuten, 1 time-out, fouten lopen door uit Q4", async () => {
    const m = await seedMatch("BASKETBALL", { periodDurationSec: 600 });
    await run({ type: "sport:setPeriod", period: 4 });
    await run({ type: "sport:statAdjust", stat: "foul", side: "home", delta: 1 });
    await run({ type: "sport:statAdjust", stat: "foul", side: "home", delta: 1 });
    await run({ type: "sport:setPeriod", period: 5 });
    const row = await matchRow(m.id);
    expect(row.currentPeriod).toBe(5);
    expect(row.status).toBe("EXTRA_TIME");
    expect(row.homeFouls).toBe(2);
    expect(row.homeTimeouts).toBe(0);
    await expect(run({ type: "sport:setPeriod", period: 10 })).rejects.toThrow();
    // Q-wissel binnen de reguliere tijd reset de teamfouten wél.
    await run({ type: "sport:setPeriod", period: 3 });
    expect((await matchRow(m.id)).homeFouls).toBe(0);
  });

  it("stopt de aftellende klok aan het einde van de periode en start dan niet meer", async () => {
    await seedMatch("BASKETBALL", { periodDurationSec: 600 });
    await run({ type: "timer:set", seconds: 5000 });
    expect((await state()).timerBaseSec).toBe(600);
    await expect(run({ type: "timer:start" })).rejects.toThrow(/00:00/);
    await run({ type: "timer:set", seconds: 590 });
    await run({ type: "timer:start" });
    expect((await state()).timerRunning).toBe(true);
  });

  it("start een time-outklok, telt hem aan en pauzeert de wedstrijdklok", async () => {
    const m = await seedMatch("BASKETBALL", { periodDurationSec: 600 });
    await run({ type: "timer:start" });
    await run({ type: "timeout:start", side: "home" });
    const s = await state();
    expect(s.timeoutRunning).toBe(true);
    expect(s.timeoutSide).toBe("home");
    expect(s.timeoutBaseSec).toBe(60);
    expect(s.timerRunning).toBe(false);
    expect((await matchRow(m.id)).homeTimeouts).toBe(1);
    await expect(run({ type: "timeout:start", side: "away" })).rejects.toThrow(/loopt al/);
    await run({ type: "timeout:clear" });
    expect((await state()).timeoutRunning).toBe(false);
    // Limiet in de eerste helft: 2.
    await run({ type: "timeout:start", side: "home" });
    await run({ type: "timeout:clear" });
    await expect(run({ type: "timeout:start", side: "home" })).rejects.toThrow(/limiet/i);
  });
});

describe("volleybal", () => {
  it("wint een set automatisch, wisselt de eerste server en weigert punten na de matchwinst", async () => {
    const m = await seedMatch("VOLLEYBALL", {
      periodDurationSec: 0,
      servingSide: "home",
      setFirstServer: "home",
      setHistoryJson: "[]",
      setsToWin: 2,
      pointsToWinSet: 25,
      pointsToWinDecider: 15,
    });
    await run({ type: "score:set", homeScore: 24, awayScore: 20 });
    await run({ type: "score:adjust", side: "home", delta: 1 });
    let row = await matchRow(m.id);
    expect(row.homeSets).toBe(1);
    expect(row.currentPeriod).toBe(2);
    expect(row.homeScore).toBe(0);
    expect(row.setFirstServer).toBe("away");
    expect(row.servingSide).toBe("away");
    expect(JSON.parse(row.setHistoryJson ?? "[]")).toEqual([{ home: 25, away: 20, firstServer: "home" }]);

    await run({ type: "score:set", homeScore: 24, awayScore: 23 });
    await run({ type: "score:adjust", side: "home", delta: 1 });
    row = await matchRow(m.id);
    expect(row.homeSets).toBe(2);
    expect(row.status).toBe("FULL_TIME");
    expect((await state()).mode).toBe("FULLTIME");
    await expect(run({ type: "score:adjust", side: "away", delta: 1 })).rejects.toThrow(/afgelopen/);
  });

  it("start bij een technische time-out de time-outklok in plaats van de rust", async () => {
    const m = await seedMatch("VOLLEYBALL", {
      periodDurationSec: 0,
      servingSide: "home",
      setFirstServer: "home",
      setHistoryJson: "[]",
      technicalTimeoutsEnabled: true,
    });
    await run({ type: "score:set", homeScore: 7, awayScore: 3 });
    await run({ type: "score:adjust", side: "home", delta: 1 });
    const s = await state();
    expect(s.timeoutRunning).toBe(true);
    expect(s.timeoutSide).toBe("technical");
    expect((await matchRow(m.id)).status).toBe("FIRST_HALF");
    await run({ type: "sport:resumePlay" });
    expect((await state()).timeoutRunning).toBe(false);
  });

  it("zet bij 0–0 de eerste server mee met de servicekeuze", async () => {
    const m = await seedMatch("VOLLEYBALL", {
      periodDurationSec: 0,
      servingSide: "home",
      setFirstServer: "home",
      setHistoryJson: "[]",
    });
    await run({ type: "sport:setServing", side: "away" });
    const row = await matchRow(m.id);
    expect(row.servingSide).toBe("away");
    expect(row.setFirstServer).toBe("away");
  });
});

describe("hockey", () => {
  it("laat de straftijd pas lopen met de wedstrijdklok", async () => {
    const m = await seedMatch("HOCKEY", { periodDurationSec: 900 });
    const player = await prisma.player.findFirst({ where: { teamId: m.homeTeamId } });
    await run({ type: "card:trigger", teamId: m.homeTeamId, playerId: player!.id, color: "GREEN" });
    let s = await state();
    expect(s.homePenaltyBaseSec).toBe(120);
    expect(s.homePenaltyRunning).toBe(false);
    expect(s.activeCardColor).toBe("GREEN");
    await run({ type: "timer:start" });
    s = await state();
    expect(s.homePenaltyRunning).toBe(true);
    await run({ type: "timer:pause" });
    s = await state();
    expect(s.homePenaltyRunning).toBe(false);
    expect(s.homePenaltyBaseSec).toBeGreaterThan(115);
    expect(s.homePenaltyBaseSec).toBeLessThanOrEqual(120);
    await expect(
      run({ type: "card:trigger", teamId: m.homeTeamId, playerId: player!.id, color: "GREEN" }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("weigert kaarten die de sport niet kent", async () => {
    const m = await seedMatch("BASKETBALL", { periodDurationSec: 600 });
    const player = await prisma.player.findFirst({ where: { teamId: m.homeTeamId } });
    await expect(
      run({ type: "card:trigger", teamId: m.homeTeamId, playerId: player!.id, color: "YELLOW" }),
    ).rejects.toThrow();
  });
});

describe("gelijktijdige commando's", () => {
  it("verliest geen punt als twee bedieningen tegelijk +1 sturen", async () => {
    const m = await seedMatch("BASKETBALL", { periodDurationSec: 600 });
    await Promise.all([
      run({ type: "score:adjust", side: "home", delta: 1 }),
      run({ type: "score:adjust", side: "home", delta: 1 }),
      run({ type: "score:adjust", side: "home", delta: 1 }),
    ]);
    expect((await matchRow(m.id)).homeScore).toBe(3);
  });
});
