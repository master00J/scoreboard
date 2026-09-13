/**
 * Startup-smoketest: start de gecompileerde Electron-app met een lege, tijdelijke userData-map en
 * controleert in boot.log dat de runtime volledig initialiseert ("Desktop runtime OK").
 *
 * Vangt precies de klasse fouten die unit-tests niet zien: schema-migraties, PRAGMA's, Prisma-engine,
 * preload/renderer-laadfouten. Draait vóór electron-builder in `electron:build:win`.
 *
 * Gebruik: node scripts/smoke-start.mjs [--exe <pad-naar-Stadium-Scoreboard.exe>]
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const exeIdx = args.indexOf("--exe");
const exePath = exeIdx >= 0 ? path.resolve(args[exeIdx + 1] ?? "") : null;
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 45_000);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "arenacue-smoke-"));
const bootLog = path.join(userData, "boot.log");

const env = {
  ...process.env,
  ARENACUE_USER_DATA_DIR: userData,
  MOBILE_BRIDGE_PORT: String(18000 + Math.floor(Math.random() * 1000)),
  MOBILE_BRIDGE_BIND: "127.0.0.1",
  STADIUM_SMOKE_TEST: "1",
};

let command;
let commandArgs;
if (exePath) {
  command = exePath;
  commandArgs = [];
} else {
  // Het `electron`-pakket exporteert (in Node) het pad naar de binary; geen .cmd-shim en dus geen
  // shell-quoting-problemen met spaties in het projectpad.
  command = require("electron");
  commandArgs = [root];
}

console.log(`[smoke] start ${exePath ? path.basename(exePath) : "electron ."} met userData ${userData}`);
const child = spawn(command, commandArgs, {
  cwd: root,
  env,
  stdio: "ignore",
  windowsHide: true,
  detached: false,
});

function readLog() {
  try {
    return fs.readFileSync(bootLog, "utf8");
  } catch {
    return "";
  }
}

function killTree() {
  try {
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      child.kill("SIGKILL");
    }
  } catch {
    /* ignore */
  }
}

const started = Date.now();
const timer = setInterval(() => {
  const log = readLog();
  const ok = /Desktop runtime OK/.test(log);
  const fatal = /FATAL:/.test(log);
  const exited = child.exitCode != null;
  if (ok || fatal || exited || Date.now() - started > timeoutMs) {
    clearInterval(timer);
    killTree();
    setTimeout(() => {
      const tail = log.split(/\r?\n/).filter(Boolean).slice(-12).join("\n");
      if (ok && !fatal) {
        console.log("[smoke] OK — runtime geïnitialiseerd\n" + tail);
        cleanup(0);
      } else {
        console.error(
          `[smoke] MISLUKT (${fatal ? "FATAL in boot.log" : exited ? `proces stopte met code ${child.exitCode}` : "timeout"})\n${tail || "(geen boot.log)"}`,
        );
        cleanup(1);
      }
    }, 1500);
  }
}, 500);

function cleanup(code) {
  setTimeout(() => {
    try {
      fs.rmSync(userData, { recursive: true, force: true });
    } catch {
      /* tijdelijke map mag blijven staan */
    }
    process.exit(code);
  }, 1500);
}
