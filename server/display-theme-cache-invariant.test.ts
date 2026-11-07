import { afterAll, beforeAll, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

/**
 * De indeling die het stadionscherm gepusht krijgt, komt uit het geheugen van het hoofdproces.
 * Dat is sneller en kan niet stilvallen, maar het introduceert één nieuw risico: loopt die kopie
 * uit de pas met SQLite, dan toont de wand iets anders dan er opgeslagen staat — en dat zou juist
 * de machines treffen waar alles al goed ging.
 *
 * Deze test hamert op alle paden die de indeling kunnen veranderen, door elkaar en afgewisseld met
 * ander verkeer, en controleert na élke stap dat het gepushte gelijk is aan wat in de database staat.
 */

let tmpDir: string;
let runtime: typeof import("../electron/runtime");
let prisma: PrismaClient;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arenacue-theme-cache-"));
  process.env.DATABASE_URL = `file:${path.join(tmpDir, "test.db").replace(/\\/g, "/")}?connection_limit=1`;
  runtime = await import("../electron/runtime");
  await runtime.initDesktopRuntime({
    getControlWindow: () => null,
    getDisplayWindow: () => null,
    getStreamWindow: () => null,
    log: () => {},
  });
  prisma = (await import("../lib/prisma")).prisma;
});

afterAll(async () => {
  runtime.disposeDesktopRuntime();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Wat er écht in SQLite staat. */
async function inDatabase(): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ scoreboardThemeJson: string | null }>>(
    `SELECT "scoreboardThemeJson" FROM "AppSettings" WHERE "id" = 1`,
  );
  return rows[0]?.scoreboardThemeJson ?? null;
}

/** Wat het stadionscherm gepusht krijgt. */
async function pushedToWall(): Promise<string | null | undefined> {
  const snap = (await runtime.getDisplaySnapshot()) as { scoreboardThemeJson?: string | null };
  return snap.scoreboardThemeJson;
}

const api = (method: string, path: string, body?: unknown) =>
  runtime.apiRequest({ method, path, bodyText: body === undefined ? undefined : JSON.stringify(body) });

it("houdt de gepushte indeling gelijk aan de database, door alle paden heen", async () => {
  const templateCreate = await api("POST", "/api/scoreboard-templates", {
    name: "Soak-indeling",
    themeJson: JSON.stringify({ layoutMode: "bottom-strip", elements: {} }),
  });
  expect(templateCreate.status).toBe(200);
  const templateId = (templateCreate.json as { id: string }).id;

  let checks = 0;
  for (let i = 0; i < 60; i++) {
    switch (i % 5) {
      case 0: // gewone opslag uit de editor
        expect((await api("PATCH", "/api/settings", {
          scoreboardThemeJson: JSON.stringify({ layoutMode: "custom", round: i, elements: { sponsor: [] } }),
        })).status).toBe(200);
        break;
      case 1: // terugzetten naar standaard
        expect((await api("PATCH", "/api/settings", { scoreboardThemeJson: null })).status).toBe(200);
        break;
      case 2: // een indeling uit de bibliotheek toepassen
        expect((await api("POST", `/api/scoreboard-templates/${templateId}/apply`, {})).status).toBe(200);
        break;
      case 3: // andere instelling: mag de indeling niet aanraken
        expect((await api("PATCH", "/api/settings", { displayCanvasWidth: 1920 - (i % 3) })).status).toBe(200);
        break;
      case 4: // ander verkeer door de runtime heen
        await runtime.runCommand({ type: "display:setMode", mode: i % 2 ? "IDLE" : "MATCH" } as never);
        break;
    }
    expect(await pushedToWall()).toBe(await inDatabase());
    checks++;
  }
  expect(checks).toBe(60);
});

it("blijft gelijk wanneer opslagen tegelijk binnenkomen", async () => {
  await Promise.all(
    Array.from({ length: 12 }, (_, n) =>
      api("PATCH", "/api/settings", {
        scoreboardThemeJson: JSON.stringify({ layoutMode: "custom", parallel: n, elements: {} }),
      }),
    ),
  );
  expect(await pushedToWall()).toBe(await inDatabase());
});
