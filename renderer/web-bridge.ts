import { computeElapsedSeconds, computeShotClockSeconds, pauseShotClockAt, runFrom, runShotClockFrom, stopAt } from "@/lib/timer";
import { getSportProfile, lifecycleStatusForPeriod, normalizeSport, resetStatsForNewPeriod, resetTimeoutsForNewPeriod } from "@/lib/sports";
import { uiLocaleFromSearch } from "@/lib/i18n/locales";
import { DEFAULT_LIVESTREAM_SETTINGS, DEFAULT_LIVESTREAM_STATUS, mergeLivestreamSettings } from "@/lib/livestream";
import { CommandSchema, type Command } from "@/lib/validation/commands";
import type { CommandAck, DesktopApiRequest, DesktopApiResponse, ElectronBridge, SerializedDisplayState, TickPayload } from "@/lib/desktop-bridge";

const CHANNEL = "arenacue-web-scoreboard";
const STORAGE_KEY = "arenacue_web_scoreboard_v4";
let webLivestreamSettings = { ...DEFAULT_LIVESTREAM_SETTINGS };

function id(prefix = "c") {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function json(status: number, payload: unknown): DesktopApiResponse {
  return { status, contentType: "application/json", json: payload, text: JSON.stringify(payload) };
}

type Store = {
  teams: any[];
  players: any[];
  matches: any[];
  events: any[];
  sponsors: any[];
  media: any[];
  playlists: any[];
  playlistItems: any[];
  settings: any;
  display: any;
  sponsorPlays: any[];
  templates: any[];
  cues: any[];
};

function seed(): Store {
  const homeId = id("t");
  const awayId = id("t");
  const matchId = id("m");
  const voltId = id("s");
  const worksId = id("s");
  const voltMediaId = id("md");
  const worksMediaId = id("md");
  const createdAt = nowIso();
  const homePlayers = Array.from({ length: 11 }, (_, i) => ({
    id: id("p"),
    teamId: homeId,
    number: i + 1,
    firstName: `H${i + 1}`,
    lastName: "Demo",
    position: i === 0 ? "GK" : i < 5 ? "DEF" : i < 9 ? "MID" : "FWD",
    photoPath: null,
    isCoach: false,
    goalMediaId: null,
    goalVideoPath: null,
    subImagePath: null,
    lineupVideoPath: null,
  }));
  const awayPlayers = Array.from({ length: 11 }, (_, i) => ({
    id: id("p"),
    teamId: awayId,
    number: i + 1,
    firstName: `A${i + 1}`,
    lastName: "Demo",
    position: i === 0 ? "GK" : i < 5 ? "DEF" : i < 9 ? "MID" : "FWD",
    photoPath: null,
    isCoach: false,
    goalMediaId: null,
    goalVideoPath: null,
    subImagePath: null,
    lineupVideoPath: null,
  }));
  return {
    teams: [
      { id: homeId, name: "Home FC", shortName: "HOM", logoPath: null, primaryColor: "#1e40af", secondaryColor: "#fbbf24" },
      { id: awayId, name: "Away United", shortName: "AWY", logoPath: null, primaryColor: "#b91c1c", secondaryColor: "#ffffff" },
    ],
    players: [...homePlayers, ...awayPlayers],
    matches: [
      {
        id: matchId,
        homeTeamId: homeId,
        awayTeamId: awayId,
        kickoffAt: null,
        matchSponsorMediaId: null,
        halfDurationSec: 2700,
        halfBreakSec: 900,
        sport: "FOOTBALL",
        currentPeriod: 1,
        periodDurationSec: 2700,
        homeTimeouts: 0,
        awayTimeouts: 0,
        homeFouls: 0,
        awayFouls: 0,
        homeSets: 0,
        awaySets: 0,
        prematchSpreadWindowSec: 0,
        status: "SETUP",
        homeScore: 0,
        awayScore: 0,
        homeFieldPlayerIdsJson: null,
        awayFieldPlayerIdsJson: null,
        createdAt: nowIso(),
        closedAt: null,
      },
    ],
    events: [],
    sponsors: [
      {
        id: voltId,
        name: "Volt Energy",
        active: true,
        prematchSeconds: 180,
        matchSeconds: 240,
        matchFirstHalfSeconds: 120,
        matchSecondHalfSeconds: 120,
        halftimeSeconds: 90,
        postmatchSeconds: 90,
        imageDefaultSec: 10,
        createdAt,
      },
      {
        id: worksId,
        name: "Stadion Works",
        active: true,
        prematchSeconds: 120,
        matchSeconds: 180,
        matchFirstHalfSeconds: 90,
        matchSecondHalfSeconds: 90,
        halftimeSeconds: 60,
        postmatchSeconds: 60,
        imageDefaultSec: 10,
        createdAt,
      },
    ],
    media: [
      {
        id: voltMediaId,
        type: "IMAGE",
        path: "/uploads/demo-volt-energy.svg",
        title: "Volt Energy — LED",
        durationSec: 10,
        sponsorName: "Volt Energy",
        sponsorId: voltId,
        active: true,
        playAudio: false,
        hideFromLibrary: false,
        quickLaunch: false,
        createdAt,
      },
      {
        id: worksMediaId,
        type: "IMAGE",
        path: "/uploads/demo-stadion-works.svg",
        title: "Stadion Works — LED",
        durationSec: 10,
        sponsorName: "Stadion Works",
        sponsorId: worksId,
        active: true,
        playAudio: false,
        hideFromLibrary: false,
        quickLaunch: false,
        createdAt,
      },
    ],
    playlists: [
      { id: id("pl"), name: "Idle", slot: "IDLE" },
      { id: id("pl"), name: "Pre-match", slot: "PREMATCH" },
      { id: id("pl"), name: "Half-time", slot: "HALFTIME" },
      { id: id("pl"), name: "Post-match", slot: "POSTMATCH" },
      { id: id("pl"), name: "Goal celebrations", slot: "GOAL" },
    ],
    playlistItems: [],
    settings: {
      id: 1,
      homeTeamId: homeId,
      goalIntroVideoPath: null,
      goalVisualHomeEnabled: true,
      goalVisualAwayEnabled: false,
      firstHalfScoreboardSec: 45,
      firstHalfSponsorSec: 15,
      halftimeScoreboardSec: 30,
      halftimeSponsorSec: 15,
      secondHalfScoreboardSec: 45,
      secondHalfSponsorSec: 15,
      scoreboardThemeJson: null,
      proofOfPlayBrandJson: null,
      displayCanvasWidth: 1920,
      displayCanvasHeight: 1080,
      displayScalingMode: "cover",
      displaySafeZoneVisible: false,
      displaySafeZoneMarginPx: 40,
      idleFallbackMediaId: null,
      uiLocale: "nl",
    },
    display: {
      id: 1,
      mode: "IDLE",
      matchId,
      activePlayerId: null,
      activeSubOutId: null,
      activeSubInId: null,
      activeGoalScorerId: null,
      activeMediaId: null,
      substitutionQueueJson: "[]",
      timerRunning: false,
      timerStartedAt: null,
      timerBaseSec: 0,
      shotClockRunning: false,
      shotClockStartedAt: null,
      shotClockBaseSec: 24,
      addedTimeMinutes: 0,
      externalCaptureSourceId: null,
      externalCaptureToDisplay: false,
      safeMode: false,
      blackoutResumeMode: null,
      postMatchStartedAt: null,
      preMatchStartedAt: null,
      updatedAt: nowIso(),
    },
    sponsorPlays: [],
    templates: [],
    cues: [],
  };
}

function loadStore(): Store {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* ignore */
  }
  return seed();
}

