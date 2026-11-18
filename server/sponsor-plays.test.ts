import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { proofOfPlayTotals } from "../lib/sponsor-play-filters";

/** Proof-of-play queries on a real, temporary SQLite database (same schema path as the app). */
let tmpDir: string;
let prisma: PrismaClient;
let plays: typeof import("./sponsor-plays");

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arenacue-sponsor-plays-"));
  process.env.DATABASE_URL = `file:${path.join(tmpDir, "test.db").replace(/\\/g, "/")}?connection_limit=1`;
  const dbInit = await import("./db-init");
  await dbInit.ensureSqliteSchema();
  prisma = (await import("../lib/prisma")).prisma;
  plays = await import("./sponsor-plays");
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
  await prisma.sponsorPlayLog.deleteMany();
});

type Seed = { segmentKey: string; sponsorName: string; actualSec: number; expectedSec: number };

async function seed(rows: Seed[]) {
  const base = Date.UTC(2026, 10, 1, 18, 0, 0);
  await prisma.sponsorPlayLog.createMany({
    data: rows.map((r, i) => ({
      sponsorName: r.sponsorName,
      mediaTitle: "clip",
      segmentKey: r.segmentKey,
      expectedSec: r.expectedSec,
      actualSec: r.actualSec,
      startedAt: new Date(base + i * 1000),
      endedAt: new Date(base + i * 1000 + 500),
      clipSessionId: `s${i}`,
    })),
  });
}

function params(q: Record<string, string>) {
  return new URLSearchParams(q);
}

describe("proof-of-play phase filter", () => {
  it("finds plays per phase in keys of the form <matchId>:<phase>, including post-match", async () => {
    await seed([
      { segmentKey: "matchA:prematch", sponsorName: "A", actualSec: 10, expectedSec: 10 },
      { segmentKey: "matchA:FIRST_HALF", sponsorName: "A", actualSec: 15, expectedSec: 15 },
      { segmentKey: "matchB:FIRST_HALF", sponsorName: "B", actualSec: 20, expectedSec: 20 },
      { segmentKey: "matchA:halftime", sponsorName: "A", actualSec: 30, expectedSec: 30 },
      { segmentKey: "matchA:SECOND_HALF", sponsorName: "B", actualSec: 15, expectedSec: 15 },
      { segmentKey: "matchA:postmatch", sponsorName: "A", actualSec: 12, expectedSec: 12 },
    ]);
    const count = async (segmentKey: string) =>
      (await plays.listSponsorPlays(prisma, plays.parseSponsorPlayFilters(params({ segmentKey })), 500))
        .length;
    expect(await count("FIRST_HALF")).toBe(2);
    expect(await count("SECOND_HALF")).toBe(1);
    expect(await count("prematch")).toBe(1);
    expect(await count("halftime")).toBe(1);
    expect(await count("postmatch")).toBe(1);
    expect(await count("EXTRA_TIME")).toBe(0);
    expect(await count("matchB:FIRST_HALF")).toBe(1);

    const summary = await plays.summarizeSponsorPlays(
      prisma,
      plays.parseSponsorPlayFilters(params({ segmentKey: "FIRST_HALF" })),
    );
    expect(proofOfPlayTotals(summary).totalActualSec).toBe(35);
  });
});

describe("proof-of-play totals", () => {
  it("counts every play when there are more than the 500 rows the list shows", async () => {
    const rows: Seed[] = [];
    for (let i = 0; i < 650; i += 1) {
      rows.push({
        segmentKey: `matchA:${i % 2 === 0 ? "FIRST_HALF" : "SECOND_HALF"}`,
        sponsorName: i % 3 === 0 ? "Brouwerij" : "Bank",
        actualSec: 10,
        expectedSec: 12,
      });
    }
    await seed(rows);

    const filters = plays.parseSponsorPlayFilters(params({}));
    const screenList = await plays.listSponsorPlays(
      prisma,
      filters,
      plays.sponsorPlayListLimit(params({})),
    );
    expect(screenList).toHaveLength(500);

    const totals = proofOfPlayTotals(await plays.summarizeSponsorPlays(prisma, filters));
    expect(totals.totalPlays).toBe(650);
    expect(totals.totalActualSec).toBe(6500);
    expect(totals.totalExpectedSec).toBe(7800);
    expect(totals.avgFulfillmentPercent).toBe(83);

    const exportList = await plays.listSponsorPlays(
      prisma,
      filters,
      plays.sponsorPlayListLimit(params({ all: "1" })),
    );
    expect(exportList).toHaveLength(650);

    const firstHalf = plays.parseSponsorPlayFilters(params({ segmentKey: "FIRST_HALF" }));
    expect(proofOfPlayTotals(await plays.summarizeSponsorPlays(prisma, firstHalf)).totalPlays).toBe(325);
  });

  it("keeps the list limit between 1 and 2000", () => {
    expect(plays.sponsorPlayListLimit(params({ limit: "0" }))).toBe(1);
    expect(plays.sponsorPlayListLimit(params({ limit: "99999" }))).toBe(2000);
    expect(plays.sponsorPlayListLimit(params({ limit: "abc" }))).toBe(500);
    expect(plays.sponsorPlayListLimit(params({ all: "1" }))).toBeUndefined();
  });
});
