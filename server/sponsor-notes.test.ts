import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Het seizoensplan bewaart per sponsor een notitie ("direct na sponsor X", "vanaf 20/09").
 * Een database van voor deze kolom moet ze bij het opstarten krijgen, zonder dat er iets verloren gaat.
 */

let tmpDir: string;
let runtime: typeof import("../electron/runtime");

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arenacue-sponsor-notes-"));
  process.env.DATABASE_URL = `file:${path.join(tmpDir, "test.db").replace(/\\/g, "/")}?connection_limit=1`;
  runtime = await import("../electron/runtime");
  await runtime.initDesktopRuntime({
    getControlWindow: () => null,
    getDisplayWindow: () => null,
    getStreamWindow: () => null,
    log: () => {},
  });
});

afterAll(async () => {
  runtime.disposeDesktopRuntime();
  await (await import("../lib/prisma")).prisma.$disconnect();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* Windows kan het bestand nog even vasthouden */
  }
});

async function api(method: string, p: string, body?: unknown) {
  const res = await runtime.apiRequest({
    method,
    path: p,
    bodyText: body === undefined ? undefined : JSON.stringify(body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: res.json as any };
}

describe("sponsornotitie", () => {
  it("bewaart de notitie bij aanmaken en bijwerken, en wist ze met null", async () => {
    const created = await api("POST", "/api/sponsors", {
      name: "Alpha",
      matchFirstHalfSeconds: 90,
      matchSecondHalfSeconds: 90,
      notes: "  direct na Beta  ",
    });
    expect(created.status).toBe(200);
    expect(created.body.notes).toBe("direct na Beta");
    expect(created.body.matchSeconds).toBe(180);

    const patched = await api("PATCH", `/api/sponsors/${created.body.id}`, { notes: "vanaf 20/09" });
    expect(patched.body.notes).toBe("vanaf 20/09");

    await api("PATCH", `/api/sponsors/${created.body.id}`, { notes: null });
    const list = await api("GET", "/api/sponsors");
    expect(list.body.find((s: { id: string }) => s.id === created.body.id).notes).toBeNull();
  });

  it("een database zonder de kolom krijgt ze bij het opstarten en houdt haar sponsors", async () => {
    const { prisma } = await import("../lib/prisma");
    await api("POST", "/api/sponsors", { name: "Oud", halftimeSeconds: 60 });
    await prisma.$executeRawUnsafe(`ALTER TABLE "Sponsor" DROP COLUMN "notes"`);
    const cols = (await prisma.$queryRawUnsafe(`PRAGMA table_info("Sponsor")`)) as { name: string }[];
    expect(cols.some((c) => c.name === "notes")).toBe(false);

    const { ensureSqliteSchema } = await import("./db-init");
    await ensureSqliteSchema();

    const after = (await prisma.$queryRawUnsafe(`PRAGMA table_info("Sponsor")`)) as { name: string }[];
    expect(after.some((c) => c.name === "notes")).toBe(true);
    const list = await api("GET", "/api/sponsors");
    const oud = list.body.find((s: { name: string }) => s.name === "Oud");
    expect(oud.halftimeSeconds).toBe(60);
    expect(oud.notes).toBeNull();
  });

  it("clubmedia uit het seizoensplan draait mee in de rotatie, met haar notitie voor de HUD", async () => {
    const created = await api("POST", "/api/media", {
      type: "IMAGE",
      path: "C:/club/free-your-seat.png",
      title: "Free Your Seat",
      durationSec: 15,
      clubPhaseBudgetJson: JSON.stringify({ prematch: 0, firstHalf: 0, halftime: 120, secondHalf: 0, postmatch: 0 }),
      notes: "na de opstelling",
    });
    expect(created.status).toBe(200);

    const rotation = await api("GET", "/api/sponsors?rotation=1");
    const club = rotation.body.find((s: { id: string }) => s.id === `club:${created.body.id}`);
    expect(club.rotationKind).toBe("club");
    expect(club.halftimeSeconds).toBe(120);
    expect(club.notes).toBe("na de opstelling");

    const plain = await api("GET", "/api/sponsors");
    expect(plain.body.some((s: { id: string }) => s.id === `club:${created.body.id}`)).toBe(false);

    await api("PATCH", `/api/media/${created.body.id}`, { clubPhaseBudgetJson: null });
    const after = await api("GET", "/api/sponsors?rotation=1");
    expect(after.body.some((s: { id: string }) => s.id === `club:${created.body.id}`)).toBe(false);
  });
});
