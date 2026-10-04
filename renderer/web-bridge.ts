import { computeElapsedSeconds, computeShotClockSeconds, pauseShotClockAt, presentShotClock, runFrom, stopAt, suppressShotClock } from "@/lib/timer";
import { getSportProfile, lifecycleStatusForPeriod, newShotClockSuppressed, normalizeSport, resetStatsForNewPeriod, resetTimeoutsForNewPeriod, sportClockSeconds } from "@/lib/sports";
import { normalizeVolleyballMatchRules } from "@/lib/volleyball";
import { uiLocaleFromSearch } from "@/lib/i18n/locales";
import { DEFAULT_LIVESTREAM_SETTINGS, DEFAULT_LIVESTREAM_STATUS, mergeLivestreamSettings } from "@/lib/livestream";
import { CommandSchema, type Command } from "@/lib/validation/commands";
import { captureOnBlackoutEnter, captureOnBlackoutExit } from "@/lib/external-capture-blackout";
import { displayExtrasFromJson, serializeDisplayExtras } from "@/lib/display-extras";
import { applyTemplateToThemeJson, builtInTemplateRows, sanitizeTemplateThemeJson } from "@/lib/scoreboard-templates";
import type { CommandAck, DesktopApiRequest, DesktopApiResponse, ElectronBridge, TickPayload } from "@/lib/desktop-bridge";
import type { SerializedDisplayState } from "@/lib/timer";

const CHANNEL = "arenacue-web-scoreboard";
const STORAGE_KEY = "arenacue_web_scoreboard_v5";
/** Versie van de app waaruit deze demo gebouwd is; de build vult ze in. */
declare const __APP_VERSION__: string | undefined;
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
/** In de demo staat de wedstrijd altijd zo lang vóór de start, zodat de aftelklok te zien is. */
const DEMO_KICKOFF_LEAD_MS = 25 * 60_000;

/** Zinnen die de bezoeker met één klik als mededeling kan tonen. */
const DEMO_ANNOUNCEMENTS: Record<string, string[]> = {
  nl: ["Welkom in ons stadion", "Auto 1-ABC-123 staat voor de nooduitgang"],
  en: ["Welcome to our stadium", "Car 1-ABC-123 is blocking the emergency exit"],
  fr: ["Bienvenue dans notre stade", "La voiture 1-ABC-123 bloque la sortie de secours"],
  it: ["Benvenuti nel nostro stadio", "L’auto 1-ABC-123 blocca l’uscita di emergenza"],
};
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
  /** "Probeer op scherm": tijdelijk, niet opgeslagen in de indeling. */
  themePreview?: { json: string; until: number } | null;
};

/** Verzonnen namen; ze verwijzen naar geen enkele echte club of speler. Rugnummer = plaats in de lijst. */
const DEMO_HOME_SQUAD: Array<[string, string]> = [
  ["Lars", "Peeters"],
  ["Milan", "Claes"],
  ["Jonas", "Maes"],
  ["Ruben", "Willems"],
  ["Stijn", "Goossens"],
  ["Tibo", "Jacobs"],
  ["Arne", "Mertens"],
  ["Wout", "Hermans"],
  ["Nathan", "Wouters"],
  ["Senne", "Dubois"],
  ["Kobe", "Lemmens"],
];
const DEMO_AWAY_SQUAD: Array<[string, string]> = [
  ["Tom", "Verbeek"],
  ["Daan", "Smits"],
  ["Luuk", "Bakker"],
  ["Finn", "de Graaf"],
  ["Sem", "Visser"],
  ["Jesse", "Mulder"],
  ["Bram", "Dekker"],
  ["Thijs", "Bos"],
  ["Noah", "Vos"],
  ["Levi", "Hendriks"],
  ["Mats", "Kok"],
];

