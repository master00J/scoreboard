/**
 * Full-circle wedstrijdtest via mobile bridge (echte Electron moet draaien).
 * Speelt PREMATCH → 1e helft (goal/kaart/wissel) → rust → 2e helft → einde,
 * met sponsorrotatie ertussen, en schrijft een rapport van wat faalde.
 */
import fs from "node:fs";
import path from "node:path";

const cfg = {
  baseUrl: (process.env.E2E_BASE_URL ?? "http://127.0.0.1:17890").replace(/\/+$/, ""),
  pairingCode: (process.env.E2E_PAIRING_CODE ?? process.env.SOAK_PAIRING_CODE ?? "888888").trim(),
  operatorPin: (process.env.E2E_OPERATOR_PIN ?? process.env.SOAK_OPERATOR_PIN ?? "888888").trim(),
  prematchSec: Number(process.env.E2E_PREMATCH_SEC ?? "22"),
  firstHalfSec: Number(process.env.E2E_FIRST_HALF_SEC ?? "55"),
  halftimeSec: Number(process.env.E2E_HALFTIME_SEC ?? "16"),
  secondHalfSec: Number(process.env.E2E_SECOND_HALF_SEC ?? "50"),
  postMatchSec: Number(process.env.E2E_POST_MATCH_SEC ?? "10"),
  pollMs: Number(process.env.E2E_POLL_MS ?? "400"),
  eventDwellMs: Number(process.env.E2E_EVENT_DWELL_MS ?? "3500"),
  modeWaitMs: Number(process.env.E2E_MODE_WAIT_MS ?? "4000"),
  bootLogPath: process.env.E2E_BOOT_LOG
    ? path.resolve(process.env.E2E_BOOT_LOG)
    : firstExisting([
        path.join(process.env.APPDATA ?? "", "stadium-scoreboard", "boot.log"),
        path.join(process.env.APPDATA ?? "", "Stadium Scoreboard", "boot.log"),
        path.join(process.cwd(), "dist", "stadium-portable-data", "boot.log"),
      ]),
};

const startedAt = new Date();
const runId = startedAt.toISOString().replace(/[:.]/g, "-");
const outDir = path.join(process.cwd(), "soak-results", `full-match-${runId}`);
const reportPath = path.join(outDir, "report.md");
const summaryPath = path.join(outDir, "summary.json");
const eventsPath = path.join(outDir, "events.jsonl");

function firstExisting(paths) {
  return paths.find((p) => p && fs.existsSync(p)) ?? paths[0];
}

