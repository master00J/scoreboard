import fs from "node:fs";
import path from "node:path";

const cfg = {
  baseUrl: (process.env.SOAK_BASE_URL ?? "http://127.0.0.1:17890").replace(/\/+$/, ""),
  pairingCode: (process.env.SOAK_PAIRING_CODE ?? "").trim(),
  operatorPin: (process.env.SOAK_OPERATOR_PIN ?? "").trim(),
  durationMin: Number(process.env.SOAK_DURATION_MIN ?? "60"),
  commandIntervalMs: Number(process.env.SOAK_COMMAND_INTERVAL_MS ?? "1500"),
  snapshotIntervalMs: Number(process.env.SOAK_SNAPSHOT_INTERVAL_MS ?? "5000"),
  maxConsecutiveFailures: Number(process.env.SOAK_MAX_CONSECUTIVE_FAILURES ?? "10"),
  maxErrorRate: Number(process.env.SOAK_MAX_ERROR_RATE ?? "0.03"),
  maxP95Ms: Number(process.env.SOAK_MAX_P95_MS ?? "1500"),
};

const startedAt = new Date();
const runId = startedAt.toISOString().replace(/[:.]/g, "-");
const outDir = path.join(process.cwd(), "soak-results", runId);
const logPath = path.join(outDir, "events.jsonl");
const summaryPath = path.join(outDir, "summary.json");
const reportPath = path.join(outDir, "report.md");

/**
 * @param {string} level
 * @param {string} event
 * @param {Record<string, unknown>} data
 */
