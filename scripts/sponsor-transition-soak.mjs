import fs from "node:fs";
import path from "node:path";

/**
 * Sponsor transition soak.
 *
 * Doel: de crash/flashing-klasse rond sponsorvideo-overgangen vangen.
 * Dit script monitort live `boot.log` op:
 * - Chromium media-player fouten (`error creating media player`, display-media error)
 * - GPU/renderer crashes
 * - watchdogs / never-started video
 * - snelle media-switch cascades binnen sponsor-budget rotatie
 *
 * Met SOAK_PAIRING_CODE + SOAK_OPERATOR_PIN probeert het de app ook in
 * FIRST_HALF + SPONSOR_ROTATION te zetten via de mobile bridge. Zonder credentials
 * werkt het als passieve monitor van de draaiende desktop-app.
 */

const cfg = {
  baseUrl: (process.env.SOAK_BASE_URL ?? "http://127.0.0.1:17890").replace(/\/+$/, ""),
  pairingCode: (process.env.SOAK_PAIRING_CODE ?? "").trim(),
  operatorPin: (process.env.SOAK_OPERATOR_PIN ?? "").trim(),
  durationMin: Number(process.env.SOAK_TRANSITION_DURATION_MIN ?? "10"),
  pollMs: Number(process.env.SOAK_TRANSITION_POLL_MS ?? "350"),
  rapidWindowMs: Number(process.env.SOAK_TRANSITION_RAPID_WINDOW_MS ?? "10_000".replace("_", "")),
  maxSwitchesPerWindow: Number(process.env.SOAK_TRANSITION_MAX_SWITCHES_PER_WINDOW ?? "3"),
  maxErrors: Number(process.env.SOAK_TRANSITION_MAX_ERRORS ?? "0"),
  requireMediaEvents: process.env.SOAK_TRANSITION_REQUIRE_MEDIA === "1",
  scanExisting: process.env.SOAK_TRANSITION_SCAN_EXISTING === "1",
  bootLogPath:
    process.env.SOAK_BOOT_LOG ??
    path.join(process.cwd(), "dist", "stadium-portable-data", "boot.log"),
};

const startedAt = new Date();
const runId = startedAt.toISOString().replace(/[:.]/g, "-");
const outDir = path.join(process.cwd(), "soak-results", `sponsor-transition-${runId}`);
const eventsPath = path.join(outDir, "events.jsonl");
const summaryPath = path.join(outDir, "summary.json");
const reportPath = path.join(outDir, "report.md");

function writeEvent(level, event, data = {}) {
  const row = { t: new Date().toISOString(), level, event, ...data };
  fs.appendFileSync(eventsPath, `${JSON.stringify(row)}\n`, "utf8");
  const msg = `[${row.t}] ${level.toUpperCase()} ${event}`;
  if (level === "error") console.error(msg, data);
  else if (level === "warn") console.warn(msg, data);
  else console.log(msg, data);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(url, body, token) {
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
  return { ok: res.ok, status: res.status, payload };
}

async function getJson(url, token) {
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { ok: res.ok, status: res.status, payload };
}

async function trySetupBridge() {
  if (!cfg.pairingCode || !cfg.operatorPin) {
    writeEvent("warn", "bridge-skip", {
      reason: "SOAK_PAIRING_CODE/SOAK_OPERATOR_PIN ontbreken; passieve log-monitoring.",
    });
    return null;
  }

  const health = await getJson(`${cfg.baseUrl}/mobile/health`, null);
  if (!health.ok) {
    writeEvent("warn", "bridge-health-failed", { status: health.status });
    return null;
  }

  const auth = await postJson(
    `${cfg.baseUrl}/mobile/auth/session`,
    { pairingCode: cfg.pairingCode, role: "operator", operatorPin: cfg.operatorPin },
    null,
  );
  if (!auth.ok || !auth.payload?.sessionToken) {
    writeEvent("warn", "bridge-auth-failed", { status: auth.status });
    return null;
  }

  const token = auth.payload.sessionToken;
  writeEvent("info", "bridge-auth-ok", {});

  for (const command of [
    { type: "match:setStatus", status: "FIRST_HALF" },
    { type: "timer:set", seconds: 0 },
    { type: "display:setMode", mode: "SPONSOR_ROTATION" },
    { type: "timer:start" },
  ]) {
    const res = await postJson(`${cfg.baseUrl}/mobile/command`, { command }, token);
    writeEvent(res.ok ? "info" : "warn", "bridge-command", {
      command: command.type,
      status: res.status,
      payloadOk: res.payload?.ok ?? null,
    });
  }

  return token;
}

function parseTimestamp(line) {
  const m = line.match(/^\[([^\]]+)\]/);
  if (!m) return Date.now();
  const t = Date.parse(m[1]);
  return Number.isFinite(t) ? t : Date.now();
}

