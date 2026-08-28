/**
 * Sluit draaiende Stadium-builds op Windows zodat electron-builder
 * `dist/Stadium-Scoreboard.exe` (en oude namen) kan overschrijven.
 */
import { spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";

const EXE_NAMES = [
  "Stadium-Scoreboard.exe",
  "Stadium Scoreboard 0.1.0.exe",
  "Stadium Scoreboard.exe",
];

async function main() {
  if (process.platform !== "win32") return;

  for (const im of EXE_NAMES) {
    spawnSync("taskkill", ["/F", "/IM", im, "/T"], {
      stdio: "ignore",
      windowsHide: true,
    });
  }

  await setTimeout(400);
}

await main();
