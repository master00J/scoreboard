const base = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:17890").replace(/\/+$/, "");
const pairingCode = process.env.E2E_PAIRING_CODE ?? "888888";
const operatorPin = process.env.E2E_OPERATOR_PIN ?? "888888";
const durMs = Number(process.env.E2E_PREMATCH_MS ?? "120000");
const pollMs = 400;

async function main() {
  const auth = await fetch(`${base}/mobile/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairingCode, role: "operator", operatorPin }),
  }).then((r) => r.json());
  const token = auth.sessionToken;
  const cmd = (command) =>
    fetch(`${base}/mobile/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ command }),
    });
  const matches = await fetch(`${base}/mobile/api/matches`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const m = matches.find((x) => !x.closedAt) ?? matches[0];
  await cmd({ type: "match:setActive", matchId: m.id });
  const kickoffAt = new Date(Date.now() + 6 * 60 * 1000).toISOString();
  await fetch(`${base}/mobile/api/matches/${m.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kickoffAt, status: "PREMATCH" }),
  });
  await cmd({ type: "match:setStatus", status: "PREMATCH" });
  await cmd({ type: "display:setMode", mode: "SPONSOR_ROTATION" });
  await cmd({ type: "timer:set", seconds: 0 });

  const media = new Set();
  const titles = [];
  let clipStarts = 0;
  let lastSid = "";
  const end = Date.now() + durMs;
  while (Date.now() < end) {
    const snap = await fetch(`${base}/mobile/snapshot`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    const ac = snap.sponsorLedger?.activeClip;
    if (ac?.mediaId) {
      media.add(ac.mediaId);
      if (ac.clipSessionId && ac.clipSessionId !== lastSid) {
        clipStarts += 1;
        lastSid = ac.clipSessionId;
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const finalSnap = await fetch(`${base}/mobile/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());

  console.log(
    JSON.stringify(
      {
        match: `${m.homeTeam?.name ?? "?"} vs ${m.awayTeam?.name ?? "?"}`,
        matchId: m.id,
        prematchMs: durMs,
        uniqueMedia: media.size,
        clipStarts,
        mediaIds: [...media],
        finalDisplayMode: finalSnap.displayMode,
        finalMatchStatus: finalSnap.matchStatus,
        ledgerSegment: finalSnap.sponsorLedger?.segmentKey ?? null,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
