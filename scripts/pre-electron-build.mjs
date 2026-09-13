/**
 * Sluit draaiende Stadium-builds op Windows zodat electron-builder
 * `dist/Stadium-Scoreboard.exe` (en oude namen) kan overschrijven.
 */
import { spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { azureSigningReady, azureSigningConfig } from "./load-signing-env.mjs";

const EXE_NAMES = [
  "Stadium-Scoreboard.exe",
  "Stadium Scoreboard 0.1.0.exe",
  "Stadium Scoreboard.exe",
];

async function main() {
  if (azureSigningReady()) {
    const c = azureSigningConfig();
    console.log(`[signing] Azure Artifact Signing actief (${c.account} / ${c.profile} @ ${c.endpoint})`);
  } else {
    console.log("[signing] geen Azure-credentials — Windows-build blijft unsigned");
  }

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
