/**
 * End-to-end wedstrijdfase-run via mobile bridge (echte Electron-desktop moet draaien).
 * Geen GUI-automation; stuurt commands + pollt sponsorLedger/snapshot.
 */
import fs from "node:fs";
import path from "node:path";

const cfg = {
  baseUrl: (process.env.E2E_BASE_URL ?? "http://127.0.0.1:17890").replace(/\/+$/, ""),
  pairingCode: (process.env.E2E_PAIRING_CODE ?? process.env.SOAK_PAIRING_CODE ?? "").trim(),
  operatorPin: (process.env.E2E_OPERATOR_PIN ?? process.env.SOAK_OPERATOR_PIN ?? "").trim(),
  prematchSec: Number(process.env.E2E_PREMATCH_SEC ?? "45"),
  firstHalfSec: Number(process.env.E2E_FIRST_HALF_SEC ?? "40"),
  halftimeSec: Number(process.env.E2E_HALFTIME_SEC ?? "25"),
  secondHalfSec: Number(process.env.E2E_SECOND_HALF_SEC ?? "40"),
  pollMs: Number(process.env.E2E_POLL_MS ?? "500"),
};

const startedAt = new Date();
const runId = startedAt.toISOString().replace(/[:.]/g, "-");
const outDir = path.join(process.cwd(), "soak-results", `full-match-${runId}`);
const reportPath = path.join(outDir, "report.md");
const summaryPath = path.join(outDir, "summary.json");
const eventsPath = path.join(outDir, "events.jsonl");

function log(level, event, data = {}) {
  const row = { t: new Date().toISOString(), level, event, ...data };
  fs.appendFileSync(eventsPath, `${JSON.stringify(row)}\n`, "utf8");
  console.log(`[${row.t}] ${level.toUpperCase()} ${event}`, data);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { ok: res.ok, status: res.status, payload };
}

async function cmd(token, command) {
  const r = await postJson(`${cfg.baseUrl}/mobile/command`, { command }, token);
  if (!r.ok || (r.payload && r.payload.ok === false)) {
    log("error", "command-failed", { command, status: r.status, payload: r.payload });
    return false;
  }
  log("info", "command-ok", { type: command.type, ...(command.status ? { status: command.status } : {}), ...(command.mode ? { mode: command.mode } : {}) });
  return true;
}

async function snapshot(token) {
  const r = await getJson(`${cfg.baseUrl}/mobile/snapshot`, token);
  return r.ok && r.payload && typeof r.payload === "object" ? r.payload : null;
}

