import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { Command } from "../lib/validation/commands";
import {
  CloudAckError,
  DEFAULT_ACK_RETRY_DELAYS_MS,
  relayCloudCommands,
  type CloudAck,
} from "../lib/cloud-command-relay";

/**
 * Cloud-commando's op een echte, tijdelijke SQLite-database met hetzelfde schema-pad als de app
 * (server/db-init.ts). Een commando dat twee keer geleverd wordt, mag de stand maar één keer wijzigen.
 */
let tmpDir: string;
let prisma: PrismaClient;
let handleCommand: (typeof import("./handlers"))["handleCommand"];
let ledger: typeof import("./cloud-command-ledger");
let CommandSchema: (typeof import("../lib/validation/commands"))["CommandSchema"];
let matchId: string;

async function run(cmd: Command) {
  return prisma.$transaction((tx) => handleCommand(cmd, tx), { maxWait: 10_000, timeout: 20_000 });
}

/** Zoals `runtime.runCloudCommand`: valideren en uitvoeren in de transactie van de ledger. */
function applyCloud(commandId: string, command: unknown) {
  return ledger.runCloudCommandOnce(prisma, commandId, (tx) => handleCommand(CommandSchema.parse(command), tx));
}

async function score() {
  const m = await prisma.match.findUnique({ where: { id: matchId } });
  if (!m) throw new Error("no match");
  return { home: m.homeScore, away: m.awayScore };
}

/** Nagebootste cloud-wachtrij: levert alles wat nog niet bevestigd is, zoals de site. */
function fakeCloud() {
  const queue = new Map<string, { command: unknown; status: "pending" | "done" | "failed" }>();
  let rejectAcks = 0;
  const acks: Array<{ commandId: string; ack: CloudAck }> = [];
  return {
    enqueue(id: string, command: unknown) {
      queue.set(id, { command, status: "pending" });
    },
    pending() {
      return [...queue.entries()].filter(([, v]) => v.status === "pending").map(([id, v]) => ({ id, command: v.command }));
    },
    /** De volgende `n` bevestigingen komen niet aan (502 van de site of netwerk). */
    failNextAcks(n: number) {
      rejectAcks = n;
    },
    acks,
    async postAck(commandId: string, ack: CloudAck) {
      if (rejectAcks > 0) {
        rejectAcks -= 1;
        throw new CloudAckError("bevestiging geweigerd (502)", true);
      }
      acks.push({ commandId, ack });
      const row = queue.get(commandId);
      if (row) row.status = ack.ok ? "done" : "failed";
    },
    status(id: string) {
      return queue.get(id)?.status;
    },
  };
}

async function poll(cloud: ReturnType<typeof fakeCloud>) {
  await relayCloudCommands(cloud.pending(), {
    apply: applyCloud,
    postAck: cloud.postAck,
    markAcked: (id) => ledger.markCloudCommandAcked(prisma, id),
    log: () => undefined,
    sleep: async () => undefined,
  });
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arenacue-cloud-ledger-"));
  process.env.DATABASE_URL = `file:${path.join(tmpDir, "test.db").replace(/\\/g, "/")}?connection_limit=1`;
  const dbInit = await import("./db-init");
  await dbInit.ensureSqliteSchema();
  prisma = (await import("../lib/prisma")).prisma;
  handleCommand = (await import("./handlers")).handleCommand;
  ledger = await import("./cloud-command-ledger");
  CommandSchema = (await import("../lib/validation/commands")).CommandSchema;
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
  await prisma.appliedCloudCommand.deleteMany();
  const home = await prisma.team.create({
    data: { name: "Thuis", shortName: "THU", primaryColor: "#111111", secondaryColor: "#ffffff" },
  });
  const away = await prisma.team.create({
    data: { name: "Uit", shortName: "UIT", primaryColor: "#222222", secondaryColor: "#ffffff" },
  });
  const match = await prisma.match.create({
    data: { homeTeamId: home.id, awayTeamId: away.id, sport: "FOOTBALL", currentPeriod: 1, status: "FIRST_HALF" } as never,
  });
  matchId = match.id;
  await run({ type: "match:setActive", matchId });
});