function parseSponsorBudgetMediaEvent(line) {
  if (!line.includes("[display-media] src=sponsor-budget")) return null;
  const event = line.match(/\bevt=([^ ]+)/)?.[1] ?? "unknown";
  const mediaId = line.match(/\bid=([^ ]+)/)?.[1] ?? "";
  const title = line.match(/\btitle=(.*?)\s+file=/)?.[1] ?? "";
  const file = line.match(/\bfile=(.*?)(?:\s+(?:errCode|rs|ns|t|at)=|$)/)?.[1] ?? "";
  return {
    atMs: parseTimestamp(line),
    event,
    mediaId,
    title,
    file,
    line,
  };
}

function classifyProblem(line) {
  if (line.includes("error creating media player")) return "media-player-create-failed";
  if (line.includes("[display-media] src=sponsor-budget evt=error")) return "display-media-error";
  if (line.includes("child-process-gone GPU")) return "gpu-process-gone";
  if (line.includes("render-process-gone")) return "render-process-gone";
  if (line.includes("watchdog_")) return "video-watchdog";
  if (line.includes("ended_never_started_fault")) return "video-ended-never-started";
  if (line.includes("GPU-crash tijdens sponsorvideo")) return "sponsor-gpu-crash";
  return null;
}

function readNewLogLines(state) {
  if (!fs.existsSync(cfg.bootLogPath)) return [];
  const stat = fs.statSync(cfg.bootLogPath);
  if (stat.size < state.offset) {
    state.offset = 0;
    state.partial = "";
    writeEvent("warn", "boot-log-rotated", {});
  }
  if (stat.size === state.offset) return [];

  const fd = fs.openSync(cfg.bootLogPath, "r");
  try {
    const len = stat.size - state.offset;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, state.offset);
    state.offset = stat.size;
    const text = state.partial + buf.toString("utf8");
    const parts = text.split(/\r?\n/);
    state.partial = parts.pop() ?? "";
    return parts.filter(Boolean);
  } finally {
    fs.closeSync(fd);
  }
}

