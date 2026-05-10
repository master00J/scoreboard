import fs from "node:fs";
import path from "node:path";

const cfg = {
  baseUrl: (process.env.SOAK_BASE_URL ?? "http://127.0.0.1:17890").replace(/\/+$/, ""),
  pairingCode: (process.env.SOAK_PAIRING_CODE ?? "").trim(),
  operatorPin: (process.env.SOAK_OPERATOR_PIN ?? "").trim(),
  pollMs: Number(process.env.SOAK_INTERRUPT_POLL_MS ?? "400"),
  dwellMs: Number(process.env.SOAK_INTERRUPT_DWELL_MS ?? "3500"),
  earlySlackSec: Number(process.env.SOAK_INTERRUPT_EARLY_SLACK_SEC ?? "2"),
  lateSlackSec: Number(process.env.SOAK_INTERRUPT_LATE_SLACK_SEC ?? "5"),
  dbPath: process.env.SOAK_SPONSOR_DB_PATH
    ? path.resolve(process.env.SOAK_SPONSOR_DB_PATH)
    : path.join(process.cwd(), "dist", "stadium-portable-data", "data", "stadium.db"),
  bootLogPath: process.env.SOAK_BOOT_LOG
    ? path.resolve(process.env.SOAK_BOOT_LOG)
    : path.join(process.cwd(), "dist", "stadium-portable-data", "boot.log"),
};

const startedAt = new Date();
const runId = startedAt.toISOString().replace(/[:.]/g, "-");
const outDir = path.join(process.cwd(), "soak-results", `sponsor-interrupt-${runId}`);
const eventsPath = path.join(outDir, "events.jsonl");
const scenariosPath = path.join(outDir, "scenarios.jsonl");
const summaryPath = path.join(outDir, "summary.json");
const reportPath = path.join(outDir, "report.md");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeEvent(level, event, data = {}) {
  const row = { t: new Date().toISOString(), level, event, ...data };
  fs.appendFileSync(eventsPath, `${JSON.stringify(row)}\n`, "utf8");
  const msg = `[${row.t}] ${level.toUpperCase()} ${event}`;
  if (level === "error") console.error(msg, data);
  else console.log(msg, data);
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

async function command(token, command) {
  const result = await postJson(`${cfg.baseUrl}/mobile/command`, { command }, token);
  writeEvent(result.ok ? "info" : "error", "command", {
    type: command.type,
    status: result.status,
    ok: result.payload?.ok ?? result.ok,
    error: result.payload?.error ?? null,
    warning: result.payload?.warning ?? null,
  });
  if (!result.ok || result.payload?.ok === false) {
    throw new Error(`Command failed: ${command.type} ${result.payload?.error ?? result.status}`);
  }
  return result;
}

function activeClipFromSnapshot(snapshot) {
  const p = snapshot && typeof snapshot === "object" ? snapshot : {};
  const ledger = p.sponsorLedger && typeof p.sponsorLedger === "object" ? p.sponsorLedger : null;
  const ac = ledger?.activeClip && typeof ledger.activeClip === "object" ? ledger.activeClip : null;
  if (!ac?.clipSessionId) return null;
  return {
    sponsorId: String(ac.sponsorId ?? ""),
    mediaId: String(ac.mediaId ?? ""),
    clipSessionId: String(ac.clipSessionId),
    startedAtMs: Number(ac.startedAtMs) || Date.now(),
    expectedPlaySec: Number(ac.expectedPlaySec) || 0,
    playbackPositionMs: Math.max(0, Number(ac.playbackPositionMs) || 0),
    paused: ac.paused === true,
  };
}

function activePlaybackSec(clip, nowMs = Date.now()) {
  const basePlaybackMs = Math.max(0, Number(clip.playbackPositionMs) || 0);
  if (clip.paused) return basePlaybackMs / 1000;
  const elapsedSinceStartMs = Math.max(0, nowMs - (Number(clip.startedAtMs) || nowMs));
  return Math.max(basePlaybackMs / 1000, elapsedSinceStartMs / 1000);
}

async function snapshot(token) {
  const snap = await getJson(`${cfg.baseUrl}/mobile/snapshot`, token);
  if (!snap.ok) throw new Error(`Snapshot failed: ${snap.status}`);
  return snap.payload;
}

async function waitForInterruptibleClip(token, label) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const snap = await snapshot(token);
    const ac = activeClipFromSnapshot(snap);
    if (ac && !ac.paused) {
      const posSec = activePlaybackSec(ac);
      const remaining = ac.expectedPlaySec - posSec;
      if (posSec >= 2 && remaining >= 6) {
        writeEvent("info", "interrupt-target", { label, ...ac, posSec, remaining });
        return ac;
      }
    }
    await sleep(cfg.pollMs);
  }
  throw new Error(`Geen interruptible sponsorclip gevonden voor ${label}`);
}

