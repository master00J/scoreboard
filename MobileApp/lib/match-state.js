const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const nonnegative = (value, fallback = 0) => Math.max(0, finite(value, fallback));
const timestamp = (value) => {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const PROFILES = {
  FOOTBALL: { label: "Voetbal", periodLabel: "Helft", periods: 2, timer: "up", score: "Goal", increments: [1], timeouts: 0, stat: null, shot: [], defaultPeriodDurationSec: 2700, hasSets: false, fieldPlayers: 11 },
  FUTSAL: { label: "Futsal", periodLabel: "Helft", periods: 2, timer: "down", score: "Goal", increments: [1], timeouts: 1, stat: "Teamfouten", shot: [], defaultPeriodDurationSec: 1200, hasSets: false, fieldPlayers: 5 },
  BASKETBALL: { label: "Basketbal", periodLabel: "Quarter", periods: 4, timer: "down", score: "Punten", increments: [1, 2, 3], timeouts: 2, stat: "Teamfouten", shot: [24, 14], defaultPeriodDurationSec: 600, hasSets: false, fieldPlayers: 5 },
  VOLLEYBALL: { label: "Volleybal", periodLabel: "Set", periods: 5, timer: "none", score: "Punt", increments: [1], timeouts: 2, stat: null, shot: [], defaultPeriodDurationSec: 0, hasSets: true, fieldPlayers: 6 },
  HOCKEY: { label: "Hockey", periodLabel: "Quarter", periods: 4, timer: "down", score: "Goal", increments: [1], timeouts: 0, stat: "Straffen", shot: [], defaultPeriodDurationSec: 900, hasSets: false, fieldPlayers: 11 },
};
for (const [id, profile] of Object.entries(PROFILES)) {
  profile.id = id;
  profile.timeoutLimitForPeriod = id === "BASKETBALL"
    ? (period) => finite(period, 1) <= 2 ? 2 : 3
    : () => profile.timeouts;
  Object.freeze(profile.increments);
  Object.freeze(profile.shot);
  Object.freeze(profile);
}

export function sportProfile(sport) {
  return PROFILES[String(sport || "FOOTBALL").trim().toUpperCase()] || PROFILES.FOOTBALL;
}

export function normalizeSnapshot(snapshot, previous = null, nowMs = Date.now()) {
  if (!isRecord(snapshot)) return null;
  const receivedNow = finite(nowMs, Date.now());
  const marker = finite(snapshot.timerElapsedAtMs, null);
  const sameSample = marker !== null && isRecord(previous) &&
    marker === previous.timerElapsedAtMs && extractMatchId(snapshot) === extractMatchId(previous);
  const receivedAt = sameSample ? finite(previous._receivedAtMs, receivedNow) : receivedNow;
  const sampleReceivedAt = sameSample ? finite(previous._sampleReceivedAtMs, receivedAt) : receivedNow;
  const sampleTime = marker ?? finite(snapshot.serverTimeMs, null) ?? timestamp(snapshot.updatedAt);
  const started = timestamp(snapshot.timerStartedAt);
  const shotStarted = timestamp(snapshot.shotClockStartedAt);
  const elapsedFallback = nonnegative(snapshot.timerBaseSec) +
    (snapshot.timerRunning && started !== null && sampleTime !== null ? Math.max(0, sampleTime - started) / 1000 : 0);
  const shotFallback = nonnegative(snapshot.shotClockBaseSec) -
    (snapshot.shotClockRunning && shotStarted !== null && sampleTime !== null ? Math.max(0, sampleTime - shotStarted) / 1000 : 0);
  return {
    ...snapshot,
    timerElapsedSec: nonnegative(snapshot.timerElapsedSec, elapsedFallback),
    shotClockRemainingSec: nonnegative(snapshot.shotClockRemainingSec, Math.max(0, shotFallback)),
    _receivedAtMs: receivedAt,
    _sampleReceivedAtMs: sampleReceivedAt,
  };
}

function secondsSinceReceived(snapshot, nowMs) {
  const now = finite(nowMs, Date.now());
  return Math.max(0, now - finite(snapshot?._receivedAtMs, now)) / 1000;
}

export function computeElapsedSeconds(snapshot, nowMs = Date.now()) {
  if (!isRecord(snapshot)) return 0;
  const base = nonnegative(snapshot.timerElapsedSec, nonnegative(snapshot.timerBaseSec));
  return Math.floor(base + (snapshot.timerRunning ? secondsSinceReceived(snapshot, nowMs) : 0));
}

export function computeShotClockSeconds(snapshot, nowMs = Date.now()) {
  if (!isRecord(snapshot)) return 0;
  const base = nonnegative(snapshot.shotClockRemainingSec, nonnegative(snapshot.shotClockBaseSec));
  return Math.max(0, base - (snapshot.shotClockRunning ? secondsSinceReceived(snapshot, nowMs) : 0));
}

export function formatClock(totalSeconds) {
  const safe = Math.floor(nonnegative(totalSeconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function readCloudState(payload) {
  if (!isRecord(payload) || payload.ok === false) return null;
  const state = "state" in payload ? payload.state : "displayState" in payload ? payload.displayState : payload;
  return isRecord(state) ? state : null;
}

export function extractMatchId(state) {
  if (!isRecord(state)) return null;
  const candidates = [state.matchId, state.activeMatchId, state.activeMatch?.id, state.match?.id];
  return candidates.find((id) => typeof id === "string" && id.trim()) ?? null;
}

function mergeTeam(next, previous) {
  if (!isRecord(next)) return previous ?? null;
  if (!isRecord(previous)) return next;
  const nextPlayers = Array.isArray(next.players) ? next.players : null;
  const previousPlayers = Array.isArray(previous.players) ? previous.players : null;
  return {
    ...previous,
    ...next,
    players: nextPlayers?.length ? nextPlayers : previousPlayers ?? nextPlayers,
  };
}

export function splitFieldAndBench(team, fieldIds, maximum = 11) {
  const squad = (Array.isArray(team?.players) ? team.players : []).filter((player) => !player?.isCoach);
  const stored = Array.isArray(fieldIds) ? fieldIds.filter((id) => typeof id === "string" && id) : [];
  const ids = stored.length
    ? stored
    : [...squad].sort((a, b) => finite(a.number) - finite(b.number)).slice(0, Math.max(1, finite(maximum, 11))).map((player) => player.id);
  const onFieldIds = new Set(ids);
  return {
    onField: squad.filter((player) => onFieldIds.has(player.id)),
    bench: squad.filter((player) => !onFieldIds.has(player.id)),
  };
}

export function mergeLiveMatch(details, snapshotMatch) {
  if (!isRecord(snapshotMatch) || typeof snapshotMatch.id !== "string" || !snapshotMatch.id.trim()) {
    return details ?? null;
  }
  if (!isRecord(details) || details.id !== snapshotMatch.id) {
    return snapshotMatch;
  }
  return {
    ...details,
    ...snapshotMatch,
    homeTeam: mergeTeam(snapshotMatch.homeTeam, details.homeTeam),
    awayTeam: mergeTeam(snapshotMatch.awayTeam, details.awayTeam),
    homeFieldPlayerIds: Array.isArray(snapshotMatch.homeFieldPlayerIds) ? snapshotMatch.homeFieldPlayerIds : details.homeFieldPlayerIds,
    awayFieldPlayerIds: Array.isArray(snapshotMatch.awayFieldPlayerIds) ? snapshotMatch.awayFieldPlayerIds : details.awayFieldPlayerIds,
    homeScore: nonnegative(snapshotMatch.homeScore, nonnegative(details.homeScore)),
    awayScore: nonnegative(snapshotMatch.awayScore, nonnegative(details.awayScore)),
    status: snapshotMatch.status ?? details.status,
    currentPeriod: snapshotMatch.currentPeriod ?? details.currentPeriod,
  };
}

export function applyCommandToMatch(match, command) {
  if (!isRecord(match) || !isRecord(command) || typeof command.type !== "string") return match;
  const next = { ...match };
  if ((command.type === "score:adjust" || command.type === "goal:trigger") && (command.side === "home" || command.side === "away")) {
    const key = `${command.side}Score`;
    const delta = command.type === "goal:trigger" ? 1 : finite(command.delta);
    next[key] = Math.max(0, nonnegative(next[key]) + delta);
    return next;
  }
  if (command.type === "match:setStatus" && typeof command.status === "string") {
    next.status = command.status;
    return next;
  }
  if (command.type === "sport:setPeriod" && Number.isFinite(command.period)) {
    next.currentPeriod = Math.max(1, Math.floor(command.period));
    return next;
  }
  if (command.type === "sport:statAdjust" && (command.side === "home" || command.side === "away")) {
    const field = command.stat === "timeout" ? "Timeouts" : command.stat === "foul" ? "Fouls" : command.stat === "set" ? "Sets" : null;
    if (!field) return match;
    const key = `${command.side}${field}`;
    next[key] = Math.max(0, nonnegative(next[key]) + finite(command.delta));
    return next;
  }
  return match;
}

export function hasStoredCredentials(config) {
  if (!isRecord(config) || typeof config.baseUrl !== "string" || !config.baseUrl.trim()) return false;
  if (config.connectionMode === "cloud") return typeof config.venueId === "string" && !!config.venueId.trim();
  if (typeof config.pairingCode !== "string" || !config.pairingCode.trim()) return false;
  return config.role !== "operator" || (typeof config.operatorPin === "string" && !!config.operatorPin.trim());
}

export function cloudMatchesFromState(state) {
  if (!isRecord(state)) return [];
  const byId = new Map();
  const add = (match) => {
    if (!isRecord(match) || typeof match.id !== "string" || !match.id.trim()) return;
    byId.set(match.id, {
      ...match,
      status: match.status ?? "UNKNOWN",
      homeScore: nonnegative(match.homeScore),
      awayScore: nonnegative(match.awayScore),
    });
  };
  if (Array.isArray(state.matches)) state.matches.forEach(add);
  add(state.match);
  add(state.activeMatch);
  const matchId = extractMatchId(state);
  if (matchId && !byId.has(matchId)) {
    add({
      id: matchId,
      status: state.matchStatus ?? state.status ?? state.mode ?? "ACTIVE",
      homeScore: state.homeScore,
      awayScore: state.awayScore,
    });
  }
  return [...byId.values()];
}
