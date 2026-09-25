const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const nonnegative = (value, fallback = 0) => Math.max(0, finite(value, fallback));
const timestamp = (value) => {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const periodNumber = (value) => Math.max(1, Math.floor(finite(Number(value), 1)) || 1);
const pad = (value) => String(value).padStart(2, "0");

/** Spiegel van lib/sports.ts op de desktop: zelfde klokken, periodes, limieten en acties per sport. */
const PROFILES = {
  FOOTBALL: {
    label: "Voetbal", periodLabel: "Helft", periods: 2, timer: "up", score: "Goal", increments: [1], timeouts: 0, stat: null, shot: [],
    defaultPeriodDurationSec: 2700, overtimeDurationSec: 900, maxOvertimePeriods: 2, breakDurationSec: 900, shortBreakDurationSec: 900, mainBreakAfterPeriod: 1,
    tenthsUnderMinute: false, timeoutDurationSec: 0, statLimit: null, foulBonusFrom: null, hasSets: false, setsToWinMatch: 0, penalty: [], penaltyFollowsClock: false,
    cards: ["YELLOW", "RED"], goalVisuals: true, injuryTime: true, possessionArrow: false, fieldPlayers: 11,
  },
  FUTSAL: {
    label: "Futsal", periodLabel: "Helft", periods: 2, timer: "down", score: "Goal", increments: [1], timeouts: 1, stat: "Teamfouten", shot: [],
    defaultPeriodDurationSec: 1200, overtimeDurationSec: 300, maxOvertimePeriods: 2, breakDurationSec: 600, shortBreakDurationSec: 600, mainBreakAfterPeriod: 1,
    tenthsUnderMinute: false, timeoutDurationSec: 60, statLimit: 5, foulBonusFrom: 5, hasSets: false, setsToWinMatch: 0, penalty: [], penaltyFollowsClock: false,
    cards: ["YELLOW", "RED"], goalVisuals: true, injuryTime: false, possessionArrow: false, fieldPlayers: 5,
  },
  BASKETBALL: {
    label: "Basketbal", periodLabel: "Quarter", periods: 4, timer: "down", score: "Punten", increments: [1, 2, 3], timeouts: 2, stat: "Teamfouten", shot: [24, 14],
    defaultPeriodDurationSec: 600, overtimeDurationSec: 300, maxOvertimePeriods: 5, breakDurationSec: 900, shortBreakDurationSec: 120, mainBreakAfterPeriod: 2,
    tenthsUnderMinute: true, timeoutDurationSec: 60, statLimit: 4, foulBonusFrom: 4, hasSets: false, setsToWinMatch: 0, penalty: [], penaltyFollowsClock: false,
    cards: [], goalVisuals: false, injuryTime: false, possessionArrow: true, fieldPlayers: 5,
  },
  VOLLEYBALL: {
    label: "Volleybal", periodLabel: "Set", periods: 5, timer: "none", score: "Punt", increments: [1], timeouts: 2, stat: null, shot: [],
    defaultPeriodDurationSec: 0, overtimeDurationSec: 0, maxOvertimePeriods: 0, breakDurationSec: 180, shortBreakDurationSec: 180, mainBreakAfterPeriod: null,
    tenthsUnderMinute: false, timeoutDurationSec: 30, statLimit: null, foulBonusFrom: null, hasSets: true, setsToWinMatch: 3, penalty: [], penaltyFollowsClock: false,
    cards: [], goalVisuals: false, injuryTime: false, possessionArrow: false, fieldPlayers: 6,
  },
  HOCKEY: {
    label: "Hockey", periodLabel: "Quarter", periods: 4, timer: "down", score: "Goal", increments: [1], timeouts: 0, stat: "Straffen", shot: [],
    defaultPeriodDurationSec: 900, overtimeDurationSec: 0, maxOvertimePeriods: 0, breakDurationSec: 600, shortBreakDurationSec: 120, mainBreakAfterPeriod: 2,
    tenthsUnderMinute: false, timeoutDurationSec: 0, statLimit: null, foulBonusFrom: null, hasSets: false, setsToWinMatch: 0, penalty: [120, 300], penaltyFollowsClock: true,
    cards: ["GREEN", "YELLOW", "RED"], goalVisuals: true, injuryTime: false, possessionArrow: false, fieldPlayers: 11,
  },
};
const TIMEOUT_LIMITS = {
  /** FIBA: 2 in de eerste helft, 3 in de tweede helft, 1 per verlenging. */
  BASKETBALL: (period) => (period > 4 ? 1 : period <= 2 ? 2 : 3),
  /** 1 time-out per helft, geen in de verlenging (FIFA Futsal Laws). */
  FUTSAL: (period) => (period <= 2 ? 1 : 0),
};
for (const [id, profile] of Object.entries(PROFILES)) {
  profile.id = id;
  const limit = TIMEOUT_LIMITS[id];
  profile.timeoutLimitForPeriod = limit ? (period) => limit(periodNumber(period)) : () => profile.timeouts;
  Object.freeze(profile.increments);
  Object.freeze(profile.shot);
  Object.freeze(profile.penalty);
  Object.freeze(profile.cards);
  Object.freeze(profile);
}

export function sportProfile(sport) {
  return PROFILES[String(sport || "FOOTBALL").trim().toUpperCase()] || PROFILES.FOOTBALL;
}

/** Aftellende klok op het moment van de desktopmeting; clients tellen zelf verder zolang hij loopt. */
function countdownAtSample(snapshot, prefix, sampleTime) {
  const base = nonnegative(snapshot[`${prefix}BaseSec`]);
  const started = timestamp(snapshot[`${prefix}StartedAt`]);
  if (!snapshot[`${prefix}Running`] || started === null || sampleTime === null) return base;
  return Math.max(0, base - Math.max(0, sampleTime - started) / 1000);
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
  const elapsedFallback = nonnegative(snapshot.timerBaseSec) +
    (snapshot.timerRunning && started !== null && sampleTime !== null ? Math.max(0, sampleTime - started) / 1000 : 0);
  return {
    ...snapshot,
    timerElapsedSec: nonnegative(snapshot.timerElapsedSec, elapsedFallback),
    shotClockRemainingSec: nonnegative(snapshot.shotClockRemainingSec, countdownAtSample(snapshot, "shotClock", sampleTime)),
    timeoutRemainingSec: nonnegative(snapshot.timeoutRemainingSec, countdownAtSample(snapshot, "timeout", sampleTime)),
    // De desktop stuurt geen rusttelemetrie mee: afleiden uit breakStartedAt op de meettijd van de desktop zelf.
    breakRemainingSec: nonnegative(snapshot.breakRemainingSec, countdownAtSample(snapshot, "break", sampleTime)),
    homePenaltyRemainingSec: nonnegative(snapshot.homePenaltyRemainingSec, countdownAtSample(snapshot, "homePenalty", sampleTime)),
    awayPenaltyRemainingSec: nonnegative(snapshot.awayPenaltyRemainingSec, countdownAtSample(snapshot, "awayPenalty", sampleTime)),
    _receivedAtMs: receivedAt,
    _sampleReceivedAtMs: sampleReceivedAt,
  };
}

function secondsSinceReceived(snapshot, nowMs) {
  const now = finite(nowMs, Date.now());
  return Math.max(0, now - finite(snapshot?._receivedAtMs, now)) / 1000;
}

/** Verstreken speeltijd in seconden, met fracties (tienden onder de laatste minuut). */
export function liveElapsedSeconds(snapshot, nowMs = Date.now()) {
  if (!isRecord(snapshot)) return 0;
  const base = nonnegative(snapshot.timerElapsedSec, nonnegative(snapshot.timerBaseSec));
  return base + (snapshot.timerRunning ? secondsSinceReceived(snapshot, nowMs) : 0);
}

export function computeElapsedSeconds(snapshot, nowMs = Date.now()) {
  return Math.floor(liveElapsedSeconds(snapshot, nowMs));
}

function liveCountdown(snapshot, remainingKey, fallbackKey, running, nowMs) {
  if (!isRecord(snapshot)) return 0;
  const base = nonnegative(snapshot[remainingKey], nonnegative(snapshot[fallbackKey]));
  return Math.max(0, base - (running ? secondsSinceReceived(snapshot, nowMs) : 0));
}

export function computeShotClockSeconds(snapshot, nowMs = Date.now()) {
  return liveCountdown(snapshot, "shotClockRemainingSec", "shotClockBaseSec", !!snapshot?.shotClockRunning, nowMs);
}

export function computeTimeoutSeconds(snapshot, nowMs = Date.now()) {
  return liveCountdown(snapshot, "timeoutRemainingSec", "timeoutBaseSec", !!snapshot?.timeoutRunning, nowMs);
}

export function computeBreakSeconds(snapshot, nowMs = Date.now()) {
  return liveCountdown(snapshot, "breakRemainingSec", "breakBaseSec", !!snapshot?.breakRunning, nowMs);
}

export function computePenaltySeconds(snapshot, side, nowMs = Date.now()) {
  const prefix = side === "away" ? "awayPenalty" : "homePenalty";
  return liveCountdown(snapshot, `${prefix}RemainingSec`, `${prefix}BaseSec`, !!snapshot?.[`${prefix}Running`], nowMs);
}

export function formatClock(totalSeconds) {
  const safe = Math.floor(nonnegative(totalSeconds));
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

/** m:ss, naar boven afgerond (time-out, rust, straftijd). */
export function formatCountdown(totalSeconds) {
  const safe = Math.max(0, Math.ceil(nonnegative(totalSeconds) - 1e-9));
  return `${Math.floor(safe / 60)}:${pad(safe % 60)}`;
}

/** Kloktekst zoals op het stadionscherm: aftellend naar boven afgerond, tienden onder 1:00 waar de sport dat vraagt. */
export function formatSportClock(profile, seconds) {
  const value = nonnegative(seconds);
  if (profile.timer === "down") {
    if (profile.tenthsUnderMinute && value < 60) {
      const tenths = Math.ceil(value * 10 - 1e-9);
      return `${Math.floor(tenths / 10)}.${tenths % 10}`;
    }
    const whole = Math.ceil(value - 1e-9);
    return `${pad(Math.floor(whole / 60))}:${pad(whole % 60)}`;
  }
  return formatClock(value);
}

/** Shotclock: tienden onder 5 seconden, daarboven hele seconden (naar boven). */
export function formatShotClock(seconds) {
  const value = nonnegative(seconds);
  if (value < 5) {
    const tenths = Math.ceil(value * 10 - 1e-9);
    return `${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  return String(Math.ceil(value - 1e-9));
}

export function isOvertimePeriod(profile, period) {
  return periodNumber(period) > profile.periods;
}

/** Effectieve periodeduur: reguliere periode uit de wedstrijd, verlenging uit het sportprofiel. */
export function periodDurationSecFor(profile, period, configuredSec) {
  if (isOvertimePeriod(profile, period)) return profile.overtimeDurationSec;
  const configured = Number(configuredSec);
  return Number.isFinite(configured) && configured > 0 ? configured : profile.defaultPeriodDurationSec;
}

/** Waarde op de wedstrijdklok: resterend bij aftellende sporten, verstreken bij voetbal. */
export function sportClockSeconds(profile, elapsedSec, configuredSec, period = 1) {
  const elapsed = Math.max(0, finite(elapsedSec));
  if (profile.timer !== "down") return elapsed;
  return Math.max(0, periodDurationSecFor(profile, period, configuredSec) - elapsed);
}

/** Verstreken tijd bij de start van een periode (voetbal telt door: 2e helft start op 45:00). */
export function periodStartElapsedSec(profile, match, period) {
  if (profile.timer !== "up") return 0;
  const p = periodNumber(period);
  const regular = periodDurationSecFor(profile, 1, match?.periodDurationSec);
  if (p <= profile.periods) return (p - 1) * regular;
  return profile.periods * regular + (p - profile.periods - 1) * profile.overtimeDurationSec;
}

/** Hoogste periode die de desktop accepteert (volleybal: best-of via setsToWin). */
export function maxPeriodForMatch(profile, match) {
  if (profile.hasSets) {
    const raw = Number(match?.setsToWin);
    const setsToWin = Number.isFinite(raw) && raw > 0 ? Math.min(5, Math.max(1, Math.floor(raw))) : profile.setsToWinMatch || 3;
    return setsToWin * 2 - 1;
  }
  return profile.periods + (profile.overtimeDurationSec > 0 ? profile.maxOvertimePeriods : 0);
}

/** Aantal periodeknoppen: reguliere periodes, of alle sets van de wedstrijd bij volleybal. */
export function regularPeriodCount(profile, match) {
  return profile.hasSets ? maxPeriodForMatch(profile, match) : profile.periods;
}

export function nextOvertimePeriod(profile, period) {
  const p = periodNumber(period);
  const next = p > profile.periods ? p + 1 : profile.periods + 1;
  return Math.min(next, profile.periods + profile.maxOvertimePeriods);
}

/** "half" (1/2), "quarter", "set", "overtime" + volgnummer; de UI vertaalt. */
export function describePeriod(profile, period) {
  const p = periodNumber(period);
  if (profile.hasSets) return { kind: "set", index: p };
  if (p > profile.periods) return { kind: "overtime", index: p - profile.periods, numbered: profile.maxOvertimePeriods > 1 };
  if (profile.periods <= 2) return { kind: "half", index: p };
  return { kind: "quarter", index: p };
}

export function timeoutLimitForMatch(profile, match) {
  if (profile.hasSets) {
    const raw = Number(match?.timeoutsPerSet);
    if (match?.timeoutsPerSet != null && Number.isFinite(raw)) return Math.max(0, Math.min(6, Math.floor(raw)));
  }
  return profile.timeoutLimitForPeriod(match?.currentPeriod);
}

export function timeoutDurationSecForMatch(profile, match) {
  const raw = Number(match?.timeoutDurationSec);
  if (profile.hasSets && Number.isFinite(raw) && raw > 0) return Math.max(5, Math.min(180, Math.floor(raw)));
  return profile.timeoutDurationSec;
}

/** FIBA 18.2.5: in Q4 tellen maximaal 2 time-outs mee zodra de klok 2:00 of minder toont. */
export const BASKETBALL_LATE_WINDOW_SEC = 120;
export const BASKETBALL_LATE_TIMEOUT_MAX = 2;

export function basketballLateTimeoutCounts(profile, period, gameClockRemainingSec) {
  return profile.id === "BASKETBALL" && periodNumber(period) === profile.periods &&
    finite(gameClockRemainingSec, Infinity) <= BASKETBALL_LATE_WINDOW_SEC;
}

export function basketballLateTimeoutBlocked(profile, period, gameClockRemainingSec, lateTimeoutsUsed) {
  return basketballLateTimeoutCounts(profile, period, gameClockRemainingSec) &&
    nonnegative(lateTimeoutsUsed) >= BASKETBALL_LATE_TIMEOUT_MAX;
}

/** FIBA 50.5: bij nieuw balbezit met minder dan 14 s op de wedstrijdklok gaat de shotclock uit. */
export const SHOT_CLOCK_OFF_BELOW_SEC = 14;

/** Deltasec voor timer:adjust bij een aanpassing van de getoonde klok (aftellend: omgekeerd). */
export function clockAdjustDelta(profile, displayDeltaSec) {
  const delta = Math.round(finite(displayDeltaSec));
  return profile.timer === "down" ? -delta : delta;
}

/** timer:set-waarde (verstreken seconden) voor een gewenste stand op de klok. */
export function clockSetSeconds(profile, match, displaySeconds) {
  const requested = Math.max(0, Math.round(finite(displaySeconds)));
  if (profile.timer !== "down") return requested;
  return Math.max(0, Math.round(periodDurationSecFor(profile, match?.currentPeriod, match?.periodDurationSec) - requested));
}

/** "7:30", "07:30", "450" of "7" (minuten niet toegestaan zonder ":") → seconden; null bij ongeldige invoer. */
export function parseClockInput(text) {
  const value = String(text ?? "").trim();
  const clock = /^(\d{1,3}):([0-5]?\d)$/.exec(value);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  if (/^\d{1,5}$/.test(value)) return Number(value);
  return null;
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
  const side = command.side === "home" || command.side === "away" ? command.side : null;
  if ((command.type === "score:adjust" || command.type === "goal:trigger") && side) {
    const key = `${side}Score`;
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
  if (command.type === "sport:statAdjust" && side) {
    const field = command.stat === "timeout" ? "Timeouts" : command.stat === "foul" ? "Fouls" : command.stat === "set" ? "Sets" : null;
    if (!field) return match;
    const key = `${side}${field}`;
    next[key] = Math.max(0, nonnegative(next[key]) + finite(command.delta));
    return next;
  }
  if (command.type === "timeout:start" && side && command.countAgainstTeam !== false) {
    next[`${side}Timeouts`] = nonnegative(next[`${side}Timeouts`]) + 1;
    return next;
  }
  if (command.type === "sport:setPossession" && side) {
    next.possessionArrow = side;
    return next;
  }
  if (command.type === "sport:setServing" && side) {
    next.servingSide = side;
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