async function waitForSameClipPausedOrVisible(token, clip, label) {
  const deadline = Date.now() + 5_000;
  let sawSameClip = false;
  let last = null;
  while (Date.now() < deadline) {
    const ac = activeClipFromSnapshot(await snapshot(token));
    if (ac?.clipSessionId === clip.clipSessionId) {
      sawSameClip = true;
      last = ac;
      if (ac.paused) {
        writeEvent("info", "interrupt-ledger-still-active", { label, paused: true });
        return { activeClip: ac, pausedDuringInterrupt: true };
      }
    }
    await sleep(cfg.pollMs);
  }
  if (!sawSameClip) throw new Error(`Ledger verloor actieve clip tijdens interrupt: ${label}`);
  writeEvent("warn", "interrupt-ledger-not-paused", { label, paused: last?.paused ?? false });
  return { activeClip: last, pausedDuringInterrupt: false };
}

async function waitForClipCompletion(token, clip, label) {
  const deadline = Date.now() + Math.max(45_000, (clip.expectedPlaySec + cfg.dwellMs / 1000 + 20) * 1000);
  let maxPlaybackSec = activePlaybackSec(clip);
  while (Date.now() < deadline) {
    const ac = activeClipFromSnapshot(await snapshot(token));
    if (!ac || ac.clipSessionId !== clip.clipSessionId) {
      const observedSec = Math.round(maxPlaybackSec * 1000) / 1000;
      const pass =
        observedSec >= clip.expectedPlaySec - cfg.earlySlackSec &&
        observedSec <= clip.expectedPlaySec + cfg.lateSlackSec;
      return { observedSec, pass, endReason: ac ? "next-clip" : "ledger-cleared" };
    }
    maxPlaybackSec = Math.max(maxPlaybackSec, activePlaybackSec(ac));
    await sleep(cfg.pollMs);
  }
  throw new Error(`Clip eindigde niet na interrupt: ${label}`);
}

function playerLabel(player) {
  return `${player.number} ${player.firstName} ${player.lastName}`.trim();
}

async function seedSoakPlayers(prisma, match) {
  await prisma.player.deleteMany({ where: { firstName: { startsWith: "Soak" } } });
  const playersByTeam = {};
  for (const [side, teamId] of [
    ["home", match.homeTeamId],
    ["away", match.awayTeamId],
  ]) {
    const created = [];
    for (let i = 1; i <= 15; i += 1) {
      created.push(
        await prisma.player.create({
          data: {
            id: `soak_${runId}_${side}_${i}`.replace(/[^a-zA-Z0-9_]/g, "_"),
            teamId,
            number: i,
            firstName: "Soak",
            lastName: `${side}-${i}`,
          },
        }),
      );
    }
    playersByTeam[side] = created;
  }
  await prisma.match.update({
    where: { id: match.id },
    data: {
      homeFieldPlayerIdsJson: JSON.stringify(playersByTeam.home.slice(0, 11).map((p) => p.id)),
      awayFieldPlayerIdsJson: JSON.stringify(playersByTeam.away.slice(0, 11).map((p) => p.id)),
    },
  });
  return playersByTeam;
}

function makeScenarioPlans(playersByTeam) {
  const local = {
    homeField: playersByTeam.home.slice(0, 11),
    awayField: playersByTeam.away.slice(0, 11),
    homeBench: playersByTeam.home.slice(11),
    awayBench: playersByTeam.away.slice(11),
  };
  const takeSub = (side) => {
    const fieldKey = `${side}Field`;
    const benchKey = `${side}Bench`;
    const out = local[fieldKey].shift();
    const incoming = local[benchKey].shift();
    if (!out || !incoming) throw new Error(`Niet genoeg spelers voor wissel ${side}`);
    local[fieldKey].push(incoming);
    return { teamSide: side, playerOut: out, playerIn: incoming };
  };
  return [
    { kind: "goal", side: "home", scorer: local.homeField[0] },
    { kind: "card", side: "away", player: local.awayField[1], color: "YELLOW" },
    { kind: "sub", side: "home", ...takeSub("home") },
    { kind: "goal", side: "away", scorer: local.awayField[2] },
    { kind: "card", side: "home", player: local.homeField[3], color: "YELLOW" },
    { kind: "sub", side: "away", ...takeSub("away") },
  ];
}

