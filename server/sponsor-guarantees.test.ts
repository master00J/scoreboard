import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

/** Garanties en tekorten op een echte, tijdelijke SQLite-database (zelfde schema als de app). */
let tmpDir: string;
let prisma: PrismaClient;
let g: typeof import("./sponsor-guarantees");

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arenacue-sponsor-guarantees-"));
  process.env.DATABASE_URL = `file:${path.join(tmpDir, "test.db").replace(/\\/g, "/")}?connection_limit=1`;
  const dbInit = await import("./db-init");
  await dbInit.ensureSqliteSchema();
  prisma = (await import("../lib/prisma")).prisma;
  g = await import("./sponsor-guarantees");
});

afterAll(async () => {
  await prisma?.$disconnect();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* Windows kan het bestand nog even vasthouden */
  }
});

let matchId = "";

beforeEach(async () => {
  await prisma.sponsorPlayLog.deleteMany();
  await prisma.sponsorPhaseBooking.deleteMany();
  await prisma.scheduledMediaCue.deleteMany();
  await prisma.mediaItem.deleteMany();
  await prisma.sponsor.deleteMany();
  await prisma.match.deleteMany();
  await prisma.team.deleteMany();
  const home = await prisma.team.create({
    data: { name: "Home", shortName: "HOM", primaryColor: "#000", secondaryColor: "#fff" },
  });
  const away = await prisma.team.create({
    data: { name: "Away", shortName: "AWA", primaryColor: "#000", secondaryColor: "#fff" },
  });
  const match = await prisma.match.create({
    data: { homeTeamId: home.id, awayTeamId: away.id, status: "FIRST_HALF" },
  });
  matchId = match.id;
});

async function sponsor(name: string, guaranteeJson: string | null = null) {
  return prisma.sponsor.create({
    data: {
      name,
      prematchSeconds: 0,
      matchSeconds: 120,
      matchFirstHalfSeconds: 60,
      matchSecondHalfSeconds: 60,
      halftimeSeconds: 30,
      postmatchSeconds: 0,
      guaranteeJson,
    },
  });
}

async function play(sponsorId: string, phase: string, ms: number, expectedSec = 10, i = Math.random()) {
  await prisma.sponsorPlayLog.create({
    data: {
      matchId,
      sponsorId,
      ledgerSponsorId: sponsorId,
      sponsorName: "x",
      mediaTitle: "clip",
      segmentKey: `${matchId}:${phase}`,
      expectedSec,
      actualSec: Math.round(ms / 1000),
      actualMs: ms,
      startedAt: new Date(),
      endedAt: new Date(),
      clipSessionId: `s-${phase}-${ms}-${i}`,
    },
  });
}

async function setStatus(status: string) {
  await prisma.match.update({ where: { id: matchId }, data: { status } });
}

describe("phase booking snapshots", () => {
  it("records what each sponsor booked at the start of a phase, once", async () => {
    const a = await sponsor("A");
    expect(await g.snapshotPhaseBookings(prisma, matchId)).toBe(1);
    expect(await g.snapshotPhaseBookings(prisma, matchId)).toBe(0);
    const rows = await prisma.sponsorPhaseBooking.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sponsorId: a.id, segmentKey: `${matchId}:FIRST_HALF`, bookedSec: 60, carryInSec: 0 });
  });

  it("carries a first-half shortfall into halftime when the booking allows catch-up there", async () => {
    const a = await sponsor("A", JSON.stringify({ kind: "seconds", catchUpIn: ["halftime"] }));
    const b = await sponsor("B");
    await g.snapshotPhaseBookings(prisma, matchId);
    await play(a.id, "FIRST_HALF", 40_000);
    await play(b.id, "FIRST_HALF", 40_000);
    await setStatus("HALF_TIME");
    await g.snapshotPhaseBookings(prisma, matchId);
    const ht = await prisma.sponsorPhaseBooking.findMany({ where: { segmentKey: `${matchId}:halftime` } });
    expect(ht.find((r) => r.sponsorId === a.id)?.carryInSec).toBe(20);
    expect(ht.find((r) => r.sponsorId === b.id)?.carryInSec).toBe(0);

    const live = await g.sponsorGuaranteeLive(prisma, matchId);
    const la = live!.sponsors.find((s) => s.id === a.id)!;
    expect(live!.segment).toBe("halftime");
    expect(la).toMatchObject({ bookedSec: 30, carryInSec: 20, deliveredSec: 0, openFromEarlierSec: 0 });
    const lb = live!.sponsors.find((s) => s.id === b.id)!;
    expect(lb).toMatchObject({ bookedSec: 30, carryInSec: 0, openFromEarlierSec: 20 });
  });
});