function log(level, event, data = {}) {
  const row = { t: new Date().toISOString(), level, event, ...data };
  fs.appendFileSync(eventsPath, `${JSON.stringify(row)}\n`, "utf8");
  const line = `[${row.t}] ${level.toUpperCase()} ${event}`;
  if (level === "error") console.error(line, data);
  else console.log(line, data);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function playerLabel(p) {
  if (!p) return "?";
  return `${p.number ?? "?"} ${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
}

function displayMode(snap) {
  return snap?.mode ?? snap?.displayMode ?? null;
}

function activeClip(snap) {
  const ac = snap?.sponsorLedger?.activeClip;
  if (!ac?.clipSessionId && !ac?.mediaId) return null;
  return ac;
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

async function patchJson(url, body, token) {
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
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

async function cmd(token, command) {
  const r = await postJson(`${cfg.baseUrl}/mobile/command`, { command }, token);
  if (!r.ok || (r.payload && r.payload.ok === false)) {
    log("error", "command-failed", { command, status: r.status, payload: r.payload });
    return { ok: false, payload: r.payload, status: r.status };
  }
  if (r.payload?.warning) {
    log("warn", "command-warning", { type: command.type, warning: r.payload.warning });
  } else {
    log("info", "command-ok", { type: command.type });
  }
  return { ok: true, payload: r.payload };
}

async function snapshot(token) {
  const r = await getJson(`${cfg.baseUrl}/mobile/snapshot`, token);
  return r.ok && r.payload && typeof r.payload === "object" ? r.payload : null;
}

async function getMatch(token, matchId) {
  const r = await getJson(`${cfg.baseUrl}/mobile/api/matches/${matchId}`, token);
  return r.ok && r.payload && typeof r.payload === "object" ? r.payload : null;
}

async function waitForMode(token, expected, timeoutMs, label) {
  const wanted = Array.isArray(expected) ? expected : [expected];
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const snap = await snapshot(token);
    last = displayMode(snap);
    if (wanted.includes(last)) {
      return { ok: true, mode: last, snap };
    }
    await sleep(cfg.pollMs);
  }
  return { ok: false, mode: last, snap: null, label, expected: wanted };
}

function trackSponsors(tracker, snap) {
  const ac = activeClip(snap);
  if (!ac?.mediaId) return;
  tracker.mediaIds.add(ac.mediaId);
  if (ac.clipSessionId && ac.clipSessionId !== tracker.lastSession) {
    tracker.clipStarts += 1;
    tracker.lastSession = ac.clipSessionId;
  }
  if (ac.paused) tracker.sawPaused = true;
}

function emptySponsorTracker() {
  return { mediaIds: new Set(), clipStarts: 0, lastSession: "", sawPaused: false };
}

async function pollUntil(durationSec, fn) {
  const end = Date.now() + durationSec * 1000;
  while (Date.now() < end) {
    await fn();
    await sleep(cfg.pollMs);
  }
}

function scanBootProblems(startOffset) {
  if (!cfg.bootLogPath || !fs.existsSync(cfg.bootLogPath)) return [];
  const text = fs.readFileSync(cfg.bootLogPath, "utf8").slice(startOffset);
  return text
    .split(/\r?\n/)
    .filter((line) =>
      /render-process-gone|unresponsive|MEDIA_ELEMENT_ERROR|errCode=|watchdog_|rapid-switch|Unhandled|TypeError|Error:/i.test(
        line,
      ),
    );
}

async function ensurePlayers(token, teamId, existing, prefix) {
  const list = [...(existing ?? [])].filter((p) => !p.isCoach);
  let n = list.length;
  while (n < 13) {
    n += 1;
    const r = await postJson(
      `${cfg.baseUrl}/mobile/api/players`,
      {
        teamId,
        number: 80 + n,
        firstName: "E2E",
        lastName: `${prefix}-${n}`,
      },
      token,
    );
    if (!r.ok || !r.payload?.id) {
      log("warn", "player-create-failed", { teamId, status: r.status, payload: r.payload });
      break;
    }
    list.push(r.payload);
  }
  return list;
}

async function prepareRoster(token, match) {
  const detail = await getMatch(token, match.id);
  if (!detail) throw new Error("Matchdetail niet geladen");
  const homePlayers = await ensurePlayers(token, detail.homeTeamId, detail.homeTeam?.players, "home");
  const awayPlayers = await ensurePlayers(token, detail.awayTeamId, detail.awayTeam?.players, "away");
  const homeField = homePlayers.slice(0, Math.min(11, homePlayers.length)).map((p) => p.id);
  const awayField = awayPlayers.slice(0, Math.min(11, awayPlayers.length)).map((p) => p.id);
  const patch = await patchJson(
    `${cfg.baseUrl}/mobile/api/matches/${match.id}`,
    { homeFieldPlayerIds: homeField, awayFieldPlayerIds: awayField, homeScore: 0, awayScore: 0 },
    token,
  );
  if (!patch.ok) {
    log("warn", "lineup-patch-failed", { status: patch.status, payload: patch.payload });
  }
  const refreshed = (await getMatch(token, match.id)) ?? detail;
  return {
    match: refreshed,
    home: {
      field: homePlayers.slice(0, homeField.length),
      bench: homePlayers.slice(homeField.length),
    },
    away: {
      field: awayPlayers.slice(0, awayField.length),
      bench: awayPlayers.slice(awayField.length),
    },
  };
}

async function fireMoment(token, plan, issues, observations) {
  const before = await snapshot(token);
  const beforeMode = displayMode(before);
  const beforeClip = activeClip(before);
  const sent = await cmd(token, plan.command);
  if (!sent.ok) {
    issues.push(`${plan.label}: command faalde (${sent.status ?? "?"} ${sent.payload?.error ?? ""})`.trim());
    observations.push({ ...plan.meta, ok: false, error: "command-failed" });
    return { ok: false };
  }
  const modeResult = await waitForMode(token, plan.expectModes, cfg.modeWaitMs, plan.label);
  if (!modeResult.ok) {
    if (plan.optionalMode) {
      log("warn", "moment-mode-optional-miss", {
        label: plan.label,
        expected: plan.expectModes,
        got: modeResult.mode,
      });
    } else {
      issues.push(
        `${plan.label}: display-modus werd ${modeResult.mode ?? "null"}, verwacht ${plan.expectModes.join(" of ")}.`,
      );
    }
  } else {
    log("info", "moment-mode-ok", { label: plan.label, mode: modeResult.mode });
  }
  const visualInterrupt = modeResult.ok && modeResult.mode !== "SPONSOR_ROTATION" && modeResult.mode !== "SPONSOR";
  let duringClip = activeClip(modeResult.snap);
  let sessionKept = Boolean(
    beforeClip && duringClip && beforeClip.clipSessionId === duringClip.clipSessionId,
  );
  let sponsorPaused = Boolean(sessionKept && duringClip?.paused);
  const pauseDeadline = Date.now() + 1500;
  while (visualInterrupt && beforeClip && Date.now() < pauseDeadline && !sponsorPaused) {
    const mid = await snapshot(token);
    duringClip = activeClip(mid);
    sessionKept = Boolean(
      beforeClip && duringClip && beforeClip.clipSessionId === duringClip.clipSessionId,
    );
    sponsorPaused = Boolean(sessionKept && duringClip?.paused);
    if (sponsorPaused) break;
    await sleep(cfg.pollMs);
  }
  await sleep(cfg.eventDwellMs);
  if (plan.clearCommand) {
    const cleared = await cmd(token, plan.clearCommand);
    if (!cleared.ok) {
      issues.push(`${plan.label}: wissen faalde`);
    }
  }
  const resume = await waitForMode(token, ["SPONSOR_ROTATION", "SPONSOR", "MATCH"], cfg.modeWaitMs, `${plan.label}-resume`);
  if (visualInterrupt && beforeClip && !sessionKept) {
    issues.push(`${plan.label}: sponsorclip-sessie verdween i.p.v. te pauzeren.`);
  } else if (visualInterrupt && beforeClip && sessionKept && !sponsorPaused) {
    issues.push(`${plan.label}: zelfde clip-sessie bleef staan maar paused werd niet true.`);
  }
  observations.push({
    ...plan.meta,
    ok: sent.ok && (modeResult.ok || plan.optionalMode),
    beforeMode,
    afterMode: modeResult.mode,
    resumeMode: resume.mode,
    sponsorSessionKept: sessionKept,
    sponsorPaused,
    warning: sent.payload?.warning ?? null,
  });
  return { ok: modeResult.ok || plan.optionalMode };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  if (!cfg.pairingCode || !cfg.operatorPin) {
    throw new Error("E2E_PAIRING_CODE en E2E_OPERATOR_PIN (of SOAK_*) zijn verplicht.");
  }

  const bootOffset = cfg.bootLogPath && fs.existsSync(cfg.bootLogPath) ? fs.statSync(cfg.bootLogPath).size : 0;

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
  const template = matches.find((m) => m && !m.closedAt) ?? matches[0];
  const teamsRes = await getJson(`${cfg.baseUrl}/mobile/api/teams`, token);
  const teams = Array.isArray(teamsRes.payload) ? teamsRes.payload : [];
  const homeTeamId = template?.homeTeamId ?? teams.find((t) => /rafc/i.test(t.name ?? ""))?.id ?? teams[0]?.id;
  const awayTeamId =
    template?.awayTeamId ??
    teams.find((t) => t.id !== homeTeamId && /beerschot/i.test(t.name ?? ""))?.id ??
    teams.find((t) => t.id !== homeTeamId)?.id;
  if (!homeTeamId || !awayTeamId) {
    throw new Error("Geen teams om een nieuwe wedstrijd te maken.");
  }
  const created = await postJson(
    `${cfg.baseUrl}/mobile/api/matches`,
    {
      homeTeamId,
      awayTeamId,
      sport: template?.sport ?? "FOOTBALL",
      halfDurationSec: template?.halfDurationSec ?? 2700,
      halfBreakSec: template?.halfBreakSec ?? 900,
    },
    token,
  );
  if (!created.ok || !created.payload?.id) {
    throw new Error(`Nieuwe wedstrijd aanmaken mislukt (${created.status}).`);
  }
  log("info", "fresh-match", {
    matchId: created.payload.id,
    label: `${created.payload.homeTeam?.name ?? "?"} vs ${created.payload.awayTeam?.name ?? "?"}`,
  });
  await cmd(token, { type: "match:setActive", matchId: created.payload.id });
  if (template?.id && template.id !== created.payload.id && !template.closedAt) {
    await patchJson(
      `${cfg.baseUrl}/mobile/api/matches/${template.id}`,
      { closedAt: new Date().toISOString() },
      token,
    );
  }

  const roster = await prepareRoster(token, created.payload);
  const match = roster.match;
  const eventsSince = new Date().toISOString();
  const settingsRes = await getJson(`${cfg.baseUrl}/mobile/api/settings`, token);
  const settings = settingsRes.payload && typeof settingsRes.payload === "object" ? settingsRes.payload : {};
  const awayGoalVisual = settings.goalVisualAwayEnabled !== false;

  const issues = [];
  const observations = [];
  const prematch = emptySponsorTracker();
  const firstHalf = emptySponsorTracker();
  const halfTime = emptySponsorTracker();
  const secondHalf = emptySponsorTracker();
  const postMatch = emptySponsorTracker();

  await cmd(token, { type: "match:setActive", matchId: match.id });
  const kickoffAt = new Date(Date.now() + 6 * 60 * 1000).toISOString();
  const kickoff = await patchJson(
    `${cfg.baseUrl}/mobile/api/matches/${match.id}`,
    { kickoffAt, status: "PREMATCH" },
    token,
  );
  if (!kickoff.ok) issues.push(`Kickoff/PREMATCH patch faalde (${kickoff.status}).`);
  await cmd(token, { type: "score:set", homeScore: 0, awayScore: 0 });
  await cmd(token, { type: "match:setStatus", status: "PREMATCH" });
  await cmd(token, { type: "display:setMode", mode: "SPONSOR_ROTATION" });
  await cmd(token, { type: "timer:set", seconds: 0 });

  log("info", "phase-start", { label: "PREMATCH" });
  await pollUntil(cfg.prematchSec, async () => {
    const snap = await snapshot(token);
    if (snap) trackSponsors(prematch, snap);
  });
  if (prematch.mediaIds.size < 1) {
    issues.push("Prematch: geen sponsorclip op de ledger gezien.");
  }

  await cmd(token, { type: "match:setStatus", status: "FIRST_HALF" });
  await cmd(token, { type: "display:setMode", mode: "SPONSOR_ROTATION" });
  await cmd(token, { type: "timer:set", seconds: 0 });
  await cmd(token, { type: "timer:start" });
  log("info", "phase-start", { label: "FIRST_HALF" });

  await pollUntil(6, async () => {
    const snap = await snapshot(token);
    if (snap) trackSponsors(firstHalf, snap);
  });

  const homeScorer = roster.home.field[0];
  const awayYellow = roster.away.field[1] ?? roster.away.field[0];
  const homeOut = roster.home.field[2] ?? roster.home.field[0];
  const homeIn = roster.home.bench[0];
  if (!homeScorer || !awayYellow) issues.push("1e helft: te weinig veldspelers voor goal/kaart.");
  if (!homeIn) issues.push("1e helft: geen wisselspeler op de bank (thuis).");

  if (homeScorer) {
    await fireMoment(
      token,
      {
        label: "1e helft doelpunt thuis",
        expectModes: ["GOAL", "GOAL_PLAYER_VIDEO", "GOAL_INTRO_VIDEO"],
        command: { type: "goal:trigger", side: "home", scorerId: homeScorer.id },
        clearCommand: { type: "goal:cancel" },
        meta: { phase: "FIRST_HALF", kind: "goal", side: "home", player: playerLabel(homeScorer) },
      },
      issues,
      observations,
    );
  }

  await pollUntil(4, async () => {
    const snap = await snapshot(token);
    if (snap) trackSponsors(firstHalf, snap);
  });

  if (awayYellow) {
    await fireMoment(
      token,
      {
        label: "1e helft gele kaart uit",
        expectModes: ["CARD"],
        command: {
          type: "card:trigger",
          teamId: match.awayTeamId,
          playerId: awayYellow.id,
          color: "YELLOW",
        },
        clearCommand: { type: "display:setMode", mode: "SPONSOR_ROTATION" },
        meta: { phase: "FIRST_HALF", kind: "card", color: "YELLOW", side: "away", player: playerLabel(awayYellow) },
      },
      issues,
      observations,
    );
  }

  await pollUntil(4, async () => {
    const snap = await snapshot(token);
    if (snap) trackSponsors(firstHalf, snap);
  });

  if (homeOut && homeIn) {
    await fireMoment(
      token,
      {
        label: "1e helft wissel thuis",
        expectModes: ["SUBSTITUTION"],
        command: {
          type: "sub:trigger",
          teamId: match.homeTeamId,
          playerOutId: homeOut.id,
          playerInId: homeIn.id,
        },
        clearCommand: { type: "sub:queueAdvance" },
        meta: {
          phase: "FIRST_HALF",
          kind: "sub",
          side: "home",
          player: `${playerLabel(homeOut)} → ${playerLabel(homeIn)}`,
        },
      },
      issues,
      observations,
    );
  }

  await pollUntil(6, async () => {
    const snap = await snapshot(token);
    if (snap) trackSponsors(firstHalf, snap);
  });

  await cmd(token, { type: "timer:pause" });
  await cmd(token, { type: "match:setStatus", status: "HALF_TIME" });
  await cmd(token, { type: "display:setMode", mode: "SPONSOR_ROTATION" });
  log("info", "phase-start", { label: "HALF_TIME" });
  await pollUntil(cfg.halftimeSec, async () => {
    const snap = await snapshot(token);
    if (snap) trackSponsors(halfTime, snap);
  });
  if (halfTime.mediaIds.size < 1) {
    issues.push("Rust: geen sponsorclip op de ledger gezien.");
  }

  await cmd(token, { type: "match:setStatus", status: "SECOND_HALF" });
  await cmd(token, { type: "timer:set", seconds: 0 });
  await cmd(token, { type: "display:setMode", mode: "SPONSOR_ROTATION" });
  await cmd(token, { type: "timer:start" });
  log("info", "phase-start", { label: "SECOND_HALF" });

  await pollUntil(6, async () => {
    const snap = await snapshot(token);
    if (snap) trackSponsors(secondHalf, snap);
  });

  const awayScorer = roster.away.field[2] ?? roster.away.field[0];
  const homeRed = roster.home.field[3] ?? roster.home.field[1] ?? roster.home.field[0];
  const awayOut = roster.away.field[4] ?? roster.away.field[0];
  const awayIn = roster.away.bench[0];

  if (awayScorer) {
    await fireMoment(
      token,
      {
        label: "2e helft doelpunt uit",
        expectModes: ["GOAL", "GOAL_PLAYER_VIDEO", "GOAL_INTRO_VIDEO"],
        optionalMode: !awayGoalVisual,
        command: { type: "goal:trigger", side: "away", scorerId: awayScorer.id },
        clearCommand: { type: "goal:cancel" },
        meta: {
          phase: "SECOND_HALF",
          kind: "goal",
          side: "away",
          player: playerLabel(awayScorer),
          visualExpected: awayGoalVisual,
        },
      },
      issues,
      observations,
    );
    if (!awayGoalVisual) {
      observations[observations.length - 1].note =
        "Uit-doelpuntvisual staat uit (goalVisualAwayEnabled=false): score telt, geen GOAL-scherm verwacht.";
    }
  }

  await pollUntil(4, async () => {
    const snap = await snapshot(token);
    if (snap) trackSponsors(secondHalf, snap);
  });

  if (homeRed) {
    await fireMoment(
      token,
      {
        label: "2e helft rode kaart thuis",
        expectModes: ["CARD"],
        command: {
          type: "card:trigger",
          teamId: match.homeTeamId,
          playerId: homeRed.id,
          color: "RED",
        },
        clearCommand: { type: "display:setMode", mode: "SPONSOR_ROTATION" },
        meta: { phase: "SECOND_HALF", kind: "card", color: "RED", side: "home", player: playerLabel(homeRed) },
      },
      issues,
      observations,
    );
  }

  await pollUntil(4, async () => {
    const snap = await snapshot(token);
    if (snap) trackSponsors(secondHalf, snap);
  });

  if (awayOut && awayIn) {
    await fireMoment(
      token,
      {
        label: "2e helft wissel uit",
        expectModes: ["SUBSTITUTION"],
        command: {
          type: "sub:trigger",
          teamId: match.awayTeamId,
          playerOutId: awayOut.id,
          playerInId: awayIn.id,
        },
        clearCommand: { type: "sub:queueAdvance" },
        meta: {
          phase: "SECOND_HALF",
          kind: "sub",
          side: "away",
          player: `${playerLabel(awayOut)} → ${playerLabel(awayIn)}`,
        },
      },
      issues,
      observations,
    );
  } else {
    issues.push("2e helft: geen wisselspeler op de bank (uit).");
  }

  await pollUntil(6, async () => {
    const snap = await snapshot(token);
    if (snap) trackSponsors(secondHalf, snap);
  });

  await cmd(token, { type: "timer:pause" });
  await cmd(token, { type: "match:setStatus", status: "FULL_TIME" });
  await cmd(token, { type: "display:setMode", mode: "FULLTIME" });
  const ft = await waitForMode(token, ["FULLTIME"], cfg.modeWaitMs, "FULLTIME");
  if (!ft.ok) issues.push(`Einde: display-modus werd ${ft.mode ?? "null"}, verwacht FULLTIME.`);
  await sleep(2500);
  await cmd(token, { type: "match:setStatus", status: "POST_MATCH" });
  await cmd(token, { type: "display:setMode", mode: "SPONSOR_ROTATION" });
  log("info", "phase-start", { label: "POST_MATCH" });
  await pollUntil(cfg.postMatchSec, async () => {
    const snap = await snapshot(token);
    if (snap) trackSponsors(postMatch, snap);
  });

  const finalSnap = await snapshot(token);
  const finalMatch = await getMatch(token, match.id);
  const matchEvents = (Array.isArray(finalMatch?.events) ? finalMatch.events : []).filter(
    (e) => !e.createdAt || e.createdAt >= eventsSince,
  );
  const eventTypes = matchEvents.map((e) => e.type);
  const expectEvent = (type, min) => {
    const n = eventTypes.filter((t) => t === type).length;
    if (n < min) issues.push(`Eventlog: ${n}× ${type}, verwacht minstens ${min}.`);
    return n;
  };
  const counts = {
    GOAL: expectEvent("GOAL", 2),
    CARD_YELLOW: expectEvent("CARD_YELLOW", 1),
    CARD_RED: expectEvent("CARD_RED", 1),
    SUB: expectEvent("SUB", 2),
  };

  if ((finalMatch?.homeScore ?? -1) < 1) issues.push(`Score thuis is ${finalMatch?.homeScore ?? "?"}, verwacht ≥ 1.`);
  if ((finalMatch?.awayScore ?? -1) < 1) issues.push(`Score uit is ${finalMatch?.awayScore ?? "?"}, verwacht ≥ 1.`);
  if (finalMatch?.status && !["POST_MATCH", "FULL_TIME"].includes(finalMatch.status)) {
    issues.push(`Eindstatus is ${finalMatch.status}, verwacht POST_MATCH of FULL_TIME.`);
  }
  if (firstHalf.mediaIds.size < 1) issues.push("1e helft: geen sponsorclip op de ledger gezien.");
  if (secondHalf.mediaIds.size < 1) issues.push("2e helft: geen sponsorclip op de ledger gezien.");

  const bootProblems = scanBootProblems(bootOffset);
  if (bootProblems.length) {
    issues.push(`${bootProblems.length} verdachte boot.log-regel(s) tijdens de run.`);
  }

  const pass = issues.length === 0;
  const summary = {
    pass,
    runId,
    matchId: match.id,
    matchLabel: `${match.homeTeam?.name ?? "?"} vs ${match.awayTeam?.name ?? "?"}`,
    final: {
      matchStatus: finalMatch?.status ?? null,
      displayMode: displayMode(finalSnap),
      homeScore: finalMatch?.homeScore ?? null,
      awayScore: finalMatch?.awayScore ?? null,
    },
    sponsors: {
      prematch: { unique: prematch.mediaIds.size, clipStarts: prematch.clipStarts },
      firstHalf: { unique: firstHalf.mediaIds.size, clipStarts: firstHalf.clipStarts },
      halfTime: { unique: halfTime.mediaIds.size, clipStarts: halfTime.clipStarts },
      secondHalf: { unique: secondHalf.mediaIds.size, clipStarts: secondHalf.clipStarts },
      postMatch: { unique: postMatch.mediaIds.size, clipStarts: postMatch.clipStarts },
    },
    eventCounts: counts,
    observations,
    bootLogPath: cfg.bootLogPath,
    bootProblems,
    issues,
  };

  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    reportPath,
    `# Full-circle wedstrijd (${runId})

- **Match:** ${summary.matchLabel} (\`${match.id}\`)
- **Resultaat:** ${pass ? "PASS" : "FAIL"}
- **Eindstand:** ${summary.final.homeScore} – ${summary.final.awayScore}
- **Status / display:** ${summary.final.matchStatus} / ${summary.final.displayMode}

## Fases + sponsoring
| Fase | Unieke media | Clip-starts |
| --- | --- | --- |
| Prematch (${cfg.prematchSec}s) | ${prematch.mediaIds.size} | ${prematch.clipStarts} |
| 1e helft | ${firstHalf.mediaIds.size} | ${firstHalf.clipStarts} |
| Rust (${cfg.halftimeSec}s) | ${halfTime.mediaIds.size} | ${halfTime.clipStarts} |
| 2e helft | ${secondHalf.mediaIds.size} | ${secondHalf.clipStarts} |
| Post-match (${cfg.postMatchSec}s) | ${postMatch.mediaIds.size} | ${postMatch.clipStarts} |

## Wedstrijdmomenten
${observations
  .map(
    (o) =>
      `- ${o.ok ? "OK" : "FAIL"} ${o.phase} ${o.kind}${o.color ? ` ${o.color}` : ""} ${o.side} (${o.player}): modus ${o.beforeMode} → ${o.afterMode}, resume ${o.resumeMode}${o.note ? ` — ${o.note}` : ""}`,
  )
  .join("\n")}

## Eventlog
- GOAL: ${counts.GOAL}
- Gele kaart: ${counts.CARD_YELLOW}
- Rode kaart: ${counts.CARD_RED}
- Wissel: ${counts.SUB}

${issues.length ? `## Problemen\n${issues.map((i) => `- ${i}`).join("\n")}\n` : "## Problemen\nGeen.\n"}
${bootProblems.length ? `\n## Boot.log\n${bootProblems.map((l) => `- \`${l}\``).join("\n")}\n` : ""}
`,
    "utf8",
  );

  log("info", "finished", { pass, issues, reportPath });
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