function commandForScenario(plan, match) {
  if (plan.kind === "goal") {
    return { type: "goal:trigger", side: plan.side, scorerId: plan.scorer.id };
  }
  if (plan.kind === "card") {
    return {
      type: "card:trigger",
      teamId: plan.side === "home" ? match.homeTeamId : match.awayTeamId,
      playerId: plan.player.id,
      color: plan.color,
    };
  }
  return {
    type: "sub:trigger",
    teamId: plan.side === "home" ? match.homeTeamId : match.awayTeamId,
    playerOutId: plan.playerOut.id,
    playerInId: plan.playerIn.id,
  };
}

async function clearScenario(token, plan) {
  if (plan.kind === "goal") {
    await command(token, { type: "goal:cancel" });
  } else if (plan.kind === "sub") {
    await command(token, { type: "sub:queueAdvance" });
  } else {
    await command(token, { type: "display:setMode", mode: "SPONSOR_ROTATION" });
  }
}

async function runScenario(token, match, half, plan, index) {
  const label = `${half}-${index + 1}-${plan.kind}-${plan.side}`;
  const target = await waitForInterruptibleClip(token, label);
  const sent = commandForScenario(plan, match);
  await command(token, sent);
  const pauseState = await waitForSameClipPausedOrVisible(token, target, label);
  await sleep(cfg.dwellMs);
  await clearScenario(token, plan);
  const completion = await waitForClipCompletion(token, target, label);
  const pass = completion.pass && pauseState.pausedDuringInterrupt;
  const row = {
    label,
    half,
    kind: plan.kind,
    side: plan.side,
    player:
      plan.kind === "goal"
        ? playerLabel(plan.scorer)
        : plan.kind === "card"
          ? playerLabel(plan.player)
          : `${playerLabel(plan.playerOut)} -> ${playerLabel(plan.playerIn)}`,
    sponsorId: target.sponsorId,
    mediaId: target.mediaId,
    clipSessionId: target.clipSessionId,
    expectedSec: target.expectedPlaySec,
    pausedDuringInterrupt: pauseState.pausedDuringInterrupt,
    ...completion,
    pass,
  };
  fs.appendFileSync(scenariosPath, `${JSON.stringify(row)}\n`, "utf8");
  writeEvent(row.pass ? "info" : "error", "scenario-result", row);
  return row;
}