function renderReport(summary) {
  const problemLines = summary.problems
    .slice(0, 12)
    .map((p) => `- ${p.t} — ${p.kind}: \`${p.shortLine}\``)
    .join("\n");
  const rapidLines = summary.rapidSwitchWindows
    .slice(0, 12)
    .map((w) => `- ${w.t}: ${w.count} switches/${Math.round(cfg.rapidWindowMs / 1000)}s — ${w.media.join(" -> ")}`)
    .join("\n");

  return [
    "# Sponsor transition soak",
    "",
    `- Run: \`${runId}\``,
    `- Start: ${summary.startedAt}`,
    `- Einde: ${summary.endedAt}`,
    `- Resultaat: **${summary.pass ? "PASS" : "FAIL"}**`,
    `- Boot log: \`${cfg.bootLogPath}\``,
    "",
    "## Tellingen",
    "",
    `- Sponsor media-events: ${summary.counters.mediaEvents}`,
    `- Media switches: ${summary.counters.mediaSwitches}`,
    `- Problemen: ${summary.counters.problems}`,
    `- Rapid-switch windows: ${summary.counters.rapidSwitchWindows}`,
    "",
    "## Problemen",
    "",
    problemLines || "Geen harde media/GPU-problemen gevonden.",
    "",
    "## Snelle Switches",
    "",
    rapidLines || "Geen snelle switch-cascades gevonden.",
    "",
    "## Config",
    "",
    "```json",
    JSON.stringify(summary.config, null, 2),
    "```",
    "",
  ].join("\n");
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  writeEvent("info", "start", {
    config: {
      ...cfg,
      pairingCode: cfg.pairingCode ? "[set]" : "",
      operatorPin: cfg.operatorPin ? "[set]" : "",
    },
  });

  const token = await trySetupBridge();
  const initialSize =
    fs.existsSync(cfg.bootLogPath) && !cfg.scanExisting
      ? fs.statSync(cfg.bootLogPath).size
      : 0;
  const logState = { offset: initialSize, partial: "" };
  const deadline = Date.now() + Math.max(0.1, cfg.durationMin) * 60_000;

  let mediaEvents = 0;
  let mediaSwitches = 0;
  let lastMediaId = "";
  let lastSnapshotAt = 0;
  const problems = [];
  const rapidSwitchWindows = [];
  const switchHistory = [];
  const seenRapidKeys = new Set();

  while (Date.now() < deadline) {
    for (const line of readNewLogLines(logState)) {
      const problemKind = classifyProblem(line);
      if (problemKind) {
        const problem = {
          t: new Date(parseTimestamp(line)).toISOString(),
          kind: problemKind,
          shortLine: line.slice(0, 500),
        };
        problems.push(problem);
        writeEvent("error", "problem-detected", problem);
      }

      const mediaEvent = parseSponsorBudgetMediaEvent(line);
      if (!mediaEvent) continue;

      mediaEvents += 1;
      if (
        mediaEvent.mediaId &&
        mediaEvent.mediaId !== lastMediaId &&
        (mediaEvent.event === "waiting" || mediaEvent.event === "loaded_metadata")
      ) {
        mediaSwitches += 1;
        lastMediaId = mediaEvent.mediaId;
        const label = mediaEvent.title || mediaEvent.file || mediaEvent.mediaId;
        switchHistory.push({ atMs: mediaEvent.atMs, mediaId: mediaEvent.mediaId, label });
        while (switchHistory.length > 0 && switchHistory[0].atMs < mediaEvent.atMs - cfg.rapidWindowMs) {
          switchHistory.shift();
        }
        const uniqueMedia = [...new Set(switchHistory.map((x) => x.label))];
        if (switchHistory.length > cfg.maxSwitchesPerWindow && uniqueMedia.length > 1) {
          const key = `${switchHistory[0].atMs}-${switchHistory.at(-1).atMs}-${switchHistory.length}`;
          if (!seenRapidKeys.has(key)) {
            seenRapidKeys.add(key);
            const row = {
              t: new Date(mediaEvent.atMs).toISOString(),
              count: switchHistory.length,
              media: uniqueMedia.slice(0, 8),
            };
            rapidSwitchWindows.push(row);
            writeEvent("error", "rapid-switch-cascade", row);
          }
        }
      }
    }

    if (token && Date.now() - lastSnapshotAt > 5_000) {
      lastSnapshotAt = Date.now();
      const snap = await getJson(`${cfg.baseUrl}/mobile/snapshot`, token);
      if (snap.ok && snap.payload && typeof snap.payload === "object") {
        const ac = snap.payload.sponsorLedger?.activeClip ?? null;
        writeEvent("info", "snapshot", {
          displayMode: snap.payload.displayMode ?? null,
          matchStatus: snap.payload.matchStatus ?? null,
          activeSponsorId: ac?.sponsorId ?? null,
          activeMediaId: ac?.mediaId ?? null,
          expectedPlaySec: ac?.expectedPlaySec ?? null,
        });
      } else {
        writeEvent("warn", "snapshot-failed", { status: snap.status });
      }
    }

    await sleep(cfg.pollMs);
  }

  const noMediaFailure = cfg.requireMediaEvents && mediaEvents === 0;
  const pass =
    problems.length <= cfg.maxErrors &&
    rapidSwitchWindows.length === 0 &&
    !noMediaFailure;

  const summary = {
    runId,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    pass,
    noMediaFailure,
    counters: {
      mediaEvents,
      mediaSwitches,
      problems: problems.length,
      rapidSwitchWindows: rapidSwitchWindows.length,
    },
    problems,
    rapidSwitchWindows,
    config: {
      baseUrl: cfg.baseUrl,
      durationMin: cfg.durationMin,
      pollMs: cfg.pollMs,
      rapidWindowMs: cfg.rapidWindowMs,
      maxSwitchesPerWindow: cfg.maxSwitchesPerWindow,
      maxErrors: cfg.maxErrors,
      requireMediaEvents: cfg.requireMediaEvents,
      scanExisting: cfg.scanExisting,
      bootLogPath: cfg.bootLogPath,
      bridgeConfigured: !!(cfg.pairingCode && cfg.operatorPin),
    },
    artifacts: {
      events: eventsPath,
      summary: summaryPath,
      report: reportPath,
    },
  };

  if (noMediaFailure) {
    writeEvent("error", "no-media-events", {
      hint: "Geen nieuwe sponsor-budget media-events gezien. Zet de display in SPONSOR_ROTATION of run langer.",
    });
  }

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  fs.writeFileSync(reportPath, renderReport(summary), "utf8");
  writeEvent(pass ? "info" : "error", "done", {
    pass,
    mediaEvents,
    mediaSwitches,
    problems: problems.length,
    rapidSwitchWindows: rapidSwitchWindows.length,
    reportPath: path.relative(process.cwd(), reportPath),
  });

  if (!pass) process.exitCode = 1;
}

main().catch((err) => {
  fs.mkdirSync(outDir, { recursive: true });
  writeEvent("error", "fatal", { message: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