function seed(): Store {
  const homeId = id("t");
  const awayId = id("t");
  const matchId = id("m");
  const voltId = id("s");
  const worksId = id("s");
  const voltMediaId = id("md");
  const worksMediaId = id("md");
  const createdAt = nowIso();
  const homePlayers = DEMO_HOME_SQUAD.map(([firstName, lastName], i) => ({
    id: id("p"),
    teamId: homeId,
    number: i + 1,
    firstName,
    lastName,
    position: i === 0 ? "GK" : i < 5 ? "DEF" : i < 9 ? "MID" : "FWD",
    photoPath: null,
    isCoach: false,
    goalMediaId: null,
    goalVideoPath: null,
    subImagePath: null,
    lineupVideoPath: null,
  }));
  const awayPlayers = DEMO_AWAY_SQUAD.map(([firstName, lastName], i) => ({
    id: id("p"),
    teamId: awayId,
    number: i + 1,
    firstName,
    lastName,
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
      { id: homeId, name: "Arena FC", shortName: "AFC", logoPath: "/uploads/demo-arena-fc.svg", primaryColor: "#1e40af", secondaryColor: "#fbbf24" },
      { id: awayId, name: "Sporting United", shortName: "SPU", logoPath: "/uploads/demo-sporting-united.svg", primaryColor: "#b91c1c", secondaryColor: "#ffffff" },
    ],
    players: [...homePlayers, ...awayPlayers],
    matches: [
      {
        id: matchId,
        homeTeamId: homeId,
        awayTeamId: awayId,
        kickoffAt: new Date(Date.now() + DEMO_KICKOFF_LEAD_MS).toISOString(),
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
      displayExtrasJson: serializeDisplayExtras(
        displayExtrasFromJson(
          JSON.stringify({
            kickoffCountdown: { enabled: true, leadMinutes: 60, position: "top-right" },
            announcement: {
              presets: DEMO_ANNOUNCEMENTS[uiLocaleFromSearch(window.location.search) ?? "nl"] ?? DEMO_ANNOUNCEMENTS.nl,
            },
          }),
        ),
      ),
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
      externalCaptureAudio: false,
      safeMode: false,
      blackoutResumeMode: null,
      blackoutResumeCapture: false,
      preferSponsorRotation: true,
      liveWallCueBlock: null,
      liveWallCueOrigin: null,
      liveWallCueFrozenSec: 0,
      preMatchStartedAt: null,
      postMatchStartedAt: null,
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

/** Zelfde gedrag als de desktop-app na een herstart, plus een aftrap die in de demo nooit voorbij is. */
function refreshDemoStore() {
  const extras = displayExtrasFromJson(store.settings?.displayExtrasJson);
  if (extras.announcement.active) {
    store.settings = {
      ...store.settings,
      displayExtrasJson: serializeDisplayExtras({
        ...extras,
        announcement: { ...extras.announcement, active: false, until: null },
      }),
    };
  }
  if (store.themePreview && store.themePreview.until <= Date.now()) store.themePreview = null;
  const soon = Date.now() + 5 * 60_000;
  store.matches = store.matches.map((match) => {
    if (match.closedAt || (match.status !== "SETUP" && match.status !== "PREMATCH")) return match;
    const at = match.kickoffAt ? new Date(match.kickoffAt).getTime() : 0;
    return at > soon ? match : { ...match, kickoffAt: new Date(Date.now() + DEMO_KICKOFF_LEAD_MS).toISOString() };
  });
}
refreshDemoStore();

/** Wekker die de proefweergave in dit tabblad beëindigt. */
let themePreviewTimer: number | null = null;

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
let sponsorPeriodBreakPending = false;

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
    liveWallCueOrigin: asIso(d.liveWallCueOrigin),
    postMatchStartedAt: asIso(d.postMatchStartedAt),
    preMatchStartedAt: asIso(d.preMatchStartedAt),
    updatedAt: asIso(d.updatedAt) ?? nowIso(),
    sponsorPeriodBreakPending,
  };
}

function touchDisplay(patch: Record<string, unknown> = {}) {
  store.display = { ...store.display, ...patch, updatedAt: nowIso() };
  persist();
  const snap = serializeDisplay();
  stateListeners.forEach((fn) => fn(snap));
  window.dispatchEvent(new CustomEvent(CHANNEL, { detail: snap }));
}

/**
 * Bedieningspaneel en stadionscherm staan in de demo in aparte tabbladen. De browser meldt een
 * wijziging van de opslag alleen aan de andere tabbladen, dus dit kan geen lus worden.
 */
function followOtherTabs() {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      store = JSON.parse(event.newValue) as Store;
    } catch {
      return;
    }
    const snap = serializeDisplay();
    stateListeners.forEach((fn) => fn(snap));
    window.dispatchEvent(new CustomEvent(CHANNEL, { detail: snap }));
  });
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
  const preview = store.themePreview && store.themePreview.until > Date.now() ? store.themePreview : null;
  return {
    ...s,
    scoreboardThemePreviewJson: preview?.json ?? null,
    scoreboardThemePreviewUntil: preview?.until ?? null,
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

function clearThemePreview() {
  if (themePreviewTimer != null) window.clearTimeout(themePreviewTimer);
  themePreviewTimer = null;
  store.themePreview = null;
}

/** Meegeleverde indelingen plus wat de bezoeker zelf bewaarde. */
function templateList() {
  return [...builtInTemplateRows(), ...store.templates.filter((t) => !t.isBuiltIn)];
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

  if (pathname === "/api/app/release") return json(200, { version: APP_VERSION, notes: "" });
  if (pathname === "/api/settings" && method === "GET") return json(200, settingsJson());
  if (pathname === "/api/settings" && method === "PATCH") {
    const patch = { ...body };
    if (typeof patch.displayExtrasJson === "string") {
      patch.displayExtrasJson = serializeDisplayExtras(displayExtrasFromJson(patch.displayExtrasJson));
    }
    // Opslaan beëindigt een lopende proef: het scherm toont dan wat opgeslagen is.
    if ("scoreboardThemeJson" in patch) clearThemePreview();
    store.settings = { ...store.settings, ...patch };
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
    const volleyRules = normalizeVolleyballMatchRules({
      setsToWin: body.setsToWin,
      pointsToWinSet: body.pointsToWinSet,
      pointsToWinDecider: body.pointsToWinDecider,
      winBy: body.winBy,
      technicalTimeoutsEnabled: body.technicalTimeoutsEnabled === true,
      technicalTimeoutScores: body.technicalTimeoutScores,
      technicalTimeoutScoresJson: body.technicalTimeoutScoresJson,
      technicalTimeoutDurationSec: body.technicalTimeoutDurationSec,
      timeoutsPerSet: body.timeoutsPerSet,
      timeoutDurationSec: body.timeoutDurationSec,
      setBreakSec: body.halfBreakSec,
    });
    const match = {
      id: id("m"),
      homeTeamId: body.homeTeamId,
      awayTeamId: body.awayTeamId,
      kickoffAt: body.kickoffAt ?? null,
      matchSponsorMediaId: body.matchSponsorMediaId ?? null,
      halfDurationSec: body.halfDurationSec ?? profile.defaultPeriodDurationSec,
      halfBreakSec: body.halfBreakSec ?? (profile.hasSets ? volleyRules.setBreakSec : profile.breakDurationSec),
      sport,
      currentPeriod: 1,
      periodDurationSec: body.periodDurationSec ?? profile.defaultPeriodDurationSec,
      homeTimeouts: 0,
      awayTimeouts: 0,
      homeFouls: 0,
      awayFouls: 0,
      homeSets: 0,
      awaySets: 0,
      servingSide: profile.hasSets ? (body.servingSide === "away" ? "away" : "home") : null,
      setFirstServer: profile.hasSets ? (body.servingSide === "away" ? "away" : "home") : null,
      setHistoryJson: profile.hasSets ? "[]" : null,
      setsToWin: volleyRules.setsToWin,
      pointsToWinSet: volleyRules.pointsToWinSet,
      pointsToWinDecider: volleyRules.pointsToWinDecider,
      winBy: volleyRules.winBy,
      technicalTimeoutsEnabled: profile.hasSets && volleyRules.technicalTimeoutsEnabled,
      technicalTimeoutScoresJson: JSON.stringify(volleyRules.technicalTimeoutScores),
      technicalTimeoutDurationSec: volleyRules.technicalTimeoutDurationSec,
      timeoutsPerSet: volleyRules.timeoutsPerSet,
      timeoutDurationSec: volleyRules.timeoutDurationSec,
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
  if (pathname === "/api/display/theme-preview" && method === "POST") {
    const themeJson = typeof body.themeJson === "string" ? body.themeJson : "";
    if (!themeJson) return json(400, { error: "Ongeldige indeling." });
    const seconds = Math.min(300, Math.max(5, Math.round(Number(body.seconds) || 60)));
    clearThemePreview();
    const until = Date.now() + seconds * 1000;
    themePreviewTimer = window.setTimeout(() => {
      clearThemePreview();
      touchDisplay();
    }, seconds * 1000);
    store.themePreview = { json: themeJson, until };
    touchDisplay();
    return json(200, { ok: true, until });
  }
  if (pathname === "/api/display/theme-preview" && method === "DELETE") {
    clearThemePreview();
    touchDisplay();
    return json(200, { ok: true });
  }

  if (pathname === "/api/scoreboard-templates" && method === "GET") return json(200, templateList());
  if (pathname === "/api/scoreboard-templates" && method === "POST") {
    const name = String(body.name ?? "").trim().slice(0, 80);
    if (!name) return json(400, { error: "Naam is verplicht." });
    const template = {
      id: id("tpl"),
      name,
      label: typeof body.label === "string" ? body.label.trim().slice(0, 80) || null : null,
      themeJson: sanitizeTemplateThemeJson(body.themeJson),
      isBuiltIn: false,
      sortIndex: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.templates.push(template);
    persist();
    return json(200, template);
  }
  const applyId = pathname.match(/^\/api\/scoreboard-templates\/([^/]+)\/apply$/)?.[1];
  if (applyId && method === "POST") {
    const template = templateList().find((t) => t.id === applyId);
    if (!template) return json(404, { error: "Template niet gevonden." });
    const scoreboardThemeJson = applyTemplateToThemeJson(store.settings.scoreboardThemeJson, template.themeJson);
    store.settings = { ...store.settings, scoreboardThemeJson };
    clearThemePreview();
    touchDisplay();
    return json(200, { ok: true, scoreboardThemeJson });
  }
  const templateId = pathname.match(/^\/api\/scoreboard-templates\/([^/]+)$/)?.[1];
  if (templateId && method === "PATCH") {
    const existing = store.templates.find((t) => t.id === templateId && !t.isBuiltIn);
    if (!existing) return json(400, { error: "Meegeleverde templates zijn niet aanpasbaar — dupliceer ze." });
    const next = {
      ...existing,
      ...(typeof body.name === "string" && body.name.trim() ? { name: body.name.trim().slice(0, 80) } : {}),
      ...(body.label !== undefined ? { label: String(body.label ?? "").trim().slice(0, 80) || null } : {}),
      ...(body.themeJson !== undefined ? { themeJson: sanitizeTemplateThemeJson(body.themeJson) } : {}),
      updatedAt: nowIso(),
    };
    store.templates = store.templates.map((t) => (t.id === templateId ? next : t));
    // Een regel per sport of fase kan naar deze indeling verwijzen.
    touchDisplay();
    return json(200, next);
  }
  if (templateId && method === "DELETE") {
    store.templates = store.templates.filter((t) => t.id !== templateId || t.isBuiltIn);
    touchDisplay();
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
        if (match && (match.status === "FIRST_HALF" || match.status === "SECOND_HALF" || match.status === "EXTRA_TIME") && display.mode === "MATCH") {
          display.mode = display.preferSponsorRotation === false ? "MATCH" : "SPONSOR_ROTATION";
        }
        sponsorPeriodBreakPending = false;
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
        Object.assign(display, stopAt(p.sec), {
          addedTimeMinutes: 0,
          mode: display.preferSponsorRotation === false ? "MATCH" : "SPONSOR_ROTATION",
        });
        updateMatch({ status: p.status });
        sponsorPeriodBreakPending = false;
        break;
      }
      case "timer:setAddedTime":
        display.addedTimeMinutes = cmd.minutes;
        break;
      case "shotclock:start": {
        const profile = getSportProfile(match?.sport);
        const remaining = computeShotClockSeconds(display);
        const fresh = !!display.shotClockOff || remaining <= 0;
        const gameLeft = match
          ? sportClockSeconds(match.sport, computeElapsedSeconds(display), match.periodDurationSec, match.currentPeriod)
          : 999;
        if (fresh && newShotClockSuppressed(match?.sport, gameLeft)) {
          Object.assign(display, suppressShotClock());
          break;
        }
        Object.assign(display, presentShotClock(fresh ? profile.shotClockPresets[0] ?? 24 : remaining, true));
        break;
      }
      case "shotclock:pause":
        Object.assign(display, { ...pauseShotClockAt(computeShotClockSeconds(display)), shotClockOff: !!display.shotClockOff });
        break;
      case "shotclock:reset": {
        const profile = getSportProfile(match?.sport);
        const seconds = cmd.seconds ?? profile.shotClockPresets[0] ?? 24;
        const gameLeft = match
          ? sportClockSeconds(match.sport, computeElapsedSeconds(display), match.periodDurationSec, match.currentPeriod)
          : 999;
        if (newShotClockSuppressed(match?.sport, gameLeft)) {
          Object.assign(display, suppressShotClock());
          break;
        }
        Object.assign(display, presentShotClock(seconds, !!display.shotClockRunning));
        break;
      }
      case "shotclock:set":
        Object.assign(display, presentShotClock(cmd.seconds, !!display.shotClockRunning && cmd.seconds > 0));
        break;
      case "sport:setPossession":
        if (match && getSportProfile(match.sport).supportsPossessionArrow) {
          updateMatch({ possessionArrow: cmd.side });
        }
        break;
      case "match:setActive":
        display.matchId = cmd.matchId;
        display.addedTimeMinutes = 0;
        sponsorPeriodBreakPending = false;
        break;
      case "match:setStatus":
        updateMatch({ status: cmd.status });
        if (cmd.status === "HALF_TIME" || cmd.status === "FULL_TIME" || cmd.status === "POST_MATCH") {
          Object.assign(display, stopAt(computeElapsedSeconds(display)));
        }
        if (
          cmd.status === "FIRST_HALF" ||
          cmd.status === "SECOND_HALF" ||
          cmd.status === "EXTRA_TIME"
        ) {
          display.mode = display.preferSponsorRotation === false ? "MATCH" : "SPONSOR_ROTATION";
        } else if (
          cmd.status === "HALF_TIME" ||
          cmd.status === "PREMATCH" ||
          cmd.status === "SETUP" ||
          cmd.status === "FULL_TIME" ||
          cmd.status === "POST_MATCH"
        ) {
          display.mode = "MATCH";
        }
        if (
          cmd.status === "HALF_TIME" ||
          cmd.status === "PREMATCH" ||
          cmd.status === "SETUP" ||
          cmd.status === "FULL_TIME" ||
          cmd.status === "POST_MATCH"
        ) {
          sponsorPeriodBreakPending = false;
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
        const prevPeriod = match.currentPeriod;
        updateMatch({
          currentPeriod: cmd.period,
          status: lifecycleStatusForPeriod(sport, cmd.period),
          ...(resetTimeoutsForNewPeriod(sport, match.currentPeriod, cmd.period) ? { homeTimeouts: 0, awayTimeouts: 0 } : {}),
          ...(resetStatsForNewPeriod(sport, match.currentPeriod, cmd.period) ? { homeFouls: 0, awayFouls: 0 } : {}),
        });
        Object.assign(display, stopAt(profile.timerMode === "COUNT_UP" ? Math.max(0, (cmd.period - 1) * match.periodDurationSec) : 0), {
          mode: display.preferSponsorRotation === false ? "MATCH" : "SPONSOR_ROTATION",
          addedTimeMinutes: 0,
        });
        if (cmd.period !== prevPeriod && sport !== "FOOTBALL") {
          sponsorPeriodBreakPending = true;
        }
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
        if (cmd.meta?.persistSponsorPreference === true && (cmd.mode === "SPONSOR_ROTATION" || cmd.mode === "MATCH")) {
          display.preferSponsorRotation = cmd.mode === "SPONSOR_ROTATION";
        }
        break;
      case "display:blackout": {
        if (display.mode === "BLACKOUT") {
          display.mode = display.blackoutResumeMode ?? "MATCH";
          display.blackoutResumeMode = null;
          Object.assign(display, captureOnBlackoutExit(display));
        } else {
          display.blackoutResumeMode = display.mode;
          display.mode = "BLACKOUT";
          Object.assign(display, captureOnBlackoutEnter(display));
        }
        break;
      }
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
        display.mode = display.preferSponsorRotation === false ? "MATCH" : "SPONSOR_ROTATION";
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
        if (cmd.sourceId === null) {
          display.externalCaptureToDisplay = false;
          display.blackoutResumeCapture = false;
        }
        break;
      case "display:setExternalCaptureToDisplay":
        if (display.mode === "BLACKOUT") {
          display.blackoutResumeCapture = cmd.enabled;
        } else {
          display.externalCaptureToDisplay = cmd.enabled;
        }
        break;
      case "display:setExternalCaptureAudio":
        display.externalCaptureAudio = cmd.enabled;
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
    context: { isElectron: true, appRoot: "", userDataDir: "", uploadsDir: "", webDemo: true },
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
    // De demo heeft geen tweede venster: het stadionscherm opent in een eigen tabblad en loopt live mee.
    focusDisplayWindow: async () => {
      const url = new URL(window.location.href);
      url.searchParams.set("view", "display");
      window.open(url.toString(), "arenacue-demo-display");
    },
    reloadDisplayWindow: async () => ({ ok: true }),
    saveProofOfPlayExport: async () => ({ canceled: true }),
    exportMatch: async () => ({ canceled: true }),
    getDesktopCaptureSources: async () => [],
    reportSponsorClipStart: async () => ({ ok: true }),
    reportSponsorClipEnd: async () => ({ ok: true }),
    reportSponsorClipProgress: async () => ({ ok: true }),
    getSponsorLedgerSnapshot: async () => null,
    getAppVersion: async () => `${APP_VERSION}-web`,
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
    restoreVenueBackup: async () => ({ ok: false, canceled: true }),
    getMatchTabLayoutSnapshot: () => window.localStorage.getItem("arenacue_match_tab_layout"),
    persistMatchTabLayout: (value) => window.localStorage.setItem("arenacue_match_tab_layout", value),
    setDisplayPreviewCapture: () => undefined,
    onDisplayPreviewFrame: () => () => undefined,
    getDisplayPreviewCaptureIds: async () => null,
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
  followOtherTabs();

  window.setInterval(() => {
    const tick = tickPayload();
    tickListeners.forEach((fn) => fn(tick));
  }, 250);
}