function writeEvent(level, event, data = {}) {
  const row = {
    t: new Date().toISOString(),
    level,
    event,
    ...data,
  };
  fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
  const msg = `[${row.t}] ${level.toUpperCase()} ${event}`;
  if (level === "error") console.error(msg, data);
  else console.log(msg, data);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(url, body, token) {
  const t0 = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { ok: res.ok, status: res.status, payload, latencyMs: Math.round(performance.now() - t0) };
}

async function getJson(url, token) {
  const t0 = performance.now();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { ok: res.ok, status: res.status, payload, latencyMs: Math.round(performance.now() - t0) };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function buildCommand(step) {
  const phase = step % 8;
  switch (phase) {
    case 0:
      return { type: "timer:start" };
    case 1:
      return { type: "timer:pause" };
    case 2:
      return { type: "timer:adjust", deltaSec: 1 };
    case 3:
      return { type: "match:setStatus", status: "FIRST_HALF" };
    case 4:
      return { type: "display:setMode", mode: "SPONSOR_ROTATION" };
    case 5:
      return { type: "display:setSafeMode", enabled: false };
    case 6:
      return { type: "display:blackout" };
    default:
      return { type: "display:requestSnapshot" };
  }
}

function redactConfigForReport() {
  return {
    baseUrl: cfg.baseUrl,
    durationMin: cfg.durationMin,
    commandIntervalMs: cfg.commandIntervalMs,
    snapshotIntervalMs: cfg.snapshotIntervalMs,
    maxConsecutiveFailures: cfg.maxConsecutiveFailures,
    maxErrorRate: cfg.maxErrorRate,
    maxP95Ms: cfg.maxP95Ms,
    pairingConfigured: cfg.pairingCode.length > 0,
    operatorPinConfigured: cfg.operatorPin.length > 0,
  };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  if (!cfg.pairingCode || !cfg.operatorPin) {
    throw new Error(
      "SOAK_PAIRING_CODE en SOAK_OPERATOR_PIN zijn verplicht. Start desktop met vaste MOBILE_BRIDGE_* waarden en exporteer ze.",
    );
  }

  writeEvent("info", "start", { config: redactConfigForReport() });

  const health = await getJson(`${cfg.baseUrl}/mobile/health`, null);
  if (!health.ok) {
    throw new Error(`Bridge healthcheck faalde (${health.status}). Draait de desktop + mobile bridge?`);
  }
  writeEvent("info", "health-ok", { latencyMs: health.latencyMs, status: health.status });

  const auth = await postJson(
    `${cfg.baseUrl}/mobile/auth/session`,
    { pairingCode: cfg.pairingCode, role: "operator", operatorPin: cfg.operatorPin },
    null,
  );
  if (!auth.ok || !auth.payload?.sessionToken) {
    throw new Error(`Auth mislukt (${auth.status}): ${JSON.stringify(auth.payload)}`);
  }
  const token = auth.payload.sessionToken;
  writeEvent("info", "auth-ok", { latencyMs: auth.latencyMs, expiresAt: auth.payload.expiresAt });

  const deadline = Date.now() + Math.max(1, cfg.durationMin) * 60_000;
  let nextCommandAt = Date.now();
  let nextSnapshotAt = Date.now();

  let step = 0;
  let commandsTotal = 0;
  let commandsFailed = 0;
  let snapshotsTotal = 0;
  let snapshotsFailed = 0;
  let consecutiveFailures = 0;
  let hardStopReason = "";
  /** @type {number[]} */
  const commandLat = [];
  /** @type {number[]} */
  const snapshotLat = [];

  while (Date.now() < deadline) {
    const now = Date.now();
    if (now >= nextCommandAt) {
      const command = buildCommand(step++);
      const res = await postJson(`${cfg.baseUrl}/mobile/command`, { command }, token);
      commandsTotal += 1;
      commandLat.push(res.latencyMs);
      if (!res.ok || (res.payload && typeof res.payload === "object" && res.payload.ok === false)) {
        commandsFailed += 1;
        consecutiveFailures += 1;
        writeEvent("error", "command-failed", {
          status: res.status,
          latencyMs: res.latencyMs,
          commandType: command.type,
          payload: res.payload,
        });
      } else {
        consecutiveFailures = 0;
      }
      nextCommandAt = now + cfg.commandIntervalMs;
    }

    if (now >= nextSnapshotAt) {
      const snap = await getJson(`${cfg.baseUrl}/mobile/snapshot`, token);
      snapshotsTotal += 1;
      snapshotLat.push(snap.latencyMs);
      if (!snap.ok) {
        snapshotsFailed += 1;
        consecutiveFailures += 1;
        writeEvent("error", "snapshot-failed", {
          status: snap.status,
          latencyMs: snap.latencyMs,
          payload: snap.payload,
        });
      } else {
        if (snap.payload && typeof snap.payload === "object") {
          const p = snap.payload;
          writeEvent("info", "snapshot-ok", {
            latencyMs: snap.latencyMs,
            timerElapsedSec:
              typeof p.timerElapsedSec === "number" ? Math.round(p.timerElapsedSec * 100) / 100 : null,
            mode: typeof p.displayMode === "string" ? p.displayMode : null,
            status: typeof p.matchStatus === "string" ? p.matchStatus : null,
          });
        }
        consecutiveFailures = 0;
      }
      nextSnapshotAt = now + cfg.snapshotIntervalMs;
    }

    if (consecutiveFailures >= cfg.maxConsecutiveFailures) {
      hardStopReason = `Te veel opeenvolgende fouten (${consecutiveFailures}).`;
      break;
    }

    await sleep(120);
  }

  const totalOps = commandsTotal + snapshotsTotal;
  const totalFailed = commandsFailed + snapshotsFailed;
  const errorRate = totalOps > 0 ? totalFailed / totalOps : 1;
  const p95Command = percentile(commandLat, 95);
  const p95Snapshot = percentile(snapshotLat, 95);
  const pass =
    !hardStopReason &&
    errorRate <= cfg.maxErrorRate &&
    p95Command <= cfg.maxP95Ms &&
    p95Snapshot <= cfg.maxP95Ms;

  const summary = {
    runId,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    pass,
    hardStopReason: hardStopReason || null,
    thresholds: {
      maxConsecutiveFailures: cfg.maxConsecutiveFailures,
      maxErrorRate: cfg.maxErrorRate,
      maxP95Ms: cfg.maxP95Ms,
    },
    counters: {
      commandsTotal,
      commandsFailed,
      snapshotsTotal,
      snapshotsFailed,
      totalOps,
      totalFailed,
      errorRate,
    },
    latencyMs: {
      command: {
        min: commandLat.length ? Math.min(...commandLat) : 0,
        p95: p95Command,
        max: commandLat.length ? Math.max(...commandLat) : 0,
      },
      snapshot: {
        min: snapshotLat.length ? Math.min(...snapshotLat) : 0,
        p95: p95Snapshot,
        max: snapshotLat.length ? Math.max(...snapshotLat) : 0,
      },
    },
    config: redactConfigForReport(),
    artifacts: {
      events: logPath,
      summary: summaryPath,
      report: reportPath,
    },
  };

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  const report = [
    "# ArenaCue soak test rapport",
    "",
    `- Run ID: \`${runId}\``,
    `- Start: ${summary.startedAt}`,
    `- Einde: ${summary.endedAt}`,
    `- Resultaat: **${pass ? "PASS" : "FAIL"}**`,
    ...(hardStopReason ? [`- Hard stop: ${hardStopReason}`] : []),
    "",
    "## Cijfers",
    "",
    `- Commands: ${commandsTotal} totaal, ${commandsFailed} gefaald`,
    `- Snapshots: ${snapshotsTotal} totaal, ${snapshotsFailed} gefaald`,
    `- Error rate: ${(errorRate * 100).toFixed(2)}% (max ${(cfg.maxErrorRate * 100).toFixed(2)}%)`,
    `- P95 command latency: ${p95Command} ms (max ${cfg.maxP95Ms} ms)`,
    `- P95 snapshot latency: ${p95Snapshot} ms (max ${cfg.maxP95Ms} ms)`,
    "",
    "## Artifacts",
    "",
    `- JSON events: \`${path.relative(process.cwd(), logPath)}\``,
    `- Summary: \`${path.relative(process.cwd(), summaryPath)}\``,
    "",
  ].join("\n");

  fs.writeFileSync(reportPath, report, "utf8");
  writeEvent(pass ? "info" : "error", "done", {
    pass,
    hardStopReason: hardStopReason || null,
    summaryPath: path.relative(process.cwd(), summaryPath),
    reportPath: path.relative(process.cwd(), reportPath),
  });

  if (!pass) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  fs.mkdirSync(outDir, { recursive: true });
  writeEvent("error", "fatal", { message: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});