function scanBootProblems(startOffset) {
  if (!fs.existsSync(cfg.bootLogPath)) return [];
  const text = fs.readFileSync(cfg.bootLogPath, "utf8").slice(startOffset);
  return text
    .split(/\r?\n/)
    .filter((line) =>
      /render-process-gone|unresponsive|MEDIA_ELEMENT_ERROR|errCode=|watchdog_|rapid-switch/i.test(line),
    );
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  if (!cfg.pairingCode || !cfg.operatorPin) {
    throw new Error("SOAK_PAIRING_CODE en SOAK_OPERATOR_PIN zijn verplicht.");
  }
  const bootStartOffset = fs.existsSync(cfg.bootLogPath) ? fs.statSync(cfg.bootLogPath).size : 0;
  writeEvent("info", "start", { config: { ...cfg, pairingCode: "[set]", operatorPin: "[set]" } });

  const health = await getJson(`${cfg.baseUrl}/mobile/health`, null);
  if (!health.ok) throw new Error(`Healthcheck faalde (${health.status}).`);
  const auth = await postJson(
    `${cfg.baseUrl}/mobile/auth/session`,
    { pairingCode: cfg.pairingCode, role: "operator", operatorPin: cfg.operatorPin },
    null,
  );
  if (!auth.ok || !auth.payload?.sessionToken) throw new Error(`Auth mislukt (${auth.status})`);
  const token = auth.payload.sessionToken;

  process.env.DATABASE_URL = `file:${cfg.dbPath.replace(/\\/g, "/")}`;
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  const original = {};
  const results = [];
  try {
    const state = await prisma.displayState.findUnique({ where: { id: 1 } });
    if (!state?.matchId) throw new Error("Geen actieve wedstrijd.");
    const match = await prisma.match.findUnique({ where: { id: state.matchId } });
    if (!match) throw new Error("Actieve wedstrijd niet gevonden.");
    const sponsors = await prisma.sponsor.findMany();
    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
    original.displayState = state;
    original.match = match;
    original.settings = settings;
    original.sponsors = sponsors.map((s) => ({
      id: s.id,
      matchFirstHalfSeconds: s.matchFirstHalfSeconds,
      matchSecondHalfSeconds: s.matchSecondHalfSeconds,
      matchSeconds: s.matchSeconds,
    }));

    const playersByTeam = await seedSoakPlayers(prisma, match);
    if (settings) {
      await prisma.appSettings.update({
        where: { id: 1 },
        data: { goalVisualHomeEnabled: true, goalVisualAwayEnabled: true },
      });
    }
    for (const sponsor of sponsors) {
      const first = Math.max(0, sponsor.matchFirstHalfSeconds || sponsor.matchSeconds || 0);
      const second = Math.max(first, sponsor.matchSecondHalfSeconds || 0);
      await prisma.sponsor.update({
        where: { id: sponsor.id },
        data: { matchFirstHalfSeconds: first, matchSecondHalfSeconds: second },
      });
    }

    for (const half of ["FIRST_HALF", "SECOND_HALF"]) {
      await prisma.match.update({
        where: { id: match.id },
        data: {
          homeFieldPlayerIdsJson: JSON.stringify(playersByTeam.home.slice(0, 11).map((p) => p.id)),
          awayFieldPlayerIdsJson: JSON.stringify(playersByTeam.away.slice(0, 11).map((p) => p.id)),
        },
      });
      await command(token, { type: "match:setStatus", status: half });
      await command(token, { type: "timer:set", seconds: half === "FIRST_HALF" ? 0 : match.halfDurationSec });
      await command(token, { type: "display:setMode", mode: "SPONSOR_ROTATION" });
      await command(token, { type: "timer:start" });
      const plans = makeScenarioPlans(playersByTeam);
      for (let i = 0; i < plans.length; i += 1) {
        results.push(await runScenario(token, match, half, plans[i], i));
      }
    }
  } finally {
    if (original.sponsors) {
      for (const s of original.sponsors) {
        await prisma.sponsor.update({
          where: { id: s.id },
          data: {
            matchFirstHalfSeconds: s.matchFirstHalfSeconds,
            matchSecondHalfSeconds: s.matchSecondHalfSeconds,
            matchSeconds: s.matchSeconds,
          },
        });
      }
    }
    if (original.settings) {
      await prisma.appSettings.update({
        where: { id: 1 },
        data: {
          goalVisualHomeEnabled: original.settings.goalVisualHomeEnabled,
          goalVisualAwayEnabled: original.settings.goalVisualAwayEnabled,
        },
      });
    }
    if (original.match) {
      await prisma.match.update({
        where: { id: original.match.id },
        data: {
          status: original.match.status,
          homeScore: original.match.homeScore,
          awayScore: original.match.awayScore,
          homeFieldPlayerIdsJson: original.match.homeFieldPlayerIdsJson,
          awayFieldPlayerIdsJson: original.match.awayFieldPlayerIdsJson,
        },
      });
    }
    if (original.displayState) {
      await prisma.displayState.update({
        where: { id: 1 },
        data: {
          mode: original.displayState.mode,
          matchId: original.displayState.matchId,
          activePlayerId: null,
          activeSubOutId: null,
          activeSubInId: null,
          activeGoalScorerId: null,
          activeMediaId: null,
          substitutionQueueJson: "[]",
          timerRunning: original.displayState.timerRunning,
          timerStartedAt: original.displayState.timerStartedAt,
          timerBaseSec: original.displayState.timerBaseSec,
          addedTimeMinutes: original.displayState.addedTimeMinutes,
        },
      });
    }
    await prisma.player.deleteMany({ where: { firstName: { startsWith: "Soak" } } });
    await prisma.$disconnect();
  }

  const failures = results.filter((r) => !r.pass);
  const bootProblems = scanBootProblems(bootStartOffset);
  const pass = failures.length === 0 && bootProblems.length === 0 && results.length === 12;
  const summary = {
    runId,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    pass,
    scenariosTotal: results.length,
    scenariosFailed: failures.length,
    bootProblems: bootProblems.length,
    artifacts: { events: eventsPath, scenarios: scenariosPath, summary: summaryPath, report: reportPath },
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  fs.writeFileSync(
    reportPath,
    [
      "# Sponsor interruption soak",
      "",
      `- Run: \`${runId}\``,
      `- Scenario's: ${results.length}, gefaald: ${failures.length}`,
      `- Boot/media problemen: ${bootProblems.length}`,
      `- Pass: **${pass ? "ja" : "nee"}**`,
      "",
      "Getest per helft: 2 goals, 2 kaarten, 2 wissels tijdens actieve sponsorclips.",
      "",
      `- Artefacten: \`${outDir}\``,
    ].join("\n"),
    "utf8",
  );
  writeEvent("info", "done", { pass, scenariosTotal: results.length, scenariosFailed: failures.length, bootProblems: bootProblems.length });
  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