describe("report: booked seconds and open shortfall", () => {
  it("keeps the file targets at booking time, including a cue-only sponsor that never started", async () => {
    const s = await sponsor("Cue only");
    await prisma.sponsor.update({ where: { id: s.id }, data: { matchFirstHalfSeconds: 0 } });
    const media = await prisma.mediaItem.create({ data: { sponsorId: s.id, type: "IMAGE", title: "Banner", path: "banner.png", durationSec: 5 } });
    await prisma.scheduledMediaCue.create({ data: { mediaId: media.id, matchStatus: "FIRST_HALF", triggerSec: 2, endSec: 9 } });
    await g.snapshotPhaseBookings(prisma, matchId);
    await prisma.scheduledMediaCue.deleteMany();
    const r = (await g.summarizeSponsorBookings(prisma, { matchId })).get(s.id);
    expect(r).toMatchObject({ bookedSec: 7, shortfallSec: 7, files: [{ title: "Banner", plannedSec: 7, deliveredSec: 0 }] });
  });

  it("rejects overlapping slots and rolls back the whole batch, including phase aliases", async () => {
    const { writeScheduledCues } = await import("./scheduled-cue-writes");
    const media = await prisma.mediaItem.create({ data: { type: "IMAGE", title: "Banner", path: "banner.png", durationSec: 5 } });
    const cue = { mediaId: media.id, matchStatus: "SETUP", triggerSec: 0, endSec: 5 };
    expect((await writeScheduledCues(prisma, [cue, { ...cue, matchStatus: "PREMATCH", triggerSec: 4, endSec: 8 }])).status).toBe(409);
    expect(await prisma.scheduledMediaCue.count()).toBe(0);
    const saved = await writeScheduledCues(prisma, [cue, { ...cue, triggerSec: 5, endSec: 12 }]);
    expect(saved.status).toBe(200);
    const [one, two] = await prisma.scheduledMediaCue.findMany({ orderBy: { triggerSec: "asc" } });
    expect((await writeScheduledCues(prisma, [{ id: one.id, endSec: 7 }, { id: two.id, triggerSec: 7 }])).status).toBe(200);
    expect((await writeScheduledCues(prisma, [{ id: two.id, triggerSec: 3 }])).status).toBe(409);
    expect((await prisma.scheduledMediaCue.findUniqueOrThrow({ where: { id: two.id } })).triggerSec).toBe(7);
  });

  it("adds booked and shortfall to the per-sponsor summary, also for a sponsor that never played", async () => {
    const a = await sponsor("A");
    const b = await sponsor("B");
    await g.snapshotPhaseBookings(prisma, matchId);
    await play(a.id, "FIRST_HALF", 45_500);
    const bookings = await g.summarizeSponsorBookings(prisma, { matchId });
    expect(bookings.get(a.id)).toMatchObject({ bookedSec: 60, shortfallSec: 14.5 });
    const merged = g.mergeBookingsIntoSummary(
      [{ sponsorId: a.id, sponsorName: "A", plays: 1, actualSec: 45.5, expectedSec: 10 }],
      bookings,
    );
    expect(merged.find((r) => r.sponsorId === b.id)).toMatchObject({ plays: 0, bookedSec: 60, shortfallSec: 60 });
  });

  it("with full plays owed only complete clips count", async () => {
    const a = await sponsor("A", JSON.stringify({ kind: "plays", catchUpIn: [] }));
    await g.snapshotPhaseBookings(prisma, matchId);
    await play(a.id, "FIRST_HALF", 10_000, 10);
    await play(a.id, "FIRST_HALF", 1_210, 8);
    const bookings = await g.summarizeSponsorBookings(prisma, { matchId });
    expect(bookings.get(a.id)).toMatchObject({ bookedSec: 60, shortfallSec: 50 });
  });
});
