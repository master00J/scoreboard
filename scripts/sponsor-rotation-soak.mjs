import fs from "node:fs";
import path from "node:path";

/**
 * Meet sponsorclip-duur via mobile /mobile/snapshot (veld sponsorLedger).
 * Werkt voor SponsorBudgetRotation (wedstrijd / rust / prematch-spread met telemetrie).
 * Simpele playlist-IDLE-rotatie zonder budget stuurt geen ledger → dan zie je waarschuwingen.
 */

const cfg = {
  baseUrl: (process.env.SOAK_BASE_URL ?? "http://127.0.0.1:17890").replace(/\/+$/, ""),
  pairingCode: (process.env.SOAK_PAIRING_CODE ?? "").trim(),
  operatorPin: (process.env.SOAK_OPERATOR_PIN ?? "").trim(),
  durationMin: Number(process.env.SOAK_SPONSOR_DURATION_MIN ?? "15"),
  pollMs: Number(process.env.SOAK_SPONSOR_POLL_MS ?? "400"),
  /** Maximaal hoeveel seconden een clip mag uitlopen t.o.v. expectedPlaySec (fade + polling + decoder). */
  lateSlackSec: Number(process.env.SOAK_SPONSOR_LATE_SLACK_SEC ?? "4"),
  /** Minimaal verwacht (clips die veel te vroeg eindigen zijn verdacht). */
  earlySlackSec: Number(process.env.SOAK_SPONSOR_EARLY_SLACK_SEC ?? "2"),
  matchIdOverride: (process.env.SOAK_SPONSOR_MATCH_ID ?? "").trim(),
  skipSetup: process.env.SOAK_SPONSOR_SKIP_SETUP === "1",
  /** Als "1": minstens één voltooide clip vereist voor pass. */
  requireClip: process.env.SOAK_SPONSOR_REQUIRE_CLIP === "1",
};

const startedAt = new Date();
const runId = startedAt.toISOString().replace(/[:.]/g, "-");
const outDir = path.join(process.cwd(), "soak-results", `sponsor-${runId}`);
const logPath = path.join(outDir, "events.jsonl");
const clipsPath = path.join(outDir, "clips.jsonl");
const summaryPath = path.join(outDir, "summary.json");
const reportPath = path.join(outDir, "report.md");

function writeEvent(level, event, data = {}) {
  const row = { t: new Date().toISOString(), level, event, ...data };
  fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
  const msg = `[${row.t}] ${level.toUpperCase()} ${event}`;
  if (level === "error") console.error(msg, data);
  else console.log(msg, data);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { ok: res.ok, status: res.status, payload, latencyMs: Math.round(performance.now() - t0) };
}