async function patchKickoffFuture(token, matchId) {
  /** Kickoff ~6 min vooruit: venster (300s) loopt dan meteen. */
  const kickoffAt = new Date(Date.now() + 6 * 60 * 1000).toISOString();
  const r = await fetch(`${cfg.baseUrl}/mobile/api/matches/${matchId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ kickoffAt, status: "PREMATCH" }),
  });
  if (!r.ok) {
    log("warn", "kickoff-patch-failed", { status: r.status });
  } else {
    log("info", "kickoff-patched", { kickoffAt });
  }
}

async function pollPhase(token, label, durationSec, onTick) {
  const end = Date.now() + durationSec * 1000;
  while (Date.now() < end) {
    const snap = await snapshot(token);
    if (snap) onTick(snap);
    await sleep(cfg.pollMs);
  }
  log("info", "phase-done", { label, durationSec });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  if (!cfg.pairingCode || !cfg.operatorPin) {
    throw new Error("E2E_PAIRING_CODE en E2E_OPERATOR_PIN (of SOAK_*) zijn verplicht.");
  }

  const health = await getJson(`${cfg.baseUrl}/mobile/health`, null);
  if (!health.ok) throw new Error("Bridge niet bereikbaar — start Electron met MOBILE_BRIDGE_* env.");

  const auth = await postJson(
    `${cfg.baseUrl}/mobile/auth/session`,
    { pairingCode: cfg.pairingCode, role: "operator", operatorPin: cfg.operatorPin },
    null,
  );
  if (!auth.ok || !auth.payload?.sessionToken) throw new Error("Auth mislukt");
  const token = auth.payload.sessionToken;

  const matchesRes = await getJson(`${cfg.baseUrl}/mobile/api/matches`, token);
  const matches = Array.isArray(matchesRes.payload) ? matchesRes.payload : [];
  const match = matches.find((m) => m && !m.closedAt) ?? matches[0];
  if (!match?.id) {
    throw new Error("Geen wedstrijd in database — open Control, maak/activeer een match, of seed db.");
  }

  const issues = [];
  const prematchMediaIds = new Set();
  const firstHalfMediaIds = new Set();
  let prematchClipCount = 0;
  let firstHalfClipCount = 0;
  /** @type {string[]} */
  const phaseStatuses = [];

  await cmd(token, { type: "match:setActive", matchId: match.id });
  await patchKickoffFuture(token, match.id);
  await cmd(token, { type: "match:setStatus", status: "PREMATCH" });
  await cmd(token, { type: "display:setMode", mode: "SPONSOR_ROTATION" });
  await cmd(token, { type: "timer:set", seconds: 0 });

  let lastSession = "";
  await pollPhase(token, "PREMATCH", cfg.prematchSec, (snap) => {
    phaseStatuses.push(String(snap.matchStatus ?? ""));
    const ac = snap.sponsorLedger?.activeClip;
    if (ac?.mediaId) {
      if (ac.clipSessionId && ac.clipSessionId !== lastSession) {
        prematchClipCount += 1;
        lastSession = ac.clipSessionId;
      }
      prematchMediaIds.add(ac.mediaId);
    }
  });

  if (prematchMediaIds.size < 2) {
    issues.push(
      `Prematch: slechts ${prematchMediaIds.size} unieke media-id(s) gezien (${prematchClipCount} clip-starts). Verwacht rotatie over meerdere bestanden.`,
    );
  }

  lastSession = "";
  await cmd(token, { type: "match:setStatus", status: "FIRST_HALF" });
  await cmd(token, { type: "display:setMode", mode: "SPONSOR_ROTATION" });
  await cmd(token, { type: "timer:set", seconds: 0 });
  await cmd(token, { type: "timer:start" });

  await pollPhase(token, "FIRST_HALF", cfg.firstHalfSec, (snap) => {
    const ac = snap.sponsorLedger?.activeClip;
    if (ac?.mediaId) {
      if (ac.clipSessionId && ac.clipSessionId !== lastSession) {
        firstHalfClipCount += 1;
        lastSession = ac.clipSessionId;
      }
      firstHalfMediaIds.add(ac.mediaId);
    }
  });

  await cmd(token, { type: "timer:pause" });
  await cmd(token, { type: "match:setStatus", status: "HALF_TIME" });
  await cmd(token, { type: "display:setMode", mode: "SPONSOR_ROTATION" });

  await pollPhase(token, "HALF_TIME", cfg.halftimeSec, () => {});

  await cmd(token, { type: "match:setStatus", status: "SECOND_HALF" });
  await cmd(token, { type: "timer:set", seconds: 0 });
  await cmd(token, { type: "display:setMode", mode: "SPONSOR_ROTATION" });
  await cmd(token, { type: "timer:start" });
  await pollPhase(token, "SECOND_HALF", cfg.secondHalfSec, () => {});

  await cmd(token, { type: "timer:pause" });
  await cmd(token, { type: "match:setStatus", status: "FULL_TIME" });
  await cmd(token, { type: "display:setMode", mode: "FULLTIME" });
  await sleep(3000);
  await cmd(token, { type: "match:setStatus", status: "POST_MATCH" });
  await cmd(token, { type: "display:setMode", mode: "SPONSOR_ROTATION" });
  await sleep(2000);

  const finalSnap = await snapshot(token);
  const pass = issues.length === 0;

  const summary = {
    pass,
    matchId: match.id,
    matchLabel: `${match.homeTeam?.name ?? "?"} vs ${match.awayTeam?.name ?? "?"}`,
    prematch: {
      uniqueMediaIds: [...prematchMediaIds],
      clipStarts: prematchClipCount,
      durationSec: cfg.prematchSec,
    },
    firstHalf: {
      uniqueMediaIds: [...firstHalfMediaIds],
      clipStarts: firstHalfClipCount,
      durationSec: cfg.firstHalfSec,
    },
    final: {
      matchStatus: finalSnap?.matchStatus ?? null,
      displayMode: finalSnap?.displayMode ?? null,
    },
    issues,
  };

  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    reportPath,
    `# Full match E2E (${runId})

- **Match:** ${summary.matchLabel} (\`${match.id}\`)
- **Resultaat:** ${pass ? "PASS" : "FAIL"}

## Prematch (${cfg.prematchSec}s)
- Unieke media op ledger: ${prematchMediaIds.size} → \`${[...prematchMediaIds].join("`, `")}\`
- Clip-starts: ${prematchClipCount}

## 1e helft (${cfg.firstHalfSec}s)
- Unieke media: ${firstHalfMediaIds.size}
- Clip-starts: ${firstHalfClipCount}

## Fase-einde
- Status: ${summary.final.matchStatus}
- Display: ${summary.final.displayMode}

${issues.length ? `## Problemen\n${issues.map((i) => `- ${i}`).join("\n")}\n` : ""}
`,
    "utf8",
  );

  log("info", "finished", { pass, issues });
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