let store = loadStore();

function queryUiLocale() {
  return uiLocaleFromSearch(window.location.search);
}

const forcedLocale = queryUiLocale();
if (forcedLocale && store.settings?.uiLocale !== forcedLocale) {
  store.settings = { ...store.settings, uiLocale: forcedLocale };
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

if (forcedLocale) persist();

const stateListeners = new Set<(state: SerializedDisplayState) => void>();
const tickListeners = new Set<(tick: TickPayload) => void>();

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function serializeDisplay(): SerializedDisplayState {
  const d = store.display;
  return {
    ...d,
    timerStartedAt: asIso(d.timerStartedAt),
    shotClockStartedAt: asIso(d.shotClockStartedAt),
    postMatchStartedAt: asIso(d.postMatchStartedAt),
    preMatchStartedAt: asIso(d.preMatchStartedAt),
    updatedAt: asIso(d.updatedAt) ?? nowIso(),
  };
}

function touchDisplay(patch: Record<string, unknown> = {}) {
  store.display = { ...store.display, ...patch, updatedAt: nowIso() };
  persist();
  const snap = serializeDisplay();
  stateListeners.forEach((fn) => fn(snap));
  window.dispatchEvent(new CustomEvent(CHANNEL, { detail: snap }));
}

function teamById(teamId: string) {
  const team = store.teams.find((t) => t.id === teamId);
  if (!team) return null;
  return { ...team, players: store.players.filter((p) => p.teamId === teamId).sort((a, b) => a.number - b.number) };
}

function matchById(matchId: string) {
  const match = store.matches.find((m) => m.id === matchId);
  if (!match) return null;
  return {
    ...match,
    homeTeam: teamById(match.homeTeamId),
    awayTeam: teamById(match.awayTeamId),
    events: store.events.filter((e) => e.matchId === matchId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    matchSponsorMedia: match.matchSponsorMediaId ? store.media.find((m) => m.id === match.matchSponsorMediaId) ?? null : null,
  };
}

function settingsJson() {
  const forced = queryUiLocale();
  const s = forced ? { ...store.settings, uiLocale: forced } : store.settings;
  const home = s.homeTeamId ? store.teams.find((t) => t.id === s.homeTeamId) : null;
  return {
    ...s,
    idleFallbackMedia: null,
    homeTeamBranding: home
      ? {
          name: home.name,
          logoPath: home.logoPath,
          primaryColor: home.primaryColor,
          secondaryColor: home.secondaryColor,
        }
      : null,
  };
}

function sponsorById(sponsorId: string) {
  const sponsor = store.sponsors.find((s) => s.id === sponsorId);
  if (!sponsor) return null;
  return { ...sponsor, media: store.media.filter((m) => m.sponsorId === sponsorId) };
}

function parseBody(req: DesktopApiRequest) {
  if (!req.bodyText) return {};
  try {
    return JSON.parse(req.bodyText);
  } catch {
    return {};
  }
}

function handleApi(req: DesktopApiRequest): DesktopApiResponse {
  const method = req.method.toUpperCase();
  const url = new URL(`http://desktop${req.path}${req.search ?? ""}`);
  const pathname = url.pathname;
  const body = parseBody(req);

  if (pathname === "/api/app/release") return json(200, { version: "0.1.15", notes: "" });
  if (pathname === "/api/settings" && method === "GET") return json(200, settingsJson());
  if (pathname === "/api/settings" && method === "PATCH") {
    store.settings = { ...store.settings, ...body };
    if (body.uiLocale) {
      window.dispatchEvent(new CustomEvent("arenacue:ui-locale", { detail: body.uiLocale }));
    }
    touchDisplay();
    return json(200, settingsJson());
  }
  if (pathname === "/api/teams" && method === "GET") {
    return json(200, store.teams.map((t) => teamById(t.id)));
  }
  if (pathname === "/api/teams" && method === "POST") {
    const team = { id: id("t"), logoPath: null, secondaryColor: "#ffffff", ...body };
    store.teams.push(team);
    touchDisplay();
    return json(200, team);
  }
  const teamId = pathname.match(/^\/api\/teams\/([^/]+)$/)?.[1];
  if (teamId && method === "GET") {
    const team = teamById(teamId);
    return team ? json(200, team) : json(404, { error: "Not found" });
  }
  if (teamId && method === "PATCH") {
    store.teams = store.teams.map((t) => (t.id === teamId ? { ...t, ...body } : t));
    touchDisplay();
    return json(200, teamById(teamId));
  }
  if (teamId && method === "DELETE") {
    store.matches = store.matches.filter((m) => m.homeTeamId !== teamId && m.awayTeamId !== teamId);
    store.players = store.players.filter((p) => p.teamId !== teamId);
    store.teams = store.teams.filter((t) => t.id !== teamId);
    touchDisplay();
    return json(200, { ok: true });
  }

  if (pathname === "/api/players" && method === "GET") return json(200, store.players);
  if (pathname === "/api/players" && method === "POST") {
    const player = { id: id("p"), isCoach: false, photoPath: null, ...body };
    store.players.push(player);
    touchDisplay();
    return json(200, player);
  }
  const playerId = pathname.match(/^\/api\/players\/([^/]+)$/)?.[1];
  if (playerId && method === "PATCH") {
    store.players = store.players.map((p) => (p.id === playerId ? { ...p, ...body } : p));
    touchDisplay();
    return json(200, store.players.find((p) => p.id === playerId));
  }
  if (playerId && method === "DELETE") {
    store.players = store.players.filter((p) => p.id !== playerId);
    touchDisplay();
    return json(200, { ok: true });
  }

  if (pathname === "/api/matches" && method === "GET") {
    return json(
      200,
      store.matches
        .map((m) => ({ ...m, homeTeam: store.teams.find((t) => t.id === m.homeTeamId), awayTeam: store.teams.find((t) => t.id === m.awayTeamId) }))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    );
  }
  if (pathname === "/api/matches" && method === "POST") {
    const sport = normalizeSport(body.sport);
    const profile = getSportProfile(sport);
    const match = {
      id: id("m"),
      homeTeamId: body.homeTeamId,
      awayTeamId: body.awayTeamId,
      kickoffAt: body.kickoffAt ?? null,
      matchSponsorMediaId: body.matchSponsorMediaId ?? null,
      halfDurationSec: body.halfDurationSec ?? profile.defaultPeriodDurationSec,
      halfBreakSec: body.halfBreakSec ?? 900,
      sport,
      currentPeriod: 1,
      periodDurationSec: body.periodDurationSec ?? profile.defaultPeriodDurationSec,
      homeTimeouts: 0,
      awayTimeouts: 0,
      homeFouls: 0,
      awayFouls: 0,
      homeSets: 0,
      awaySets: 0,
      prematchSpreadWindowSec: body.prematchSpreadWindowSec ?? 0,
      status: "SETUP",
      homeScore: 0,
      awayScore: 0,
      homeFieldPlayerIdsJson: JSON.stringify(store.players.filter((p) => p.teamId === body.homeTeamId).slice(0, 11).map((p) => p.id)),
      awayFieldPlayerIdsJson: JSON.stringify(store.players.filter((p) => p.teamId === body.awayTeamId).slice(0, 11).map((p) => p.id)),
      createdAt: nowIso(),
      closedAt: null,
    };
    store.matches.unshift(match);
    touchDisplay();
    return json(200, matchById(match.id));
  }
  const matchId = pathname.match(/^\/api\/matches\/([^/]+)$/)?.[1];
  if (matchId && method === "GET") {
    const match = matchById(matchId);
    return match ? json(200, match) : json(404, { error: "Not found" });
  }
  if (matchId && method === "PATCH") {
    store.matches = store.matches.map((m) => (m.id === matchId ? { ...m, ...body } : m));
    touchDisplay();
    return json(200, matchById(matchId));
  }
  if (matchId && method === "DELETE") {
    store.matches = store.matches.filter((m) => m.id !== matchId);
    if (store.display.matchId === matchId) store.display.matchId = null;
    touchDisplay();
    return json(200, { ok: true });
  }

  if (pathname === "/api/sponsors" && method === "GET") {
    return json(200, store.sponsors.map((s) => sponsorById(s.id)));
  }
  if (pathname === "/api/sponsors" && method === "POST") {
    const sponsor = {
      id: id("s"),
      active: true,
      prematchSeconds: 0,
      matchSeconds: 0,
      matchFirstHalfSeconds: 0,
      matchSecondHalfSeconds: 0,
      halftimeSeconds: 0,
      postmatchSeconds: 0,
      imageDefaultSec: 10,
      createdAt: nowIso(),
      ...body,
    };
    store.sponsors.push(sponsor);
    touchDisplay();
    return json(200, sponsor);
  }
  const sponsorId = pathname.match(/^\/api\/sponsors\/([^/]+)$/)?.[1];
  if (sponsorId && method === "GET") {
    const sponsor = sponsorById(sponsorId);
    return sponsor ? json(200, sponsor) : json(404, { error: "Not found" });
  }
  if (sponsorId && method === "PATCH") {
    store.sponsors = store.sponsors.map((s) => (s.id === sponsorId ? { ...s, ...body } : s));
    touchDisplay();
    return json(200, sponsorById(sponsorId));
  }
  if (sponsorId && method === "DELETE") {
    store.sponsors = store.sponsors.filter((s) => s.id !== sponsorId);
    touchDisplay();
    return json(200, { ok: true });
  }

  if (pathname === "/api/media" && method === "GET") return json(200, store.media.filter((m) => !m.hideFromLibrary));
  if (pathname === "/api/media" && method === "POST") {
    const item = { id: id("md"), active: true, playAudio: false, hideFromLibrary: false, quickLaunch: false, createdAt: nowIso(), durationSec: 10, ...body };
    store.media.push(item);
    touchDisplay();
    return json(200, item);
  }
  const mediaId = pathname.match(/^\/api\/media\/([^/]+)$/)?.[1];
  if (mediaId && method === "GET") {
    const item = store.media.find((m) => m.id === mediaId);
    return item ? json(200, item) : json(404, { error: "Not found" });
  }
  if (mediaId && method === "PATCH") {
    store.media = store.media.map((m) => (m.id === mediaId ? { ...m, ...body } : m));
    touchDisplay();
    return json(200, store.media.find((m) => m.id === mediaId));
  }
  if (mediaId && method === "DELETE") {
    store.media = store.media.filter((m) => m.id !== mediaId);
    store.playlistItems = store.playlistItems.filter((i) => i.mediaId !== mediaId);
    touchDisplay();
    return json(200, { ok: true });
  }
  if (pathname === "/api/playlists" && method === "GET") {
    return json(
      200,
      store.playlists.map((p) => ({
        ...p,
        items: store.playlistItems.filter((i) => i.playlistId === p.id).sort((a, b) => a.order - b.order),
      })),
    );
  }
  if (pathname === "/api/scheduled-media-cues" && method === "GET") return json(200, store.cues);
  if (pathname === "/api/scheduled-media-cues" && method === "POST") {
    const cue = { id: id("cue"), enabled: true, loop: false, createdAt: nowIso(), ...body };
    store.cues.push(cue);
    persist();
    return json(200, cue);
  }
  const scheduledCueId = pathname.match(/^\/api\/scheduled-media-cues\/([^/]+)$/)?.[1];
  if (scheduledCueId && method === "PATCH") {
    store.cues = store.cues.map((c) => (c.id === scheduledCueId ? { ...c, ...body } : c));
    persist();
    return json(200, { ok: true });
  }
  if (scheduledCueId && method === "DELETE") {
    store.cues = store.cues.filter((c) => c.id !== scheduledCueId);
    persist();
    return json(200, { ok: true });
  }
  if (pathname === "/api/scoreboard-templates" && method === "GET") return json(200, store.templates);
  if (pathname === "/api/scoreboard-templates" && method === "POST") {
    const template = {
      id: id("tpl"),
      isBuiltIn: false,
      sortIndex: store.templates.length,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...body,
    };
    store.templates.push(template);
    persist();
    return json(200, template);
  }
  const templateId = pathname.match(/^\/api\/scoreboard-templates\/([^/]+)$/)?.[1];
  if (templateId && method === "DELETE") {
    store.templates = store.templates.filter((t) => t.id !== templateId || t.isBuiltIn);
    persist();
    return json(200, { ok: true });
  }
  if (pathname === "/api/sponsor-plays" && method === "GET") return json(200, store.sponsorPlays);
  if (pathname === "/api/sponsor-plays/summary" && method === "GET") return json(200, []);
  if (pathname === "/api/players/bulk-visuals") return json(400, { error: "Bulk-upload is alleen in de Windows-app beschikbaar." });
  if (pathname === "/api/upload") return json(400, { error: "Upload is alleen in de Windows-app beschikbaar." });

  return json(404, { error: `Not found: ${method} ${pathname}` });
}

function handleCommand(raw: Command): CommandAck {
  const parsed = CommandSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  const cmd = parsed.data;
  const display = store.display;
  const match = display.matchId ? store.matches.find((m) => m.id === display.matchId) : null;

  const updateMatch = (patch: Record<string, unknown>) => {
    if (!match) return;
    Object.assign(match, patch);
  };

  try {
    switch (cmd.type) {
      case "timer:start": {
        const elapsed = computeElapsedSeconds(display);
        Object.assign(display, runFrom(elapsed));
        break;
      }
      case "timer:pause": {
        const elapsed = computeElapsedSeconds(display);
        Object.assign(display, stopAt(elapsed));
        if (display.shotClockRunning) Object.assign(display, pauseShotClockAt(computeShotClockSeconds(display)));
        break;
      }
      case "timer:adjust": {
        const elapsed = computeElapsedSeconds(display);
        const target = Math.max(0, Math.floor(elapsed + cmd.deltaSec));
        Object.assign(display, display.timerRunning ? runFrom(target) : stopAt(target));
        break;
      }
      case "timer:set": {
        Object.assign(display, display.timerRunning ? runFrom(cmd.seconds) : stopAt(cmd.seconds));
        break;
      }
      case "timer:preset": {
        const presets = {
          FIRST_HALF: { sec: 0, status: "FIRST_HALF" },
          SECOND_HALF: { sec: 45 * 60, status: "SECOND_HALF" },
          ET1: { sec: 90 * 60, status: "EXTRA_TIME" },
          ET2: { sec: 105 * 60, status: "EXTRA_TIME" },
        };
        const p = presets[cmd.preset];
        Object.assign(display, stopAt(p.sec), { addedTimeMinutes: 0 });
        updateMatch({ status: p.status });
        break;
      }
      case "timer:setAddedTime":
        display.addedTimeMinutes = cmd.minutes;
        break;
      case "shotclock:start": {
        const profile = getSportProfile(match?.sport);
        const remaining = computeShotClockSeconds(display);
        Object.assign(display, runShotClockFrom(remaining > 0 ? remaining : profile.shotClockPresets[0] ?? 24));
        break;
      }
      case "shotclock:pause":
        Object.assign(display, pauseShotClockAt(computeShotClockSeconds(display)));
        break;
      case "shotclock:reset": {
        const profile = getSportProfile(match?.sport);
        const seconds = cmd.seconds ?? profile.shotClockPresets[0] ?? 24;
        Object.assign(display, display.shotClockRunning ? runShotClockFrom(seconds) : pauseShotClockAt(seconds));
        break;
      }
      case "shotclock:set":
        Object.assign(display, display.shotClockRunning ? runShotClockFrom(cmd.seconds) : pauseShotClockAt(cmd.seconds));
        break;
      case "match:setActive":
        display.matchId = cmd.matchId;
        display.addedTimeMinutes = 0;
        break;
      case "match:setStatus":
        updateMatch({ status: cmd.status });
        if (cmd.status === "HALF_TIME" || cmd.status === "FULL_TIME" || cmd.status === "POST_MATCH") {
          Object.assign(display, stopAt(computeElapsedSeconds(display)));
        }
        {
          const isPostMatch = cmd.status === "FULL_TIME" || cmd.status === "POST_MATCH";
          const isPrematch = cmd.status === "SETUP" || cmd.status === "PREMATCH";
          Object.assign(display, {
            postMatchStartedAt: isPostMatch ? (display.postMatchStartedAt ?? nowIso()) : null,
            preMatchStartedAt: isPrematch ? (display.preMatchStartedAt ?? nowIso()) : null,
          });
        }
        break;
      case "sport:setPeriod": {
        if (!match) throw new Error("No active match");
        const sport = normalizeSport(match.sport);
        const profile = getSportProfile(sport);
        updateMatch({
          currentPeriod: cmd.period,
          status: lifecycleStatusForPeriod(sport, cmd.period),
          ...(resetTimeoutsForNewPeriod(sport, match.currentPeriod, cmd.period) ? { homeTimeouts: 0, awayTimeouts: 0 } : {}),
          ...(resetStatsForNewPeriod(sport) ? { homeFouls: 0, awayFouls: 0 } : {}),
        });
        Object.assign(display, stopAt(profile.timerMode === "COUNT_UP" ? Math.max(0, (cmd.period - 1) * match.periodDurationSec) : 0), {
          mode: "MATCH",
          addedTimeMinutes: 0,
        });
        break;
      }
      case "sport:statAdjust": {
        if (!match) throw new Error("No active match");
        const col =
          cmd.stat === "timeout"
            ? cmd.side === "home"
              ? "homeTimeouts"
              : "awayTimeouts"
            : cmd.stat === "foul"
              ? cmd.side === "home"
                ? "homeFouls"
                : "awayFouls"
              : cmd.side === "home"
                ? "homeSets"
                : "awaySets";
        updateMatch({ [col]: Math.max(0, (match[col] ?? 0) + cmd.delta) });
        break;
      }
      case "score:set":
        updateMatch({ homeScore: cmd.homeScore, awayScore: cmd.awayScore });
        break;
      case "score:adjust":
        if (!match) throw new Error("No active match");
        if (cmd.side === "home") updateMatch({ homeScore: Math.max(0, match.homeScore + cmd.delta) });
        else updateMatch({ awayScore: Math.max(0, match.awayScore + cmd.delta) });
        break;
      case "display:setMode":
        display.mode = cmd.mode;
        display.activePlayerId = cmd.meta?.activePlayerId ?? null;
        display.activeMediaId = cmd.meta?.activeMediaId ?? null;
        break;
      case "display:blackout":
        if (display.mode === "BLACKOUT") {
          display.mode = display.blackoutResumeMode ?? "MATCH";
          display.blackoutResumeMode = null;
        } else {
          display.blackoutResumeMode = display.mode;
          display.mode = "BLACKOUT";
        }
        break;
      case "display:setSafeMode":
        display.safeMode = false;
        break;
      case "display:requestSnapshot":
        break;
      case "goal:prepare":
        display.mode = "GOAL_INTRO_VIDEO";
        display.activeGoalScorerId = null;
        break;
      case "goal:cancel":
        display.mode = "SPONSOR_ROTATION";
        display.activeMediaId = null;
        display.activeGoalScorerId = null;
        break;
      case "goal:trigger":
        if (match) {
          const teamId = cmd.side === "home" ? match.homeTeamId : match.awayTeamId;
          if (cmd.side === "home") updateMatch({ homeScore: match.homeScore + 1 });
          if (cmd.side === "away") updateMatch({ awayScore: match.awayScore + 1 });
          store.events.push({
            id: id("e"),
            matchId: match.id,
            type: "GOAL",
            minute: Math.floor(computeElapsedSeconds(display) / 60),
            addedTime: 0,
            teamId,
            playerInId: cmd.scorerId ?? null,
            playerOutId: cmd.assistId ?? null,
            note: null,
            createdAt: nowIso(),
          });
        }
        display.mode = "GOAL";
        display.activeGoalScorerId = cmd.scorerId ?? null;
        display.activeMediaId = null;
        break;
      case "sub:trigger":
      case "sub:triggerBatch": {
        const pairs = cmd.type === "sub:trigger" ? [{ teamId: cmd.teamId, playerOutId: cmd.playerOutId, playerInId: cmd.playerInId }] : cmd.substitutions;
        const first = pairs[0];
        if (match && first) {
          const fieldKey = first.teamId === match.homeTeamId ? "homeFieldPlayerIdsJson" : "awayFieldPlayerIdsJson";
          const current = match[fieldKey] ? (JSON.parse(match[fieldKey]) as string[]) : [];
          const next = current.filter((pid) => pid !== first.playerOutId);
          if (!next.includes(first.playerInId)) next.push(first.playerInId);
          updateMatch({ [fieldKey]: JSON.stringify(next) });
          store.events.push({
            id: id("e"),
            matchId: match.id,
            type: "SUB",
            minute: Math.floor(computeElapsedSeconds(display) / 60),
            addedTime: 0,
            teamId: first.teamId,
            playerInId: first.playerInId,
            playerOutId: first.playerOutId,
            note: null,
            createdAt: nowIso(),
          });
        }
        display.mode = "SUBSTITUTION";
        display.activeSubOutId = first?.playerOutId ?? null;
        display.activeSubInId = first?.playerInId ?? null;
        display.substitutionQueueJson = JSON.stringify(pairs.slice(1));
        break;
      }
      case "sub:queueAdvance": {
        const queue = JSON.parse(display.substitutionQueueJson || "[]") as Array<{
          teamId: string;
          playerOutId: string;
          playerInId: string;
        }>;
        const next = queue[0];
        if (!next) {
          display.mode = "SPONSOR_ROTATION";
          display.activeSubInId = null;
          display.activeSubOutId = null;
          display.substitutionQueueJson = "[]";
          break;
        }
        display.mode = "SUBSTITUTION";
        display.activeSubOutId = next.playerOutId;
        display.activeSubInId = next.playerInId;
        display.substitutionQueueJson = JSON.stringify(queue.slice(1));
        break;
      }
      case "card:trigger":
        if (match) {
          store.events.push({
            id: id("e"),
            matchId: match.id,
            type: cmd.color === "YELLOW" ? "CARD_YELLOW" : "CARD_RED",
            minute: Math.floor(computeElapsedSeconds(display) / 60),
            addedTime: 0,
            teamId: cmd.teamId,
            playerInId: cmd.playerId,
            playerOutId: null,
            note: null,
            createdAt: nowIso(),
          });
        }
        display.mode = "CARD";
        display.activePlayerId = cmd.playerId;
        break;
      case "display:setExternalCapture":
        display.externalCaptureSourceId = cmd.sourceId;
        if (cmd.sourceId === null) display.externalCaptureToDisplay = false;
        break;
      case "display:setExternalCaptureToDisplay":
        display.externalCaptureToDisplay = cmd.enabled;
        break;
      case "event:undo": {
        const event = store.events.find((e) => e.id === cmd.eventId);
        if (event && match && event.type === "GOAL") {
          if (event.teamId === match.homeTeamId) updateMatch({ homeScore: Math.max(0, match.homeScore - 1) });
          if (event.teamId === match.awayTeamId) updateMatch({ awayScore: Math.max(0, match.awayScore - 1) });
        }
        store.events = store.events.filter((e) => e.id !== cmd.eventId);
        break;
      }
      default:
        break;
    }
    touchDisplay();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function tickPayload(): TickPayload {
  const d = store.display;
  return {
    elapsed: computeElapsedSeconds(d),
    running: Boolean(d.timerRunning),
    startedAt: d.timerStartedAt,
    baseSec: d.timerBaseSec,
    serverNow: Date.now(),
  };
}

export function installWebDemoBridge() {
  const bridge: ElectronBridge = {
    context: { isElectron: true, appRoot: "", userDataDir: "", uploadsDir: "" },
    selectFile: async () => ({ canceled: true, filePaths: [] }),
    selectFolder: async () => ({ canceled: true, folderPath: null, files: [] }),
    apiRequest: async (req) => handleApi(req),
    sendCommand: async (cmd) => handleCommand(cmd),
    getDisplaySnapshot: async () => serializeDisplay(),
    onDisplayState: (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    onTick: (listener) => {
      tickListeners.add(listener);
      return () => tickListeners.delete(listener);
    },
    onSponsorLedger: () => () => undefined,
    onDisplayError: () => () => undefined,
    focusDisplayWindow: async () => undefined,
    reloadDisplayWindow: async () => ({ ok: true }),
    saveProofOfPlayExport: async () => ({ canceled: true }),
    exportMatch: async () => ({ canceled: true }),
    getDesktopCaptureSources: async () => [],
    reportSponsorClipStart: async () => ({ ok: true }),
    reportSponsorClipEnd: async () => ({ ok: true }),
    reportSponsorClipProgress: async () => ({ ok: true }),
    getSponsorLedgerSnapshot: async () => null,
    getAppVersion: async () => "0.1.15-web",
    openExternalUrl: async (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
      return { ok: true };
    },
    licenseGetStatus: async () => ({
      gate: false,
      organizationLabel: "ArenaCue web demo",
      plan: "pro",
      planLabel: "Pro",
      features: {
        automatic_sponsor_rotation: true,
        proof_of_play_export: true,
        sponsor_budget_tracking: true,
        sponsor_interrupt_resume: true,
      },
    }),
    licenseActivate: async () => ({ ok: true, organizationLabel: "ArenaCue web demo", status: "already_activated" }),
    getStreamDeckInfo: async () => null,
    getMobileBridgeInfo: async () => ({
      enabled: false,
      port: null,
      pairingCode: null,
      operatorPin: null,
      bridgeUrls: [],
      pairCodes: [],
      pairCodesOperator: [],
      operatorPinConfigured: false,
      cloud: { enabled: false, baseUrl: null, venueId: null, pairCode: null },
    }),
    getAppResourceMetrics: async () => ({
      cpuNonGpuPercent: 0,
      gpuCpuPercent: 0,
      ramTotalMb: 0,
      gpuRamMb: 0,
      cpuTotalPercent: 0,
    }),
    exportVenueBackup: async () => ({ ok: false, canceled: true }),
    getMatchTabLayoutSnapshot: () => window.localStorage.getItem("arenacue_match_tab_layout"),
    persistMatchTabLayout: (value) => window.localStorage.setItem("arenacue_match_tab_layout", value),
    reportDisplayPlaybackContext: () => undefined,
    reportDisplayMediaDiagnostic: () => undefined,
    getLivestreamSettings: async () => ({ ...webLivestreamSettings }),
    saveLivestreamSettings: async (partial) => {
      webLivestreamSettings = mergeLivestreamSettings({ ...webLivestreamSettings, ...partial });
      return webLivestreamSettings;
    },
    getLivestreamStatus: async () => ({ ...DEFAULT_LIVESTREAM_STATUS }),
    startLivestream: async () => ({
      ...DEFAULT_LIVESTREAM_STATUS,
      error: "Alleen in de desktop-app",
    }),
    stopLivestream: async () => ({ ...DEFAULT_LIVESTREAM_STATUS }),
    startLivestreamRecord: async () => ({
      ...DEFAULT_LIVESTREAM_STATUS,
      error: "Alleen in de desktop-app",
    }),
    stopLivestreamRecord: async () => ({ ...DEFAULT_LIVESTREAM_STATUS }),
    listLivestreamCameras: async () => [],
    listLivestreamAudioDevices: async () => [],
    listLivestreamAudioOutputs: async () => [],
    openLivestreamBrowserInteract: async () => ({ ok: false, error: "Alleen in de desktop-app" }),
    onLivestreamStatus: () => () => undefined,
    onLivestreamSettings: () => () => undefined,
    onLivestreamPreview: () => () => undefined,
    onLivestreamAudioMeters: () => () => undefined,
    onLivestreamReadyRequest: () => () => undefined,
    reportStreamProgramReady: () => undefined,
  };

  window.electronAPI = bridge;

  window.setInterval(() => {
    const tick = tickPayload();
    tickListeners.forEach((fn) => fn(tick));
  }, 250);
}