async function postCommand(token, command) {
  return postJson(`${cfg.baseUrl}/mobile/command`, { command }, token);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  if (!cfg.pairingCode || !cfg.operatorPin) {
    throw new Error("SOAK_PAIRING_CODE en SOAK_OPERATOR_PIN zijn verplicht (zelfde als mobile bridge).");
  }

  writeEvent("info", "start", { config: { ...cfg, pairingCode: "[set]", operatorPin: "[set]" } });

  const health = await getJson(`${cfg.baseUrl}/mobile/health`, null);
  if (!health.ok) {
    throw new Error(`Healthcheck faalde (${health.status}). Start desktop met mobile bridge.`);
  }

  const auth = await postJson(
    `${cfg.baseUrl}/mobile/auth/session`,
    { pairingCode: cfg.pairingCode, role: "operator", operatorPin: cfg.operatorPin },
    null,
  );
  if (!auth.ok || !auth.payload?.sessionToken) {
    throw new Error(`Auth mislukt (${auth.status})`);
  }
  const token = auth.payload.sessionToken;
  writeEvent("info", "auth-ok", {});

  if (!cfg.skipSetup) {
    const snap0 = await getJson(`${cfg.baseUrl}/mobile/snapshot`, token);
    const p0 = snap0.payload && typeof snap0.payload === "object" ? snap0.payload : {};
    let matchId = cfg.matchIdOverride || (typeof p0.matchId === "string" ? p0.matchId : null);
    if (cfg.matchIdOverride) {
      const r = await postCommand(token, { type: "match:setActive", matchId: cfg.matchIdOverride });
      writeEvent(r.ok ? "info" : "error", "setup-match-setActive", { ok: r.ok, payload: r.payload });
      matchId = cfg.matchIdOverride;
    }
    if (!matchId) {
      writeEvent(
        "warn",
        "no-match",
        { hint: "Zet een actieve wedstrijd in Control, of SOAK_SPONSOR_MATCH_ID=<cuid>." },
      );
    } else {
      await postCommand(token, { type: "match:setStatus", status: "FIRST_HALF" });
      await postCommand(token, { type: "display:setMode", mode: "SPONSOR_ROTATION" });
      await postCommand(token, { type: "timer:start" });
      writeEvent("info", "setup-live-sponsor-context", { matchId });
    }
  }

  const deadline = Date.now() + Math.max(1, cfg.durationMin) * 60_000;
  /** @type {{ clipSessionId: string; sponsorId: string; mediaId: string; startedAtMs: number; expectedPlaySec: number } | null} */
  let tracking = null;
  /** @type {Array<{ clipSessionId: string; expectedSec: number; observedSec: number; pass: boolean; note?: string }>} */
  const clips = [];

  while (Date.now() < deadline) {
    const snap = await getJson(`${cfg.baseUrl}/mobile/snapshot`, token);
    const nowMs = Date.now();
    if (!snap.ok) {
      writeEvent("error", "snapshot-failed", { status: snap.status });
      await sleep(cfg.pollMs);
      continue;
    }
    const p = snap.payload && typeof snap.payload === "object" ? snap.payload : {};
    const ledger = p.sponsorLedger;
    const ac =
      ledger && typeof ledger === "object" && ledger.activeClip && typeof ledger.activeClip === "object"
        ? ledger.activeClip
        : null;

    if (ac && typeof ac.clipSessionId === "string") {
      if (!tracking || tracking.clipSessionId !== ac.clipSessionId) {
        if (tracking) {
          const endMs = Number(ac.startedAtMs) || nowMs;
          const observedSec = (endMs - tracking.startedAtMs) / 1000;
          const expectedSec = Number(tracking.expectedPlaySec) || 0;
          const pass =
            observedSec >= expectedSec - cfg.earlySlackSec &&
            observedSec <= expectedSec + cfg.lateSlackSec + cfg.pollMs / 1000;
          const row = {
            clipSessionId: tracking.clipSessionId,
            sponsorId: tracking.sponsorId,
            mediaId: tracking.mediaId,
            expectedSec,
            observedSec: Math.round(observedSec * 1000) / 1000,
            pass,
            endReason: "next-clip",
          };
          clips.push(row);
          fs.appendFileSync(clipsPath, `${JSON.stringify(row)}\n`, "utf8");
          writeEvent(pass ? "info" : "warn", "clip-ended", row);
        }
        tracking = {
          clipSessionId: ac.clipSessionId,
          sponsorId: String(ac.sponsorId ?? ""),
          mediaId: String(ac.mediaId ?? ""),
          startedAtMs: Number(ac.startedAtMs) || nowMs,
          expectedPlaySec: Number(ac.expectedPlaySec) || 0,
        };
        writeEvent("info", "clip-started", {
          clipSessionId: tracking.clipSessionId,
          expectedPlaySec: tracking.expectedPlaySec,
        });
      }
    } else if (tracking) {
      const observedSec = (nowMs - tracking.startedAtMs) / 1000;
      const expectedSec = Number(tracking.expectedPlaySec) || 0;
      const pass =
        observedSec >= expectedSec - cfg.earlySlackSec &&
        observedSec <= expectedSec + cfg.lateSlackSec + cfg.pollMs / 1000;
      const row = {
        clipSessionId: tracking.clipSessionId,
        sponsorId: tracking.sponsorId,
        mediaId: tracking.mediaId,
        expectedSec,
        observedSec: Math.round(observedSec * 1000) / 1000,
        pass,
        endReason: "ledger-cleared",
      };
      clips.push(row);
      fs.appendFileSync(clipsPath, `${JSON.stringify(row)}\n`, "utf8");
      writeEvent(pass ? "info" : "warn", "clip-ended", row);
      tracking = null;
    }

    await sleep(cfg.pollMs);
  }

  if (tracking) {
    writeEvent("info", "incomplete-last-clip", {
      clipSessionId: tracking.clipSessionId,
      note: "Run eindigde terwijl dezelfde clip nog speelde — geen eindmeting.",
    });
  }

  const failed = clips.filter((c) => !c.pass);
  const pass = failed.length === 0 && (!cfg.requireClip || clips.length > 0);

  if (clips.length === 0) {
    writeEvent("warn", "no-clips", {
      hint: "Geen sponsorLedger-clipwissels gezien. Budget-sponsors + eerste helft + SPONSOR_ROTATION nodig. Zie SOAK_TEST.md.",
    });
  }

  const summary = {
    runId,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    pass,
    clipsTotal: clips.length,
    clipsFailed: failed.length,
    config: {
      baseUrl: cfg.baseUrl,
      durationMin: cfg.durationMin,
      pollMs: cfg.pollMs,
      lateSlackSec: cfg.lateSlackSec,
      earlySlackSec: cfg.earlySlackSec,
    },
    artifacts: { events: logPath, clips: clipsPath, summary: summaryPath, report: reportPath },
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  const report = [
    "# Sponsorrotatie-soak (timing via sponsorLedger)",
    "",
    `- Run: \`${runId}\``,
    `- Clips gemeten: ${clips.length}, afwijkingen: ${failed.length}`,
    `- Pass: **${pass ? "ja" : "nee"}**`,
    "",
    "Legenda: `expectedSec` komt van het display (SponsorBudgetRotation). `observedSec` is muurklok tussen `startedAtMs` en het moment dat de volgende clip start of de ledger leeg wordt.",
    "",
    "Zonder sponsorbudget-telemetrie blijft `clips` leeg — configureer actieve sponsors met wedstrijdtijd + media, eerste helft, display SPONSOR_ROTATION.",
    "",
    `- Artefacten: \`${outDir}\``,
  ].join("\n");
  fs.writeFileSync(reportPath, report, "utf8");

  writeEvent("info", "done", { pass, clipsTotal: clips.length, clipsFailed: failed.length });
  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