describe("cloud-commando's hoogstens één keer", () => {
  it("wijzigt de score één keer als hetzelfde commando twee keer geleverd wordt", async () => {
    const goal = { type: "score:adjust", side: "home", delta: 1 };

    const first = await applyCloud("cmd-1", goal);
    const second = await applyCloud("cmd-1", goal);

    expect(first).toMatchObject({ duplicate: false, ack: { ok: true } });
    expect(second).toEqual({ duplicate: true, ack: { ok: true } });
    expect(await score()).toEqual({ home: 1, away: 0 });
  });

  it("voert een commando niet opnieuw uit nadat de bevestiging mislukte en de cloud het opnieuw levert", async () => {
    const cloud = fakeCloud();
    cloud.enqueue("cmd-goal", { type: "score:adjust", side: "home", delta: 1 });
    cloud.failNextAcks(1 + DEFAULT_ACK_RETRY_DELAYS_MS.length); // alle pogingen in deze poll mislukken

    await poll(cloud);
    expect(await score()).toEqual({ home: 1, away: 0 });
    expect(cloud.status("cmd-goal")).toBe("pending");
    const unacked = await prisma.appliedCloudCommand.findUnique({ where: { id: "cmd-goal" } });
    expect(unacked?.ackedAt).toBeNull();

    // Volgende poll: de cloud levert hetzelfde commando opnieuw, de bevestiging komt nu wel aan.
    await poll(cloud);
    expect(await score()).toEqual({ home: 1, away: 0 });
    expect(cloud.status("cmd-goal")).toBe("done");
    expect(cloud.acks).toEqual([{ commandId: "cmd-goal", ack: { ok: true, error: undefined, result: undefined } }]);
    const acked = await prisma.appliedCloudCommand.findUnique({ where: { id: "cmd-goal" } });
    expect(acked?.ackedAt).toBeInstanceOf(Date);

    // Daarna levert de cloud het niet meer en verandert er niets.
    await poll(cloud);
    expect(await score()).toEqual({ home: 1, away: 0 });
  });

  it("houdt de volgorde en voert elk ander id gewoon uit", async () => {
    const cloud = fakeCloud();
    cloud.enqueue("a", { type: "score:adjust", side: "home", delta: 1 });
    cloud.enqueue("b", { type: "score:adjust", side: "away", delta: 1 });
    cloud.enqueue("c", { type: "score:adjust", side: "home", delta: 1 });
    cloud.failNextAcks(1 + DEFAULT_ACK_RETRY_DELAYS_MS.length); // eerste commando: alle pogingen mislukken

    await poll(cloud);
    expect(await score()).toEqual({ home: 2, away: 1 });
    expect(cloud.status("a")).toBe("pending");
    expect(cloud.status("b")).toBe("done");

    await poll(cloud);
    expect(await score()).toEqual({ home: 2, away: 1 });
    expect(cloud.status("a")).toBe("done");
  });

  it("onthoudt een geweigerd commando, zodat een latere levering het niet alsnog uitvoert", async () => {
    let calls = 0;
    const refuseOnce = async () => {
      calls += 1;
      throw new Error("tijdelijk niet mogelijk");
    };

    await expect(ledger.runCloudCommandOnce(prisma, "cmd-refused", refuseOnce)).rejects.toThrow(/tijdelijk/);
    const again = await ledger.runCloudCommandOnce(prisma, "cmd-refused", async (tx) =>
      handleCommand({ type: "score:adjust", side: "home", delta: 1 }, tx),
    );

    expect(calls).toBe(1);
    expect(again).toEqual({ duplicate: true, ack: { ok: false, error: "tijdelijk niet mogelijk" } });
    expect(await score()).toEqual({ home: 0, away: 0 });
  });

  it("legt het id niet vast als de wijziging teruggedraaid wordt halverwege", async () => {
    await expect(
      ledger.runCloudCommandOnce(prisma, "cmd-half", async (tx) => {
        await handleCommand({ type: "score:adjust", side: "home", delta: 1 }, tx);
        throw new Error("fout na de wijziging");
      }),
    ).rejects.toThrow(/fout na de wijziging/);

    // Teruggedraaid: geen score, wel als mislukt onthouden.
    expect(await score()).toEqual({ home: 0, away: 0 });
    const row = await prisma.appliedCloudCommand.findUnique({ where: { id: "cmd-half" } });
    expect(row).toMatchObject({ ok: false, error: "fout na de wijziging" });
  });
});

describe("opruimen van uitgevoerde ids", () => {
  it("verwijdert alleen ids die de cloud zeker niet meer levert", async () => {
    const now = new Date("2026-11-17T12:00:00Z");
    const hours = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);
    await prisma.appliedCloudCommand.createMany({
      data: [
        { id: "acked-old", ok: true, appliedAt: hours(30), ackedAt: hours(25) },
        { id: "acked-recent", ok: true, appliedAt: hours(2), ackedAt: hours(1) },
        { id: "unacked-week", ok: true, appliedAt: hours(24 * 7) },
        { id: "unacked-ancient", ok: true, appliedAt: hours(24 * 31) },
      ],
    });

    const removed = await ledger.pruneAppliedCloudCommands(prisma, now);

    expect(removed).toBe(2);
    const left = (await prisma.appliedCloudCommand.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map(
      (r) => r.id,
    );
    expect(left).toEqual(["acked-recent", "unacked-week"]);
  });
});
