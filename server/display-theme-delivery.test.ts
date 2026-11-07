import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * De weg die een opgeslagen schermindeling naar de wand aflegt.
 *
 * Een club zag haar proef ("Probeer op scherm") wél werken en haar opslag niet. De proef reist
 * mee op elke `display:state`; de opgeslagen indeling moest het hebben van een losse
 * `fetch("/api/settings")` die het stadionscherm zelf doet na een wissel van `updatedAt` — en
 * die fetch slikt zijn fout stil weg. Drie stappen die allemaal moeten lukken tegenover nul.
 *
 * Deze test legt vast dat de opgeslagen indeling nu op diezelfde korte route meekomt, zodat ze
 * de wand haalt zonder dat die fetch hoeft te lukken.
 */

let tmpDir: string;
let runtime: typeof import("../electron/runtime");

const CUSTOM = JSON.stringify({
  layoutMode: "custom",
  elements: { sponsor: [{ id: "score", x: 4, y: 6, w: 22, h: 30 }] },
});

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arenacue-theme-delivery-"));
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
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Precies wat de editor doet als je op Opslaan drukt. */
async function saveLayout(json: string | null): Promise<void> {
  const res = await runtime.apiRequest({
    method: "PATCH",
    path: "/api/settings",
    bodyText: JSON.stringify({ scoreboardThemeJson: json }),
  });
  expect(res.status).toBe(200);
}

/** Wat het stadionscherm binnenkrijgt op `display:state`, zonder ook maar één fetch. */
async function pushedToWall(): Promise<string | null | undefined> {
  const snapshot = (await runtime.getDisplaySnapshot()) as {
    scoreboardThemeJson?: string | null;
  };
  return snapshot.scoreboardThemeJson;
}

describe("opgeslagen schermindeling naar het stadionscherm", () => {
  it("reist mee op display:state, niet alleen via /api/settings", async () => {
    await saveLayout(CUSTOM);
    expect(await pushedToWall()).toBe(CUSTOM);
  });

  it("stuurt ook elke volgende wijziging mee", async () => {
    const strip = JSON.stringify({ layoutMode: "bottom-strip", elements: {} });
    await saveLayout(strip);
    expect(await pushedToWall()).toBe(strip);

    const back = JSON.stringify({ layoutMode: "left-l", elements: {} });
    await saveLayout(back);
    expect(await pushedToWall()).toBe(back);
  });

  it("neemt het leegmaken van de indeling mee in plaats van de oude te laten staan", async () => {
    await saveLayout(CUSTOM);
    expect(await pushedToWall()).toBe(CUSTOM);
    await saveLayout(null);
    expect(await pushedToWall()).toBeNull();
  });

  it("zet een indeling uit een template ook op het kanaal", async () => {
    await saveLayout(CUSTOM);
    const list = await runtime.apiRequest({ method: "GET", path: "/api/scoreboard-templates" });
    const templates = (list.json ?? []) as Array<{ id: string; name: string }>;
    expect(templates.length).toBeGreaterThan(0);
    const applied = await runtime.apiRequest({
      method: "POST",
      path: `/api/scoreboard-templates/${templates[0].id}/apply`,
      bodyText: "{}",
    });
    expect(applied.status).toBe(200);
    const expected = (applied.json as { scoreboardThemeJson: string }).scoreboardThemeJson;
    expect(await pushedToWall()).toBe(expected);
  });
});
