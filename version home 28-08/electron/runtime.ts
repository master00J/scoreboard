import type { BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";
import {
  computeElapsedSeconds,
  computeShotClockSeconds,
  pauseShotClockAt,
  serializeDisplayState,
} from "../lib/timer";
import { getSportProfile, normalizeSport } from "../lib/sports";
import { CommandSchema, type Command } from "../lib/validation/commands";
import type {
  CommandAck,
  DesktopApiRequest,
  DesktopApiResponse,
  ExportFormat,
  TickPayload,
} from "../lib/desktop-bridge";
import type {
  SponsorLedgerPayload,
  SponsorTelemetryClipEnd,
  SponsorTelemetryClipProgress,
  SponsorTelemetryClipStart,
} from "../lib/sponsor-telemetry";
import {
  applyTemplateToThemeJson,
  builtInTemplateRows,
  sanitizeTemplateThemeJson,
} from "../lib/scoreboard-templates";
import { handleCommand } from "../server/handlers";
import { ensureDefaultMatchFieldLineups } from "../server/match-lineup";
import { parsePlayerIdArrayJson } from "../lib/match-field-lineup";

type RuntimeOptions = {
  getControlWindow: () => BrowserWindow | null;
  getDisplayWindow: () => BrowserWindow | null;
  log: (line: string) => void;
  onUiLocaleChanged?: (locale: "nl" | "en" | "fr") => void;
};

let opts: RuntimeOptions | null = null;
let tickInterval: NodeJS.Timeout | null = null;

function requireOpts() {
  if (!opts) throw new Error("Desktop runtime is not initialized");
  return opts;
}

function windows() {
  const { getControlWindow, getDisplayWindow } = requireOpts();
  return [getControlWindow(), getDisplayWindow()].filter(
    (win): win is BrowserWindow => !!win && !win.isDestroyed(),
  );
}

function sendAll(channel: string, payload: unknown) {
  for (const win of windows()) {
    win.webContents.send(channel, payload);
  }
}

function sendControl(channel: string, payload: unknown) {
  const win = requireOpts().getControlWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

let sponsorLedgerSnapshot: SponsorLedgerPayload | null = null;
/**
 * Per clipSessionId de hoogste gerapporteerde werkelijke duur (sec, afgerond).
 * React Strict Mode kan een effect-cleanup direct na mount laten lopen met ~0s;
 * de echte clipEnd komt daarna met de juiste waarde — dan tellen we enkel het verschil
 * bij en overschrijven we proof-of-play niet meer met 0.
 */
const sponsorClipBestActualSec = new Map<string, number>();

export function getSponsorLedgerSnapshot(): SponsorLedgerPayload | null {
  return sponsorLedgerSnapshot;
}

function ensureSponsorLedger(matchId: string, segmentKey: string): SponsorLedgerPayload {
  const now = Date.now();
  if (
    !sponsorLedgerSnapshot ||
    sponsorLedgerSnapshot.matchId !== matchId ||
    sponsorLedgerSnapshot.segmentKey !== segmentKey
  ) {
    sponsorLedgerSnapshot = {
      matchId,
      segmentKey,
      bySponsorSec: {},
      activeClip: null,
      updatedAtMs: now,
    };
  }
  return sponsorLedgerSnapshot;
}

export function sponsorTelemetryClipStart(payload: SponsorTelemetryClipStart): SponsorLedgerPayload {
  const ledger = ensureSponsorLedger(payload.matchId, payload.segmentKey);
  const now = Date.now();
  ledger.activeClip = {
    sponsorId: payload.sponsorId,
    mediaId: payload.mediaId,
    startedAtMs: payload.startedAtMs,
    expectedPlaySec: payload.expectedPlaySec,
    clipSessionId: payload.clipSessionId,
    playbackPositionMs: payload.playbackPositionMs,
    paused: payload.paused,
  };
  ledger.updatedAtMs = now;
  sponsorLedgerSnapshot = ledger;
  sendAll("display:sponsorLedger", ledger);
  return ledger;
}

export function sponsorTelemetryClipProgress(
  payload: SponsorTelemetryClipProgress,
): SponsorLedgerPayload | null {
  const ledger = sponsorLedgerSnapshot;
  if (!ledger || ledger.matchId !== payload.matchId || ledger.segmentKey !== payload.segmentKey) {
    return null;
  }
  const ac = ledger.activeClip;
  if (!ac || ac.clipSessionId !== payload.clipSessionId) return null;
  if (payload.expectedPlaySec != null && payload.expectedPlaySec > (ac.expectedPlaySec || 0)) {
    ac.expectedPlaySec = payload.expectedPlaySec;
  }
  ac.playbackPositionMs = Math.max(0, payload.playbackPositionMs);
  if (payload.paused != null) ac.paused = payload.paused;
  if (payload.startedAtMs != null) ac.startedAtMs = payload.startedAtMs;
  ledger.updatedAtMs = Date.now();
  sponsorLedgerSnapshot = ledger;
  sendAll("display:sponsorLedger", ledger);
  return ledger;
}

export function sponsorTelemetryClipEnd(payload: SponsorTelemetryClipEnd): SponsorLedgerPayload {
  const sessionId = payload.clipSessionId;
  const rounded = Math.max(0, Math.round(payload.actualSec));
  const prevBest = sponsorClipBestActualSec.get(sessionId) ?? 0;
  const bestActual = Math.max(prevBest, rounded);
  const delta = bestActual - prevBest;
  sponsorClipBestActualSec.set(sessionId, bestActual);
  if (sponsorClipBestActualSec.size > 4000) {
    sponsorClipBestActualSec.clear();
  }

  const ledger = ensureSponsorLedger(payload.matchId, payload.segmentKey);
  if (delta > 0) {
    const prevSpent = ledger.bySponsorSec[payload.sponsorId] ?? 0;
    ledger.bySponsorSec[payload.sponsorId] = prevSpent + delta;
  }

  const ac = ledger.activeClip;
  let expectedSecForLog = 0;
  const clipMatches =
    ac &&
    ac.clipSessionId === sessionId &&
    ac.sponsorId === payload.sponsorId &&
    ac.mediaId === payload.mediaId;
  if (clipMatches) {
    expectedSecForLog = Math.max(0, Math.round(ac.expectedPlaySec || 0));
    if (payload.discard) {
      ledger.activeClip = null;
    }
    // Geen activeClip wissen op een spuriëne 0s-melding direct na mount (Strict Mode).
    // Wél wissen als er na enige tijd nog steeds 0s binnenkomt: anders blijft de HUD "Bezig"
    // terwijl het display al op scorebord-fallback staat.
    const startedMs = ac.startedAtMs;
    const allowStaleZeroClear =
      delta === 0 &&
      rounded === 0 &&
      prevBest === 0 &&
      Date.now() - startedMs >= 2000;
    if (delta > 0 || allowStaleZeroClear) {
      ledger.activeClip = null;
    }
  }

  ledger.updatedAtMs = Date.now();
  sponsorLedgerSnapshot = ledger;
  sendAll("display:sponsorLedger", ledger);

  if (payload.discard || bestActual <= 0) {
    return ledger;
  }

  // Proof-of-play: sla de beste bekende werkelijke duur op (monotoon stijgend).
  void persistSponsorPlayLog(payload, expectedSecForLog, bestActual).catch((err) => {
    console.warn("[runtime] kon proof-of-play niet opslaan", err);
  });

  return ledger;
}

async function persistSponsorPlayLog(
  payload: SponsorTelemetryClipEnd,
  expectedSec: number,
  bestActualSec: number,
): Promise<void> {
  const [sponsor, media, match] = await Promise.all([
    prisma.sponsor.findUnique({
      where: { id: payload.sponsorId },
      select: { name: true },
    }),
    prisma.mediaItem.findUnique({
      where: { id: payload.mediaId },
      select: { title: true, durationSec: true },
    }),
    prisma.match.findUnique({
      where: { id: payload.matchId },
      select: { status: true },
    }),
  ]);

  const expected =
    expectedSec > 0 ? expectedSec : (media?.durationSec ?? 0);
  const actual = Math.max(0, Math.round(bestActualSec));

  const existing = await prisma.sponsorPlayLog.findUnique({
    where: { clipSessionId: payload.clipSessionId },
    select: { actualSec: true },
  });

  if (!existing) {
    await prisma.sponsorPlayLog.create({
      data: {
        matchId: payload.matchId,
        sponsorId: payload.sponsorId,
        mediaId: payload.mediaId,
        sponsorName: sponsor?.name ?? "(verwijderd)",
        mediaTitle: media?.title ?? "(verwijderd)",
        segmentKey: payload.segmentKey,
        matchStatus: match?.status ?? null,
        expectedSec: expected,
        actualSec: actual,
        startedAt: new Date(payload.startedAtMs),
        endedAt: new Date(),
        clipSessionId: payload.clipSessionId,
      },
    });
    return;
  }

  await prisma.sponsorPlayLog.update({
    where: { clipSessionId: payload.clipSessionId },
    data: {
      actualSec: Math.max(existing.actualSec, actual),
      endedAt: new Date(),
    },
  });
}

function broadcastSponsorLedger() {
  sendAll("display:sponsorLedger", sponsorLedgerSnapshot);
}

/**
 * Wist de telemetrie-ledger volledig — bedoeld voor match-resets en fasewissels:
 * dan moet "schermtijd verbruikt" weer op 0 starten i.p.v. opgespaarde waarden tonen.
 */
export function resetSponsorLedger(): void {
  sponsorLedgerSnapshot = null;
  sponsorClipBestActualSec.clear();
  sendAll("display:sponsorLedger", null);
}

async function ensureSqliteSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS "Team" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "shortName" TEXT NOT NULL,
      "logoPath" TEXT,
      "primaryColor" TEXT NOT NULL,
      "secondaryColor" TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "Player" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "teamId" TEXT NOT NULL,
      "number" INTEGER NOT NULL,
      "firstName" TEXT NOT NULL,
      "lastName" TEXT NOT NULL,
      "position" TEXT,
      "photoPath" TEXT,
      "isCoach" BOOLEAN NOT NULL DEFAULT false,
      "goalMediaId" TEXT,
      CONSTRAINT "Player_teamId_fkey"
        FOREIGN KEY ("teamId") REFERENCES "Team" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS "Match" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "homeTeamId" TEXT NOT NULL,
      "awayTeamId" TEXT NOT NULL,
      "kickoffAt" DATETIME,
      "halfDurationSec" INTEGER NOT NULL DEFAULT 2700,
      "halfBreakSec" INTEGER NOT NULL DEFAULT 900,
      "status" TEXT NOT NULL DEFAULT 'SETUP',
      "homeScore" INTEGER NOT NULL DEFAULT 0,
      "awayScore" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Match_homeTeamId_fkey"
        FOREIGN KEY ("homeTeamId") REFERENCES "Team" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "Match_awayTeamId_fkey"
        FOREIGN KEY ("awayTeamId") REFERENCES "Team" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS "MatchEvent" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "matchId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "minute" INTEGER NOT NULL,
      "addedTime" INTEGER NOT NULL DEFAULT 0,
      "teamId" TEXT,
      "playerInId" TEXT,
      "playerOutId" TEXT,
      "note" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "MatchEvent_matchId_fkey"
        FOREIGN KEY ("matchId") REFERENCES "Match" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS "MediaItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "type" TEXT NOT NULL,
      "path" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "quickButtonLabel" TEXT,
      "durationSec" INTEGER NOT NULL,
      "sponsorName" TEXT,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS "Playlist" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "slot" TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Playlist_slot_key" ON "Playlist"("slot")`,
    `CREATE TABLE IF NOT EXISTS "PlaylistItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "playlistId" TEXT NOT NULL,
      "mediaId" TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      "durationOverrideSec" INTEGER,
      CONSTRAINT "PlaylistItem_playlistId_fkey"
        FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "PlaylistItem_mediaId_fkey"
        FOREIGN KEY ("mediaId") REFERENCES "MediaItem" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS "ScheduledMediaCue" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "mediaId" TEXT NOT NULL,
      "matchStatus" TEXT NOT NULL,
      "triggerSec" INTEGER NOT NULL,
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ScheduledMediaCue_mediaId_fkey"
        FOREIGN KEY ("mediaId") REFERENCES "MediaItem" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS "DisplayState" (
      "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
      "mode" TEXT NOT NULL DEFAULT 'IDLE',
      "matchId" TEXT,
      "activePlayerId" TEXT,
      "activeSubOutId" TEXT,
      "activeSubInId" TEXT,
      "activeGoalScorerId" TEXT,
      "activeMediaId" TEXT,
      "timerRunning" BOOLEAN NOT NULL DEFAULT false,
      "timerStartedAt" DATETIME,
      "timerBaseSec" INTEGER NOT NULL DEFAULT 0,
      "updatedAt" DATETIME NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "AppSettings" (
      "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
      "homeTeamId" TEXT
    )`,
  ];

  for (const sql of statements) {
    await prisma.$executeRawUnsafe(sql);
  }

  await addColumnIfMissing("Player", "goalVideoPath", "TEXT");
  await addColumnIfMissing("Player", "subImagePath", "TEXT");
  await addColumnIfMissing("Player", "lineupVideoPath", "TEXT");
  await addColumnIfMissing("AppSettings", "goalIntroVideoPath", "TEXT");
  await addColumnIfMissing("AppSettings", "goalVisualHomeEnabled", "BOOLEAN NOT NULL DEFAULT 1");
  await addColumnIfMissing("AppSettings", "goalVisualAwayEnabled", "BOOLEAN NOT NULL DEFAULT 0");
  await addColumnIfMissing("AppSettings", "matchLiveScoreboardSec", "INTEGER NOT NULL DEFAULT 45");
  await addColumnIfMissing("AppSettings", "matchLiveSponsorSec", "INTEGER NOT NULL DEFAULT 15");
  await addColumnIfMissing("AppSettings", "firstHalfScoreboardSec", "INTEGER NOT NULL DEFAULT 45");
  await addColumnIfMissing("AppSettings", "firstHalfSponsorSec", "INTEGER NOT NULL DEFAULT 15");
  await addColumnIfMissing("AppSettings", "halftimeScoreboardSec", "INTEGER NOT NULL DEFAULT 30");
  await addColumnIfMissing("AppSettings", "halftimeSponsorSec", "INTEGER NOT NULL DEFAULT 15");
  await addColumnIfMissing("AppSettings", "secondHalfScoreboardSec", "INTEGER NOT NULL DEFAULT 45");
  await addColumnIfMissing("AppSettings", "secondHalfSponsorSec", "INTEGER NOT NULL DEFAULT 15");
  await addColumnIfMissing("AppSettings", "liveCycleLegacyImported", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("AppSettings", "scoreboardThemeJson", "TEXT");
  await addColumnIfMissing("AppSettings", "proofOfPlayBrandJson", "TEXT");
  await addColumnIfMissing("AppSettings", "displayCanvasWidth", "INTEGER NOT NULL DEFAULT 1920");
  await addColumnIfMissing("AppSettings", "displayCanvasHeight", "INTEGER NOT NULL DEFAULT 1080");
  await addColumnIfMissing("AppSettings", "displayScalingMode", `TEXT NOT NULL DEFAULT 'cover'`);
  await addColumnIfMissing("AppSettings", "displaySafeZoneVisible", "BOOLEAN NOT NULL DEFAULT 0");
  await addColumnIfMissing("AppSettings", "displaySafeZoneMarginPx", "INTEGER NOT NULL DEFAULT 40");
  await addColumnIfMissing("AppSettings", "idleFallbackMediaId", "TEXT");
  await addColumnIfMissing("AppSettings", "uiLocale", `TEXT NOT NULL DEFAULT 'nl'`);
  await addColumnIfMissing("DisplayState", "externalCaptureSourceId", "TEXT");
  await addColumnIfMissing("DisplayState", "externalCaptureToDisplay", "BOOLEAN NOT NULL DEFAULT 0");
  await addColumnIfMissing("DisplayState", "safeMode", "BOOLEAN NOT NULL DEFAULT 0");
  await addColumnIfMissing("DisplayState", "blackoutResumeMode", "TEXT");
  await addColumnIfMissing("DisplayState", "addedTimeMinutes", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(
    "DisplayState",
    "substitutionQueueJson",
    `TEXT NOT NULL DEFAULT '[]'`,
  );

  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ScoreboardTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "label" TEXT,
    "themeJson" TEXT NOT NULL,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT 0,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Sponsor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "prematchSeconds" INTEGER NOT NULL DEFAULT 0,
    "matchSeconds" INTEGER NOT NULL DEFAULT 0,
    "halftimeSeconds" INTEGER NOT NULL DEFAULT 0,
    "imageDefaultSec" INTEGER NOT NULL DEFAULT 10,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await addColumnIfMissing("MediaItem", "sponsorId", "TEXT");
  await addColumnIfMissing("MediaItem", "quickButtonLabel", "TEXT");
  await addColumnIfMissing("MediaItem", "playAudio", "BOOLEAN NOT NULL DEFAULT 0");
  await addColumnIfMissing("MediaItem", "sponsorPhaseTagsJson", "TEXT");
  await addColumnIfMissing("MediaItem", "hideFromLibrary", "BOOLEAN NOT NULL DEFAULT 0");
  await addColumnIfMissing("Match", "homeFieldPlayerIdsJson", "TEXT");
  await addColumnIfMissing("Match", "awayFieldPlayerIdsJson", "TEXT");
  await addColumnIfMissing("Match", "matchSponsorMediaId", "TEXT");
  await addColumnIfMissing("Match", "closedAt", "DATETIME");
  await addColumnIfMissing("Match", "prematchSpreadWindowSec", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("Match", "sport", `TEXT NOT NULL DEFAULT 'FOOTBALL'`);
  await addColumnIfMissing("Match", "currentPeriod", "INTEGER NOT NULL DEFAULT 1");
  await addColumnIfMissing("Match", "periodDurationSec", "INTEGER NOT NULL DEFAULT 2700");
  await addColumnIfMissing("Match", "homeTimeouts", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("Match", "awayTimeouts", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("Match", "homeFouls", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("Match", "awayFouls", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("Match", "homeSets", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("Match", "awaySets", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("DisplayState", "shotClockRunning", "BOOLEAN NOT NULL DEFAULT 0");
  await addColumnIfMissing("DisplayState", "shotClockStartedAt", "DATETIME");
  await addColumnIfMissing("DisplayState", "shotClockBaseSec", "INTEGER NOT NULL DEFAULT 24");
  await addColumnIfMissing("Sponsor", "firstHalfScoreboardSec", "INTEGER");
  await addColumnIfMissing("Sponsor", "firstHalfSponsorSec", "INTEGER");
  await addColumnIfMissing("Sponsor", "halftimeScoreboardSec", "INTEGER");
  await addColumnIfMissing("Sponsor", "halftimeSponsorSec", "INTEGER");
  await addColumnIfMissing("Sponsor", "secondHalfScoreboardSec", "INTEGER");
  await addColumnIfMissing("Sponsor", "secondHalfSponsorSec", "INTEGER");
  await addColumnIfMissing("Sponsor", "matchFirstHalfSeconds", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("Sponsor", "matchSecondHalfSeconds", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("Sponsor", "postmatchSeconds", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("Sponsor", "sponsorPlaybackOrderJson", "TEXT");
  await addColumnIfMissing("Sponsor", "sponsorPlaybackRepeatsJson", "TEXT");
  await migrateSponsorMatchHalfFromLegacy();

  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SponsorPlayLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT,
    "sponsorId" TEXT,
    "mediaId" TEXT,
    "sponsorName" TEXT NOT NULL,
    "mediaTitle" TEXT NOT NULL,
    "segmentKey" TEXT NOT NULL,
    "matchStatus" TEXT,
    "expectedSec" INTEGER NOT NULL,
    "actualSec" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clipSessionId" TEXT NOT NULL,
    CONSTRAINT "SponsorPlayLog_matchId_fkey"
      FOREIGN KEY ("matchId") REFERENCES "Match" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SponsorPlayLog_sponsorId_fkey"
      FOREIGN KEY ("sponsorId") REFERENCES "Sponsor" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SponsorPlayLog_mediaId_fkey"
      FOREIGN KEY ("mediaId") REFERENCES "MediaItem" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE
  )`);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "SponsorPlayLog_clipSessionId_key" ON "SponsorPlayLog" ("clipSessionId")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "SponsorPlayLog_matchId_idx" ON "SponsorPlayLog" ("matchId")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "SponsorPlayLog_sponsorId_idx" ON "SponsorPlayLog" ("sponsorId")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "SponsorPlayLog_endedAt_idx" ON "SponsorPlayLog" ("endedAt")`,
  );
}

/** Eénmalig: oude enkelvoudige matchSeconds → 1e helft als nieuwe velden nog 0 zijn. */
async function migrateSponsorMatchHalfFromLegacy() {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "Sponsor" SET "matchFirstHalfSeconds" = "matchSeconds", "matchSecondHalfSeconds" = 0 WHERE "matchFirstHalfSeconds" = 0 AND "matchSecondHalfSeconds" = 0 AND "matchSeconds" > 0`,
    );
  } catch {
    /* tabel/kolom ontbreekt op oudere kopie */
  }
}

async function addColumnIfMissing(
  table: string,
  column: string,
  typeDecl: string,
) {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("${table}")`,
  );
  if (rows.some((r) => r.name === column)) return;
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "${table}" ADD COLUMN "${column}" ${typeDecl}`,
  );
}

/** Eénmalig oude matchLive*-kolommen naar per-fase velden kopiëren. */
async function migrateAppSettingsLiveCycleFromLegacy() {
  const cols = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("AppSettings")`,
  );
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("liveCycleLegacyImported")) return;

  const flagRows = await prisma.$queryRawUnsafe<Array<{ v: number | null }>>(
    `SELECT "liveCycleLegacyImported" AS v FROM "AppSettings" WHERE "id" = 1`,
  );
  if ((flagRows[0]?.v ?? 0) !== 0) return;

  if (!names.has("matchLiveScoreboardSec")) {
    await prisma.$executeRawUnsafe(
      `UPDATE "AppSettings" SET "liveCycleLegacyImported" = 1 WHERE "id" = 1`,
    );
    return;
  }

  await prisma.$executeRawUnsafe(`
    UPDATE "AppSettings" SET
      "firstHalfScoreboardSec" = COALESCE("matchLiveScoreboardSec", 45),
      "firstHalfSponsorSec" = COALESCE("matchLiveSponsorSec", 15),
      "secondHalfScoreboardSec" = COALESCE("matchLiveScoreboardSec", 45),
      "secondHalfSponsorSec" = COALESCE("matchLiveSponsorSec", 15),
      "halftimeScoreboardSec" = 30,
      "halftimeSponsorSec" = COALESCE("matchLiveSponsorSec", 15),
      "liveCycleLegacyImported" = 1
    WHERE "id" = 1
  `);
}

async function ensureBaseData() {
  await prisma.displayState.upsert({
    where: { id: 1 },
    create: { id: 1, mode: "IDLE" },
    update: {},
  });

  const slots = [
    { slot: "IDLE", name: "Idle" },
    { slot: "PREMATCH", name: "Pre-match" },
    { slot: "HALFTIME", name: "Half-time" },
    { slot: "POSTMATCH", name: "Post-match" },
    { slot: "GOAL", name: "Goal celebrations" },
  ] as const;

  for (const slot of slots) {
    await prisma.playlist.upsert({
      where: { slot: slot.slot },
      create: { slot: slot.slot, name: slot.name },
      update: { name: slot.name },
    });
  }

  await prisma.$executeRawUnsafe(
    `INSERT OR IGNORE INTO "AppSettings" ("id", "homeTeamId") VALUES (1, NULL)`,
  );
}

async function getStateRow() {
  const state = await prisma.displayState.findUnique({ where: { id: 1 } });
  if (state) return state;
  return prisma.displayState.create({ data: { id: 1, mode: "IDLE" } });
}

type LiveCycleStored = {
  firstHalfScoreboardSec: number;
  firstHalfSponsorSec: number;
  halftimeScoreboardSec: number;
  halftimeSponsorSec: number;
  secondHalfScoreboardSec: number;
  secondHalfSponsorSec: number;
};

type AppSettingsRow = {
  id: number;
  homeTeamId: string | null;
  goalIntroVideoPath: string | null;
  goalVisualHomeEnabled?: boolean | number | null;
  goalVisualAwayEnabled?: boolean | number | null;
  firstHalfScoreboardSec?: number | null;
  firstHalfSponsorSec?: number | null;
  halftimeScoreboardSec?: number | null;
  halftimeSponsorSec?: number | null;
  secondHalfScoreboardSec?: number | null;
  secondHalfSponsorSec?: number | null;
  scoreboardThemeJson?: string | null;
  proofOfPlayBrandJson?: string | null;
  displayCanvasWidth?: number | null;
  displayCanvasHeight?: number | null;
  displayScalingMode?: string | null;
  displaySafeZoneVisible?: boolean | number | null;
  displaySafeZoneMarginPx?: number | null;
  idleFallbackMediaId?: string | null;
  uiLocale?: string | null;
};

function defaultLiveCycle(): LiveCycleStored {
  return {
    firstHalfScoreboardSec: 45,
    firstHalfSponsorSec: 15,
    halftimeScoreboardSec: 30,
    halftimeSponsorSec: 15,
    secondHalfScoreboardSec: 45,
    secondHalfSponsorSec: 15,
  };
}

function clampLiveCyclePhasing(p: LiveCycleStored): LiveCycleStored {
  const sbPlay = (n: number) => Math.max(5, Math.min(600, Math.floor(n)));
  const sbHt = (n: number) => Math.max(0, Math.min(600, Math.floor(n)));
  const sp = (n: number) => Math.max(3, Math.min(300, Math.floor(n)));
  return {
    firstHalfScoreboardSec: sbPlay(p.firstHalfScoreboardSec),
    firstHalfSponsorSec: sp(p.firstHalfSponsorSec),
    halftimeScoreboardSec: sbHt(p.halftimeScoreboardSec),
    halftimeSponsorSec: sp(p.halftimeSponsorSec),
    secondHalfScoreboardSec: sbPlay(p.secondHalfScoreboardSec),
    secondHalfSponsorSec: sp(p.secondHalfSponsorSec),
  };
}

function normalizeUiLocale(raw: string | null | undefined): "nl" | "en" | "fr" {
  return raw === "en" || raw === "fr" ? raw : "nl";
}

async function getAppSettings(): Promise<{
  id: number;
  homeTeamId: string | null;
  idleFallbackMediaId: string | null;
  goalIntroVideoPath: string | null;
  goalVisualHomeEnabled: boolean;
  goalVisualAwayEnabled: boolean;
  scoreboardThemeJson: string | null;
  proofOfPlayBrandJson: string | null;
  displayCanvasWidth: number;
  displayCanvasHeight: number;
  displayScalingMode: "cover" | "contain" | "exact";
  displaySafeZoneVisible: boolean;
  displaySafeZoneMarginPx: number;
  uiLocale: "nl" | "en" | "fr";
} & LiveCycleStored> {
  const defaults = defaultLiveCycle();
  const rows = await prisma.$queryRawUnsafe<Array<AppSettingsRow>>(
    `SELECT "id", "homeTeamId", "idleFallbackMediaId", "goalIntroVideoPath",
      "goalVisualHomeEnabled", "goalVisualAwayEnabled",
      "firstHalfScoreboardSec", "firstHalfSponsorSec",
      "halftimeScoreboardSec", "halftimeSponsorSec",
      "secondHalfScoreboardSec", "secondHalfSponsorSec",
      "scoreboardThemeJson", "proofOfPlayBrandJson",
      "displayCanvasWidth", "displayCanvasHeight",
      "displayScalingMode", "displaySafeZoneVisible", "displaySafeZoneMarginPx",
      "uiLocale"
     FROM "AppSettings" WHERE "id" = 1`,
  );
  const row = rows[0];
  const normalizeMode = (raw: string | null | undefined): "cover" | "contain" | "exact" =>
    raw === "contain" || raw === "exact" ? raw : "cover";
  if (row) {
    return {
      id: row.id,
      homeTeamId: row.homeTeamId,
      idleFallbackMediaId: row.idleFallbackMediaId ?? null,
      goalIntroVideoPath: row.goalIntroVideoPath,
      goalVisualHomeEnabled: row.goalVisualHomeEnabled == null ? true : Boolean(row.goalVisualHomeEnabled),
      goalVisualAwayEnabled: row.goalVisualAwayEnabled == null ? false : Boolean(row.goalVisualAwayEnabled),
      scoreboardThemeJson: row.scoreboardThemeJson ?? null,
      proofOfPlayBrandJson: row.proofOfPlayBrandJson ?? null,
      firstHalfScoreboardSec: row.firstHalfScoreboardSec ?? defaults.firstHalfScoreboardSec,
      firstHalfSponsorSec: row.firstHalfSponsorSec ?? defaults.firstHalfSponsorSec,
      halftimeScoreboardSec: row.halftimeScoreboardSec ?? defaults.halftimeScoreboardSec,
      halftimeSponsorSec: row.halftimeSponsorSec ?? defaults.halftimeSponsorSec,
      secondHalfScoreboardSec: row.secondHalfScoreboardSec ?? defaults.secondHalfScoreboardSec,
      secondHalfSponsorSec: row.secondHalfSponsorSec ?? defaults.secondHalfSponsorSec,
      displayCanvasWidth: row.displayCanvasWidth ?? 1920,
      displayCanvasHeight: row.displayCanvasHeight ?? 1080,
      displayScalingMode: normalizeMode(row.displayScalingMode),
      displaySafeZoneVisible:
        row.displaySafeZoneVisible == null ? false : Boolean(row.displaySafeZoneVisible),
      displaySafeZoneMarginPx: row.displaySafeZoneMarginPx ?? 40,
      uiLocale: normalizeUiLocale(row.uiLocale),
    };
  }
  await prisma.$executeRawUnsafe(
    `INSERT OR IGNORE INTO "AppSettings" ("id", "homeTeamId") VALUES (1, NULL)`,
  );
  return {
    id: 1,
    homeTeamId: null,
    idleFallbackMediaId: null,
    goalIntroVideoPath: null,
    goalVisualHomeEnabled: true,
    goalVisualAwayEnabled: false,
    scoreboardThemeJson: null,
    proofOfPlayBrandJson: null,
    displayCanvasWidth: 1920,
    displayCanvasHeight: 1080,
    displayScalingMode: "cover",
    displaySafeZoneVisible: false,
    displaySafeZoneMarginPx: 40,
    uiLocale: "nl",
    ...defaults,
  };
}

async function setHomeTeamId(homeTeamId: string | null) {
  await prisma.$executeRawUnsafe(
    `UPDATE "AppSettings" SET "homeTeamId" = ? WHERE "id" = 1`,
    homeTeamId,
  );
}

async function setIdleFallbackMediaId(mediaId: string | null) {
  await prisma.$executeRawUnsafe(
    `UPDATE "AppSettings" SET "idleFallbackMediaId" = ? WHERE "id" = 1`,
    mediaId,
  );
}

/**
 * Zorgt dat de meegeleverde templates bestaan. Naam/label worden bijgewerkt zodat
 * updates van de app doorkomen, maar gebruikers-templates blijven ongemoeid en een
 * verwijderde built-in komt terug (ze zijn bedoeld als vertrekpunt).
 */
async function ensureBuiltInScoreboardTemplates(): Promise<void> {
  for (const row of builtInTemplateRows()) {
    await prisma.scoreboardTemplate.upsert({
      where: { id: row.id },
      update: {
        name: row.name,
        label: row.label,
        themeJson: row.themeJson,
        sortIndex: row.sortIndex,
        isBuiltIn: true,
      },
      create: row,
    });
  }
}

async function buildSettingsApiJson() {
  const s = await getAppSettings();
  let idleFallbackMedia: unknown = null;
  if (s.idleFallbackMediaId) {
    const m = await prisma.mediaItem.findUnique({ where: { id: s.idleFallbackMediaId } });
    if (m?.active) {
      idleFallbackMedia = {
        id: m.id,
        type: m.type,
        path: m.path,
        title: m.title,
        durationSec: m.durationSec,
        sponsorName: m.sponsorName,
        sponsorId: m.sponsorId,
        active: m.active,
        playAudio: m.playAudio,
        sponsorPhaseTagsJson: m.sponsorPhaseTagsJson,
        hideFromLibrary: m.hideFromLibrary,
        createdAt: m.createdAt.toISOString(),
      };
    }
  }
  let homeTeamBranding: {
    name: string;
    logoPath: string | null;
    primaryColor: string;
    secondaryColor: string;
  } | null = null;
  if (s.homeTeamId) {
    const t = await prisma.team.findUnique({
      where: { id: s.homeTeamId },
      select: { name: true, logoPath: true, primaryColor: true, secondaryColor: true },
    });
    if (t) {
      homeTeamBranding = {
        name: t.name,
        logoPath: t.logoPath,
        primaryColor: t.primaryColor,
        secondaryColor: t.secondaryColor,
      };
    }
  }
  return {
    homeTeamId: s.homeTeamId,
    goalIntroVideoPath: s.goalIntroVideoPath,
    goalVisualHomeEnabled: s.goalVisualHomeEnabled,
    goalVisualAwayEnabled: s.goalVisualAwayEnabled,
    firstHalfScoreboardSec: s.firstHalfScoreboardSec,
    firstHalfSponsorSec: s.firstHalfSponsorSec,
    halftimeScoreboardSec: s.halftimeScoreboardSec,
    halftimeSponsorSec: s.halftimeSponsorSec,
    secondHalfScoreboardSec: s.secondHalfScoreboardSec,
    secondHalfSponsorSec: s.secondHalfSponsorSec,
    scoreboardThemeJson: s.scoreboardThemeJson,
    proofOfPlayBrandJson: s.proofOfPlayBrandJson,
    displayCanvasWidth: s.displayCanvasWidth,
    displayCanvasHeight: s.displayCanvasHeight,
    displayScalingMode: s.displayScalingMode,
    displaySafeZoneVisible: s.displaySafeZoneVisible,
    displaySafeZoneMarginPx: s.displaySafeZoneMarginPx,
    idleFallbackMediaId: s.idleFallbackMediaId,
    idleFallbackMedia,
    homeTeamBranding,
    uiLocale: s.uiLocale,
  };
}

async function setUiLocale(locale: "nl" | "en" | "fr") {
  await prisma.$executeRawUnsafe(
    `UPDATE "AppSettings" SET "uiLocale" = ? WHERE "id" = 1`,
    locale,
  );
  try {
    opts?.onUiLocaleChanged?.(locale);
  } catch {
    /* menu rebuild best-effort */
  }
}

export async function getUiLocale(): Promise<"nl" | "en" | "fr"> {
  const s = await getAppSettings();
  return normalizeUiLocale(s.uiLocale);
}

async function setGoalIntroVideoPath(videoPath: string | null) {
  await prisma.$executeRawUnsafe(
    `UPDATE "AppSettings" SET "goalIntroVideoPath" = ? WHERE "id" = 1`,
    videoPath,
  );
}

async function setGoalVisualEnabled(side: "home" | "away", enabled: boolean) {
  const column = side === "home" ? "goalVisualHomeEnabled" : "goalVisualAwayEnabled";
  await prisma.$executeRawUnsafe(
    `UPDATE "AppSettings" SET "${column}" = ? WHERE "id" = 1`,
    enabled ? 1 : 0,
  );
}

async function setDisplayCanvas(patch: {
  width?: number;
  height?: number;
  mode?: "cover" | "contain" | "exact";
  safeZoneVisible?: boolean;
  safeZoneMarginPx?: number;
}) {
  const columns: string[] = [];
  const values: (number | string)[] = [];
  if (typeof patch.width === "number" && Number.isFinite(patch.width)) {
    columns.push(`"displayCanvasWidth" = ?`);
    values.push(Math.max(320, Math.round(patch.width)));
  }
  if (typeof patch.height === "number" && Number.isFinite(patch.height)) {
    columns.push(`"displayCanvasHeight" = ?`);
    values.push(Math.max(240, Math.round(patch.height)));
  }
  if (patch.mode === "cover" || patch.mode === "contain" || patch.mode === "exact") {
    columns.push(`"displayScalingMode" = ?`);
    values.push(patch.mode);
  }
  if (typeof patch.safeZoneVisible === "boolean") {
    columns.push(`"displaySafeZoneVisible" = ?`);
    values.push(patch.safeZoneVisible ? 1 : 0);
  }
  if (
    typeof patch.safeZoneMarginPx === "number" &&
    Number.isFinite(patch.safeZoneMarginPx)
  ) {
    columns.push(`"displaySafeZoneMarginPx" = ?`);
    values.push(Math.max(0, Math.round(patch.safeZoneMarginPx)));
  }
  if (columns.length === 0) return;
  await prisma.$executeRawUnsafe(
    `UPDATE "AppSettings" SET ${columns.join(", ")} WHERE "id" = 1`,
    ...values,
  );
}

async function setLiveCyclePhasing(next: LiveCycleStored) {
  const c = clampLiveCyclePhasing(next);
  await prisma.$executeRawUnsafe(
    `UPDATE "AppSettings" SET
      "firstHalfScoreboardSec" = ?,
      "firstHalfSponsorSec" = ?,
      "halftimeScoreboardSec" = ?,
      "halftimeSponsorSec" = ?,
      "secondHalfScoreboardSec" = ?,
      "secondHalfSponsorSec" = ?
     WHERE "id" = 1`,
    c.firstHalfScoreboardSec,
    c.firstHalfSponsorSec,
    c.halftimeScoreboardSec,
    c.halftimeSponsorSec,
    c.secondHalfScoreboardSec,
    c.secondHalfSponsorSec,
  );
}

async function setScoreboardThemeJson(json: string | null) {
  await prisma.$executeRawUnsafe(
    `UPDATE "AppSettings" SET "scoreboardThemeJson" = ? WHERE "id" = 1`,
    json,
  );
}

async function setProofOfPlayBrandJson(json: string | null) {
  await prisma.$executeRawUnsafe(
    `UPDATE "AppSettings" SET "proofOfPlayBrandJson" = ? WHERE "id" = 1`,
    json,
  );
}

async function touchState() {
  const state = await getStateRow();
  const now = new Date();
  await prisma.displayState.update({
    where: { id: 1 },
    data: {
      mode: state.mode,
      /** Altijd verversen: clients (Match-tab, display) hangen aan `updatedAt` voor sponsor-refetch. */
      updatedAt: now,
    },
  });
}

/** Bij app-opstart niet automatisch opnieuw sponsorrotatie starten uit de vorige sessie. */
async function resetAutoSponsorModeOnStartup(): Promise<void> {
  const state = await getStateRow();
  if (!state.matchId) return;
  if (state.mode !== "SPONSOR_ROTATION" && state.mode !== "SPONSOR") return;
  await prisma.displayState.update({
    where: { id: 1 },
    data: {
      mode: "MATCH",
      activeMediaId: null,
    },
  });
  resetSponsorLedger();
}

/** Display loskoppelen wanneer een wedstrijd wordt afgesloten of verwijderd. */
async function detachDisplayStateForMatchId(matchId: string): Promise<void> {
  const state = await prisma.displayState.findUnique({ where: { id: 1 } });
  if (!state?.matchId || state.matchId !== matchId) return;
  await prisma.displayState.update({
    where: { id: 1 },
    data: {
      matchId: null,
      mode: "IDLE",
      activePlayerId: null,
      activeSubOutId: null,
      activeSubInId: null,
      substitutionQueueJson: "[]",
      activeGoalScorerId: null,
      activeMediaId: null,
      timerRunning: false,
      timerStartedAt: null,
      timerBaseSec: 0,
      shotClockRunning: false,
      shotClockStartedAt: null,
      shotClockBaseSec: 0,
    },
  });
  resetSponsorLedger();
}

/** If DisplayState still points at a deleted match, clear it so the UI never 404-loops. */
async function repairOrphanDisplayMatchId(): Promise<void> {
  const state = await prisma.displayState.findUnique({ where: { id: 1 } });
  if (!state?.matchId) return;
  const exists = await prisma.match.findUnique({
    where: { id: state.matchId },
    select: { id: true, closedAt: true },
  });
  if (exists && !exists.closedAt) return;
  await prisma.displayState.update({
    where: { id: 1 },
    data: {
      matchId: null,
      mode: "IDLE",
      activePlayerId: null,
      activeSubOutId: null,
      activeSubInId: null,
      substitutionQueueJson: "[]",
      activeGoalScorerId: null,
      activeMediaId: null,
      timerRunning: false,
      timerStartedAt: null,
      timerBaseSec: 0,
    },
  });
  resetSponsorLedger();
}

export async function getDisplaySnapshot() {
  const state = await getStateRow();
  return serializeDisplayState(state);
}

export async function broadcastDisplayState() {
  const state = await getDisplaySnapshot();
  sendAll("display:state", state);
  return state;
}

function startTickLoop() {
  if (tickInterval) return;
  tickInterval = setInterval(async () => {
    try {
      let state = await getStateRow();
      if (state.shotClockRunning && computeShotClockSeconds(state) <= 0) {
        state = await prisma.displayState.update({
          where: { id: 1 },
          data: pauseShotClockAt(0),
        });
        sendAll("display:state", serializeDisplayState(state));
      }
      const tick: TickPayload = {
        elapsed: computeElapsedSeconds(state),
        running: state.timerRunning,
        startedAt: state.timerStartedAt ? state.timerStartedAt.toISOString() : null,
        baseSec: state.timerBaseSec,
        serverNow: Date.now(),
      };
      sendAll("display:tick", tick);
    } catch (err) {
      requireOpts().log(`[tick] ${String(err)}`);
    }
  }, 250);
}

export async function initDesktopRuntime(runtimeOptions: RuntimeOptions) {
  opts = runtimeOptions;
  await ensureSqliteSchema();
  await ensureBaseData();
  await migrateAppSettingsLiveCycleFromLegacy();
  await repairOrphanDisplayMatchId();
  await resetAutoSponsorModeOnStartup();
  startTickLoop();
  await broadcastDisplayState();
  broadcastSponsorLedger();
}

export function disposeDesktopRuntime() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  sponsorLedgerSnapshot = null;
  sponsorClipBestActualSec.clear();
}

type SponsorPlayFilters = {
  matchId?: string;
  sponsorId?: string;
  segmentKey?: string;
  fromIso?: string;
  toIso?: string;
};

function parseSponsorPlayFilters(params: URLSearchParams): SponsorPlayFilters {
  return {
    matchId: params.get("matchId") ?? undefined,
    sponsorId: params.get("sponsorId") ?? undefined,
    segmentKey: params.get("segmentKey") ?? undefined,
    fromIso: params.get("from") ?? undefined,
    toIso: params.get("to") ?? undefined,
  };
}

function buildSponsorPlayWhere(f: SponsorPlayFilters) {
  const where: Record<string, unknown> = {};
  if (f.matchId) where.matchId = f.matchId;
  if (f.sponsorId) where.sponsorId = f.sponsorId;
  if (f.segmentKey) where.segmentKey = { startsWith: f.segmentKey };
  if (f.fromIso || f.toIso) {
    const range: Record<string, Date> = {};
    if (f.fromIso) {
      const d = new Date(f.fromIso);
      if (!Number.isNaN(d.valueOf())) range.gte = d;
    }
    if (f.toIso) {
      const d = new Date(f.toIso);
      if (!Number.isNaN(d.valueOf())) range.lte = d;
    }
    if (Object.keys(range).length > 0) where.endedAt = range;
  }
  return where;
}

async function handleSponsorPlaysList(
  params: URLSearchParams,
): Promise<DesktopApiResponse> {
  const filters = parseSponsorPlayFilters(params);
  const limit = Math.min(2000, Math.max(1, Number(params.get("limit") ?? 500)));
  const rows = await prisma.sponsorPlayLog.findMany({
    where: buildSponsorPlayWhere(filters),
    orderBy: { endedAt: "desc" },
    take: limit,
    include: {
      match: {
        select: {
          id: true,
          kickoffAt: true,
          homeTeam: { select: { name: true, shortName: true } },
          awayTeam: { select: { name: true, shortName: true } },
        },
      },
    },
  });
  return json(200, { rows });
}

async function handleSponsorPlaysSummary(
  params: URLSearchParams,
): Promise<DesktopApiResponse> {
  const filters = parseSponsorPlayFilters(params);
  const grouped = await prisma.sponsorPlayLog.groupBy({
    by: ["sponsorId", "sponsorName"],
    where: buildSponsorPlayWhere(filters),
    _count: { _all: true },
    _sum: { actualSec: true, expectedSec: true },
  });
  const rows = grouped
    .map((g) => ({
      sponsorId: g.sponsorId,
      sponsorName: g.sponsorName,
      plays: g._count._all,
      actualSec: g._sum.actualSec ?? 0,
      expectedSec: g._sum.expectedSec ?? 0,
    }))
    .sort((a, b) => b.actualSec - a.actualSec);
  return json(200, { rows });
}

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function handleSponsorPlaysCsv(
  params: URLSearchParams,
): Promise<DesktopApiResponse> {
  const filters = parseSponsorPlayFilters(params);
  const rows = await prisma.sponsorPlayLog.findMany({
    where: buildSponsorPlayWhere(filters),
    orderBy: { endedAt: "asc" },
    include: {
      match: {
        select: {
          kickoffAt: true,
          homeTeam: { select: { name: true } },
          awayTeam: { select: { name: true } },
        },
      },
    },
  });

  const header = [
    "Sponsor",
    "Media",
    "Wedstrijd",
    "Kickoff",
    "Match-fase",
    "Match-status",
    "Verwacht (s)",
    "Werkelijk (s)",
    "Gestart op",
    "Beëindigd op",
    "Sessie-id",
  ];
  const lines: string[] = [header.map(csvEscape).join(",")];
  for (const r of rows) {
    const matchLabel = r.match
      ? `${r.match.homeTeam.name} vs ${r.match.awayTeam.name}`
      : "";
    const kickoff = r.match?.kickoffAt ? r.match.kickoffAt.toISOString() : "";
    lines.push(
      [
        r.sponsorName,
        r.mediaTitle,
        matchLabel,
        kickoff,
        r.segmentKey,
        r.matchStatus ?? "",
        r.expectedSec,
        r.actualSec,
        r.startedAt.toISOString(),
        r.endedAt.toISOString(),
        r.clipSessionId,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  // BOM zodat Excel/Numbers UTF-8 correct interpreteert.
  const csv = "\ufeff" + lines.join("\r\n");
  return text(200, csv, "text/csv; charset=utf-8");
}

function readLocalImageAsDataUrl(rawPath: string | null): string | null {
  if (!rawPath?.trim()) return null;
  const stored = rawPath.trim();
  const ext = path.extname(stored).toLowerCase();
  const mime =
    ext === ".png"
      ? "image/png"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : null;
  if (!mime) return null;
  let resolved = stored;
  if (stored.startsWith("/uploads/")) {
    const uploadsDir = process.env.STADIUM_UPLOADS_DIR;
    if (!uploadsDir) return null;
    resolved = path.join(uploadsDir, stored.replace(/^\/uploads\//, ""));
  }
  if (!path.isAbsolute(resolved)) return null;
  try {
    const buf = fs.readFileSync(resolved);
    if (buf.length < 8 || buf.length > 4_000_000) return null;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function json(status: number, value: unknown): DesktopApiResponse {
  return {
    status,
    contentType: "application/json; charset=utf-8",
    json: value,
  };
}

function text(status: number, value: string, contentType = "text/plain; charset=utf-8") {
  return {
    status,
    contentType,
    text: value,
  } satisfies DesktopApiResponse;
}

function parseJsonBody(req: DesktopApiRequest) {
  if (!req.bodyText) return undefined;
  return JSON.parse(req.bodyText);
}

function appReleaseFeedUrl(): string {
  const configured =
    process.env.APP_RELEASE_FEED_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_RELEASE_URL?.trim() ||
    "";
  if (configured && /^https?:\/\//i.test(configured)) {
    return configured;
  }
  return "https://arenacue.be/api/app/release";
}

async function fetchAppReleaseFeed(): Promise<DesktopApiResponse> {
  const feedUrl = new URL(appReleaseFeedUrl());
  feedUrl.searchParams.set("_", String(Date.now()));
  const res = await fetch(feedUrl);
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = { error: "Release-feed gaf geen JSON terug." };
  }
  return json(res.ok ? 200 : res.status, payload);
}

export async function apiRequest(req: DesktopApiRequest): Promise<DesktopApiResponse> {
  try {
    const method = req.method.toUpperCase();
    const url = new URL(`http://desktop${req.path}${req.search ?? ""}`);
    const { pathname, searchParams } = url;

    if (method === "GET" && pathname === "/api/app/release") {
      return await fetchAppReleaseFeed();
    }

    if (method === "GET" && pathname === "/api/teams") {
      const teams = await prisma.team.findMany({
        include: { players: { orderBy: { number: "asc" } } },
        orderBy: { name: "asc" },
      });
      return json(200, teams);
    }

    if (method === "POST" && pathname === "/api/teams") {
      const body = parseJsonBody(req);
      const team = await prisma.team.create({ data: body });
      await touchState();
      await broadcastDisplayState();
      return json(200, team);
    }

    const teamId = pathname.match(/^\/api\/teams\/([^/]+)$/)?.[1];
    if (teamId && method === "GET") {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: { players: { orderBy: { number: "asc" } } },
      });
      return team ? json(200, team) : json(404, { error: "Not found" });
    }
    if (teamId && method === "PATCH") {
      const team = await prisma.team.update({
        where: { id: teamId },
        data: parseJsonBody(req),
      });
      await touchState();
      await broadcastDisplayState();
      return json(200, team);
    }
    if (teamId && method === "DELETE") {
      const stillThere = await prisma.team.findUnique({
        where: { id: teamId },
        select: { id: true },
      });
      if (!stillThere) return json(404, { error: "Team niet gevonden" });
      // Match verwijst naar Team zonder onDelete — verwijder eerst wedstrijden met dit team.
      await prisma.$transaction(async (tx) => {
        await tx.match.deleteMany({
          where: {
            OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
          },
        });
        await tx.team.delete({ where: { id: teamId } });
      });
      const settings = await getAppSettings();
      if (settings.homeTeamId === teamId) {
        await setHomeTeamId(null);
      }
      await repairOrphanDisplayMatchId();
      await touchState();
      await broadcastDisplayState();
      return json(200, { ok: true });
    }

    if (pathname === "/api/settings" && method === "GET") {
      return json(200, await buildSettingsApiJson());
    }

    if (pathname === "/api/settings" && method === "PATCH") {
      const body =
        (parseJsonBody(req) as {
          homeTeamId?: string | null;
          goalIntroVideoPath?: string | null;
          goalVisualHomeEnabled?: boolean;
          goalVisualAwayEnabled?: boolean;
          matchLiveScoreboardSec?: number;
          matchLiveSponsorSec?: number;
          firstHalfScoreboardSec?: number;
          firstHalfSponsorSec?: number;
          halftimeScoreboardSec?: number;
          halftimeSponsorSec?: number;
          secondHalfScoreboardSec?: number;
          secondHalfSponsorSec?: number;
          scoreboardThemeJson?: string | null;
          proofOfPlayBrandJson?: string | null;
          displayCanvasWidth?: number;
          displayCanvasHeight?: number;
          displayScalingMode?: "cover" | "contain" | "exact";
          displaySafeZoneVisible?: boolean;
          displaySafeZoneMarginPx?: number;
          idleFallbackMediaId?: string | null;
          uiLocale?: "nl" | "en" | "fr";
        }) ?? {};
      if ("uiLocale" in body && body.uiLocale) {
        await setUiLocale(normalizeUiLocale(body.uiLocale));
      }
      if ("homeTeamId" in body) {
        const homeTeamId = body.homeTeamId ?? null;
        if (homeTeamId) {
          const homeTeam = await prisma.team.findUnique({ where: { id: homeTeamId } });
          if (!homeTeam) {
            return json(404, { error: "Home team not found" });
          }
        }
        await setHomeTeamId(homeTeamId);
      }
      if ("idleFallbackMediaId" in body) {
        const mid = body.idleFallbackMediaId ?? null;
        if (mid) {
          const m = await prisma.mediaItem.findUnique({ where: { id: mid } });
          if (!m) {
            return json(404, { error: "Media niet gevonden" });
          }
        }
        await setIdleFallbackMediaId(mid);
      }
      if ("goalIntroVideoPath" in body) {
        await setGoalIntroVideoPath(body.goalIntroVideoPath ?? null);
      }
      if (typeof body.goalVisualHomeEnabled === "boolean") {
        await setGoalVisualEnabled("home", body.goalVisualHomeEnabled);
      }
      if (typeof body.goalVisualAwayEnabled === "boolean") {
        await setGoalVisualEnabled("away", body.goalVisualAwayEnabled);
      }
      if ("scoreboardThemeJson" in body) {
        const raw = body.scoreboardThemeJson;
        await setScoreboardThemeJson(
          raw === null || raw === undefined ? null : String(raw),
        );
      }
      if ("proofOfPlayBrandJson" in body) {
        const raw = body.proofOfPlayBrandJson;
        await setProofOfPlayBrandJson(
          raw === null || raw === undefined ? null : String(raw),
        );
      }
      const patchLiveCycle =
        "firstHalfScoreboardSec" in body ||
        "firstHalfSponsorSec" in body ||
        "halftimeScoreboardSec" in body ||
        "halftimeSponsorSec" in body ||
        "secondHalfScoreboardSec" in body ||
        "secondHalfSponsorSec" in body ||
        "matchLiveScoreboardSec" in body ||
        "matchLiveSponsorSec" in body;
      if (
        "displayCanvasWidth" in body ||
        "displayCanvasHeight" in body ||
        "displayScalingMode" in body ||
        "displaySafeZoneVisible" in body ||
        "displaySafeZoneMarginPx" in body
      ) {
        await setDisplayCanvas({
          width: body.displayCanvasWidth,
          height: body.displayCanvasHeight,
          mode: body.displayScalingMode,
          safeZoneVisible: body.displaySafeZoneVisible,
          safeZoneMarginPx: body.displaySafeZoneMarginPx,
        });
      }
      if (patchLiveCycle) {
        const cur = await getAppSettings();
        let next: LiveCycleStored = {
          firstHalfScoreboardSec:
            body.firstHalfScoreboardSec ?? cur.firstHalfScoreboardSec,
          firstHalfSponsorSec: body.firstHalfSponsorSec ?? cur.firstHalfSponsorSec,
          halftimeScoreboardSec:
            body.halftimeScoreboardSec ?? cur.halftimeScoreboardSec,
          halftimeSponsorSec: body.halftimeSponsorSec ?? cur.halftimeSponsorSec,
          secondHalfScoreboardSec:
            body.secondHalfScoreboardSec ?? cur.secondHalfScoreboardSec,
          secondHalfSponsorSec: body.secondHalfSponsorSec ?? cur.secondHalfSponsorSec,
        };
        if ("matchLiveScoreboardSec" in body || "matchLiveSponsorSec" in body) {
          const sb = body.matchLiveScoreboardSec ?? cur.firstHalfScoreboardSec;
          const sp = body.matchLiveSponsorSec ?? cur.firstHalfSponsorSec;
          next = {
            ...next,
            firstHalfScoreboardSec: sb,
            firstHalfSponsorSec: sp,
            secondHalfScoreboardSec: sb,
            secondHalfSponsorSec: sp,
          };
        }
        await setLiveCyclePhasing(next);
      }
      await touchState();
      await broadcastDisplayState();
      return json(200, await buildSettingsApiJson());
    }

    if (pathname === "/api/players" && method === "GET") {
      const teamIdParam = searchParams.get("teamId");
      const players = await prisma.player.findMany({
        where: teamIdParam ? { teamId: teamIdParam } : undefined,
        orderBy: { number: "asc" },
      });
      return json(200, players);
    }

    if (pathname === "/api/players" && method === "POST") {
      const player = await prisma.player.create({ data: parseJsonBody(req) });
      await touchState();
      await broadcastDisplayState();
      return json(200, player);
    }

    if (pathname === "/api/players/bulk-visuals" && method === "POST") {
      const body = (parseJsonBody(req) as {
        field: "goalVideoPath" | "subImagePath" | "lineupVideoPath";
        assignments: Array<{ playerId: string; filePath: string | null }>;
      }) ?? { field: "goalVideoPath", assignments: [] };
      const allowed = new Set(["goalVideoPath", "subImagePath", "lineupVideoPath"]);
      if (!allowed.has(body.field)) {
        return json(400, { error: "Invalid field" });
      }
      await prisma.$transaction(
        body.assignments.map((a) =>
          prisma.player.update({
            where: { id: a.playerId },
            data: { [body.field]: a.filePath ?? null },
          }),
        ),
      );
      await touchState();
      await broadcastDisplayState();
      return json(200, { ok: true, updated: body.assignments.length });
    }

    const playerId = pathname.match(/^\/api\/players\/([^/]+)$/)?.[1];
    if (playerId && method === "PATCH") {
      const player = await prisma.player.update({
        where: { id: playerId },
        data: parseJsonBody(req),
      });
      await touchState();
      await broadcastDisplayState();
      return json(200, player);
    }
    if (playerId && method === "DELETE") {
      await prisma.player.delete({ where: { id: playerId } });
      await touchState();
      await broadcastDisplayState();
      return json(200, { ok: true });
    }

    if (pathname === "/api/scoreboard-templates" && method === "GET") {
      await ensureBuiltInScoreboardTemplates();
      const rows = await prisma.scoreboardTemplate.findMany({
        orderBy: [{ isBuiltIn: "desc" }, { sortIndex: "asc" }, { name: "asc" }],
      });
      return json(200, rows);
    }

    if (pathname === "/api/scoreboard-templates" && method === "POST") {
      const body = parseJsonBody(req) as {
        name?: string;
        label?: string | null;
        themeJson?: string | null;
      };
      const name = (body.name ?? "").trim().slice(0, 80);
      if (!name) return json(400, { error: "Naam is verplicht." });
      const row = await prisma.scoreboardTemplate.create({
        data: {
          name,
          label: body.label?.trim().slice(0, 80) || null,
          themeJson: sanitizeTemplateThemeJson(body.themeJson),
          isBuiltIn: false,
          sortIndex: 0,
        },
      });
      return json(200, row);
    }

    const templateId = pathname.match(/^\/api\/scoreboard-templates\/([^/]+)$/)?.[1];

    if (templateId && method === "PATCH") {
      const existing = await prisma.scoreboardTemplate.findUnique({ where: { id: templateId } });
      if (!existing) return json(404, { error: "Template niet gevonden." });
      if (existing.isBuiltIn) {
        return json(400, { error: "Meegeleverde templates zijn niet aanpasbaar — dupliceer ze." });
      }
      const body = parseJsonBody(req) as {
        name?: string;
        label?: string | null;
        themeJson?: string | null;
      };
      const data: Record<string, unknown> = {};
      if (typeof body.name === "string" && body.name.trim()) {
        data.name = body.name.trim().slice(0, 80);
      }
      if (body.label !== undefined) data.label = body.label?.trim().slice(0, 80) || null;
      if (body.themeJson !== undefined) data.themeJson = sanitizeTemplateThemeJson(body.themeJson);
      const row = await prisma.scoreboardTemplate.update({ where: { id: templateId }, data });
      return json(200, row);
    }

    if (templateId && method === "DELETE") {
      const existing = await prisma.scoreboardTemplate.findUnique({ where: { id: templateId } });
      if (!existing) return json(404, { error: "Template niet gevonden." });
      if (existing.isBuiltIn) {
        return json(400, { error: "Meegeleverde templates kunnen niet verwijderd worden." });
      }
      await prisma.scoreboardTemplate.delete({ where: { id: templateId } });
      return json(200, { ok: true });
    }

    const applyId = pathname.match(/^\/api\/scoreboard-templates\/([^/]+)\/apply$/)?.[1];
    if (applyId && method === "POST") {
      const tpl = await prisma.scoreboardTemplate.findUnique({ where: { id: applyId } });
      if (!tpl) return json(404, { error: "Template niet gevonden." });
      const settings = await prisma.appSettings.findFirst();
      /** Layout uit de template, afspeelinstellingen uit de huidige settings. */
      const nextJson = applyTemplateToThemeJson(settings?.scoreboardThemeJson, tpl.themeJson);
      if (settings) {
        await prisma.appSettings.update({
          where: { id: settings.id },
          data: { scoreboardThemeJson: nextJson },
        });
      } else {
        await prisma.appSettings.create({ data: { scoreboardThemeJson: nextJson } });
      }
      await touchState();
      await broadcastDisplayState();
      return json(200, { ok: true, scoreboardThemeJson: nextJson });
    }

    if (pathname === "/api/sponsors" && method === "GET") {
      const sponsors = await prisma.sponsor.findMany({
        include: { media: { orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "asc" },
      });
      return json(200, sponsors);
    }

    if (pathname === "/api/sponsors" && method === "POST") {
      const body = parseJsonBody(req) as {
        name: string;
        prematchSeconds?: number;
        matchSeconds?: number;
        halftimeSeconds?: number;
        postmatchSeconds?: number;
        imageDefaultSec?: number;
        active?: boolean;
      };
      const m1 = (body as { matchFirstHalfSeconds?: number }).matchFirstHalfSeconds ?? 0;
      const m2 = (body as { matchSecondHalfSeconds?: number }).matchSecondHalfSeconds ?? 0;
      const legacyM = body.matchSeconds ?? 0;
      const matchSecondsTotal =
        m1 > 0 || m2 > 0 ? m1 + m2 : legacyM;
      const sponsor = await prisma.sponsor.create({
        data: {
          name: body.name,
          prematchSeconds: body.prematchSeconds ?? 0,
          matchSeconds: matchSecondsTotal,
          matchFirstHalfSeconds: m1 > 0 || m2 > 0 ? m1 : legacyM,
          matchSecondHalfSeconds: m2,
          halftimeSeconds: body.halftimeSeconds ?? 0,
          postmatchSeconds: body.postmatchSeconds ?? 0,
          imageDefaultSec: body.imageDefaultSec ?? 10,
          active: body.active ?? true,
        },
      });
      await touchState();
      await broadcastDisplayState();
      return json(200, sponsor);
    }

    const sponsorId = pathname.match(/^\/api\/sponsors\/([^/]+)$/)?.[1];
    if (sponsorId && method === "PATCH") {
      const body = parseJsonBody(req) as Record<string, unknown>;
      const allowed: Record<string, true> = {
        name: true,
        prematchSeconds: true,
        matchSeconds: true,
        matchFirstHalfSeconds: true,
        matchSecondHalfSeconds: true,
        halftimeSeconds: true,
        postmatchSeconds: true,
        imageDefaultSec: true,
        active: true,
        sponsorPlaybackOrderJson: true,
        sponsorPlaybackRepeatsJson: true,
      };
      const data: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body)) {
        if (allowed[key]) data[key] = value;
      }
      const sponsor = await prisma.sponsor.update({
        where: { id: sponsorId },
        data,
      });
      await touchState();
      await broadcastDisplayState();
      return json(200, sponsor);
    }
    if (sponsorId && method === "DELETE") {
      await prisma.sponsor.delete({ where: { id: sponsorId } });
      await touchState();
      await broadcastDisplayState();
      return json(200, { ok: true });
    }

    if (pathname === "/api/matches" && method === "GET") {
      const matches = await prisma.match.findMany({
        include: { homeTeam: true, awayTeam: true },
        orderBy: { createdAt: "desc" },
      });
      return json(200, matches);
    }

    if (pathname === "/api/matches" && method === "POST") {
      const body = parseJsonBody(req) as {
        homeTeamId: string;
        awayTeamId: string;
        kickoffAt?: string | null;
        matchSponsorMediaId?: string | null;
        halfDurationSec?: number;
        halfBreakSec?: number;
        sport?: string;
        periodDurationSec?: number;
        prematchSpreadWindowSec?: number | null;
      };
      const sport = normalizeSport(body.sport);
      const sportProfile = getSportProfile(sport);
      let sponsorId: string | null = null;
      if (typeof body.matchSponsorMediaId === "string" && body.matchSponsorMediaId.length > 0) {
        const mi = await prisma.mediaItem.findUnique({ where: { id: body.matchSponsorMediaId } });
        if (!mi) return json(400, { error: "Matchsponsor-media niet gevonden" });
        sponsorId = mi.id;
      }
      let prematchSpreadWindowSec = 0;
      if (typeof body.prematchSpreadWindowSec === "number" && Number.isFinite(body.prematchSpreadWindowSec)) {
        const n = Math.floor(body.prematchSpreadWindowSec);
        prematchSpreadWindowSec = n <= 0 ? 0 : Math.min(86400, Math.max(60, n));
      }
      const match = await prisma.match.create({
        data: {
          homeTeamId: body.homeTeamId,
          awayTeamId: body.awayTeamId,
          kickoffAt: body.kickoffAt ? new Date(body.kickoffAt) : null,
          matchSponsorMediaId: sponsorId,
          prematchSpreadWindowSec,
          sport,
          currentPeriod: 1,
          periodDurationSec:
            typeof body.periodDurationSec === "number" && body.periodDurationSec >= 0
              ? Math.floor(body.periodDurationSec)
              : sportProfile.defaultPeriodDurationSec,
          halfDurationSec: body.halfDurationSec ?? sportProfile.defaultPeriodDurationSec,
          halfBreakSec: body.halfBreakSec ?? 900,
        },
        include: { homeTeam: true, awayTeam: true, matchSponsorMedia: true },
      });
      await ensureDefaultMatchFieldLineups(match.id);
      await touchState();
      await broadcastDisplayState();
      return json(200, match);
    }

    const matchId = pathname.match(/^\/api\/matches\/([^/]+)$/)?.[1];
    if (matchId && method === "GET") {
      let match = await prisma.match.findUnique({
        where: { id: matchId },
        include: {
          homeTeam: { include: { players: { orderBy: { number: "asc" } } } },
          awayTeam: { include: { players: { orderBy: { number: "asc" } } } },
          events: { orderBy: { createdAt: "desc" } },
          matchSponsorMedia: true,
        },
      });
      if (!match) return json(404, { error: "Not found" });
      await ensureDefaultMatchFieldLineups(match.id);
      match = await prisma.match.findUnique({
        where: { id: matchId },
        include: {
          homeTeam: { include: { players: { orderBy: { number: "asc" } } } },
          awayTeam: { include: { players: { orderBy: { number: "asc" } } } },
          events: { orderBy: { createdAt: "desc" } },
          matchSponsorMedia: true,
        },
      });
      if (!match) return json(404, { error: "Not found" });
      const {
        homeFieldPlayerIdsJson,
        awayFieldPlayerIdsJson,
        ...rest
      } = match;
      return json(200, {
        ...rest,
        homeFieldPlayerIds: parsePlayerIdArrayJson(homeFieldPlayerIdsJson),
        awayFieldPlayerIds: parsePlayerIdArrayJson(awayFieldPlayerIdsJson),
      });
    }
    if (matchId && method === "PATCH") {
      const body = parseJsonBody(req) as Record<string, unknown>;
      const cur = await prisma.match.findUnique({
        where: { id: matchId },
        include: {
          homeTeam: { include: { players: true } },
          awayTeam: { include: { players: true } },
        },
      });
      if (!cur) return json(404, { error: "Not found" });

      const data: Record<string, unknown> = {};
      const wasClosed = cur.closedAt != null;

      if (wasClosed) {
        const otherKeys = Object.keys(body).filter((k) => k !== "closedAt");
        if (otherKeys.length > 0 || !("closedAt" in body) || body.closedAt !== null) {
          return json(400, {
            error:
              "Deze wedstrijd is afgesloten. Alleen heropenen is mogelijk: PATCH met alleen { \"closedAt\": null }.",
          });
        }
        data.closedAt = null;
      } else {
        if (typeof body.status === "string") data.status = body.status;
        if (typeof body.homeScore === "number") data.homeScore = body.homeScore;
        if (typeof body.awayScore === "number") data.awayScore = body.awayScore;
        if (typeof body.sport === "string") {
          const sport = normalizeSport(body.sport);
          const profile = getSportProfile(sport);
          data.sport = sport;
          data.currentPeriod = 1;
          data.periodDurationSec = profile.defaultPeriodDurationSec;
          data.homeTimeouts = 0;
          data.awayTimeouts = 0;
          data.homeFouls = 0;
          data.awayFouls = 0;
          data.homeSets = 0;
          data.awaySets = 0;
        }
        if (typeof body.periodDurationSec === "number" && Number.isFinite(body.periodDurationSec)) {
          data.periodDurationSec = Math.max(0, Math.min(24 * 60 * 60, Math.floor(body.periodDurationSec)));
        }
        if (body.kickoffAt === null) data.kickoffAt = null;
        else if (typeof body.kickoffAt === "string") data.kickoffAt = new Date(body.kickoffAt);

        if ("prematchSpreadWindowSec" in body) {
          const v = body.prematchSpreadWindowSec;
          if (v === null) {
            data.prematchSpreadWindowSec = 0;
          } else if (typeof v === "number" && Number.isFinite(v)) {
            const n = Math.floor(v);
            data.prematchSpreadWindowSec = n <= 0 ? 0 : Math.min(86400, Math.max(60, n));
          }
        }

        if ("matchSponsorMediaId" in body) {
          if (body.matchSponsorMediaId === null || body.matchSponsorMediaId === "") {
            data.matchSponsorMediaId = null;
          } else if (typeof body.matchSponsorMediaId === "string") {
            const mi = await prisma.mediaItem.findUnique({ where: { id: body.matchSponsorMediaId } });
            if (!mi) return json(400, { error: "Matchsponsor-media niet gevonden" });
            data.matchSponsorMediaId = mi.id;
          }
        }

        if ("closedAt" in body) {
          if (body.closedAt === null) {
            data.closedAt = null;
          } else if (typeof body.closedAt === "string" && body.closedAt.length > 0) {
            data.closedAt = new Date(body.closedAt);
          }
        }

        const maximumPlayersForMatch = getSportProfile(cur.sport).fieldPlayers;

        function validateLineup(
          players: { id: string }[] | undefined,
          ids: string[],
          label: string,
        ) {
          const allowed = new Set((players ?? []).map((p) => p.id));
          const uniq = new Set(ids);
          if (uniq.size !== ids.length) throw new Error(`${label}: dubbele speler`);
          if (ids.length < 1 || ids.length > maximumPlayersForMatch) {
            throw new Error(`${label}: kies 1 tot ${maximumPlayersForMatch} spelers op het veld`);
          }
          for (const id of ids) {
            if (!allowed.has(id)) throw new Error(`${label}: speler hoort niet bij dit team`);
          }
        }

        if (Array.isArray(body.homeFieldPlayerIds)) {
          const ids = body.homeFieldPlayerIds.filter((x): x is string => typeof x === "string");
          validateLineup(cur.homeTeam.players, ids, "Thuis basis");
          data.homeFieldPlayerIdsJson = JSON.stringify(ids);
        }
        if (Array.isArray(body.awayFieldPlayerIds)) {
          const ids = body.awayFieldPlayerIds.filter((x): x is string => typeof x === "string");
          validateLineup(cur.awayTeam.players, ids, "Uit basis");
          data.awayFieldPlayerIdsJson = JSON.stringify(ids);
        }
      }

      if (Object.keys(data).length === 0) {
        return json(400, { error: "Geen geldige velden om bij te werken" });
      }

      const closingNow =
        !wasClosed &&
        "closedAt" in body &&
        typeof body.closedAt === "string" &&
        body.closedAt.length > 0;

      try {
        const updated = await prisma.match.update({
          where: { id: matchId },
          data: data as Parameters<typeof prisma.match.update>[0]["data"],
          include: {
            homeTeam: { include: { players: { orderBy: { number: "asc" } } } },
            awayTeam: { include: { players: { orderBy: { number: "asc" } } } },
            events: { orderBy: { createdAt: "desc" } },
            matchSponsorMedia: true,
          },
        });
        if (closingNow) {
          await detachDisplayStateForMatchId(matchId);
        }
        const {
          homeFieldPlayerIdsJson: hJson,
          awayFieldPlayerIdsJson: aJson,
          ...rest
        } = updated;
        await touchState();
        await broadcastDisplayState();
        return json(200, {
          ...rest,
          homeFieldPlayerIds: parsePlayerIdArrayJson(hJson),
          awayFieldPlayerIds: parsePlayerIdArrayJson(aJson),
        });
      } catch (e) {
        return json(400, { error: String(e) });
      }
    }
    if (matchId && method === "DELETE") {
      await prisma.match.delete({ where: { id: matchId } });
      await repairOrphanDisplayMatchId();
      await touchState();
      await broadcastDisplayState();
      return json(200, { ok: true });
    }

    if (pathname === "/api/scheduled-media-cues" && method === "GET") {
      const cues = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          mediaId: string;
          matchStatus: string;
          triggerSec: number;
          enabled: boolean | number;
          createdAt: Date | string;
          mediaType: string;
          mediaPath: string;
          mediaTitle: string;
          mediaDurationSec: number;
          mediaSponsorName: string | null;
          mediaSponsorId: string | null;
          mediaActive: boolean | number;
          mediaPlayAudio: boolean | number;
          mediaSponsorPhaseTagsJson: string | null;
          mediaCreatedAt: Date | string;
        }>
      >(
        `SELECT
          c."id", c."mediaId", c."matchStatus", c."triggerSec", c."enabled", c."createdAt",
          m."type" AS "mediaType", m."path" AS "mediaPath", m."title" AS "mediaTitle",
          m."durationSec" AS "mediaDurationSec", m."sponsorName" AS "mediaSponsorName",
          m."sponsorId" AS "mediaSponsorId", m."active" AS "mediaActive",
          m."playAudio" AS "mediaPlayAudio", m."sponsorPhaseTagsJson" AS "mediaSponsorPhaseTagsJson",
          m."createdAt" AS "mediaCreatedAt"
        FROM "ScheduledMediaCue" c
        INNER JOIN "MediaItem" m ON m."id" = c."mediaId"
        ORDER BY c."matchStatus" ASC, c."triggerSec" ASC, c."createdAt" ASC`,
      );
      return json(
        200,
        cues.map((c) => ({
          id: c.id,
          mediaId: c.mediaId,
          matchStatus: c.matchStatus,
          triggerSec: Number(c.triggerSec),
          enabled: Boolean(c.enabled),
          createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
          media: {
            id: c.mediaId,
            type: c.mediaType,
            path: c.mediaPath,
            title: c.mediaTitle,
            durationSec: Number(c.mediaDurationSec),
            sponsorName: c.mediaSponsorName,
            sponsorId: c.mediaSponsorId,
            active: Boolean(c.mediaActive),
            playAudio: Boolean(c.mediaPlayAudio),
            sponsorPhaseTagsJson: c.mediaSponsorPhaseTagsJson,
            createdAt: c.mediaCreatedAt instanceof Date ? c.mediaCreatedAt.toISOString() : String(c.mediaCreatedAt),
          },
        })),
      );
    }

    if (pathname === "/api/scheduled-media-cues" && method === "POST") {
      const body = (parseJsonBody(req) as {
        mediaId?: string;
        matchStatus?: string;
        triggerSec?: number;
        enabled?: boolean;
      }) ?? {};
      if (!body.mediaId || !body.matchStatus || !Number.isFinite(body.triggerSec)) {
        return json(400, { error: "Media, fase en tijdstip zijn verplicht." });
      }
      const media = await prisma.mediaItem.findUnique({ where: { id: body.mediaId } });
      if (!media) return json(400, { error: "Media niet gevonden." });
      const id = `cue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ScheduledMediaCue" ("id", "mediaId", "matchStatus", "triggerSec", "enabled")
         VALUES (?, ?, ?, ?, ?)`,
        id,
        body.mediaId,
        body.matchStatus,
        Math.max(0, Math.round(body.triggerSec ?? 0)),
        body.enabled === false ? 0 : 1,
      );
      await touchState();
      await broadcastDisplayState();
      return json(200, { id });
    }

    const scheduledCueId = pathname.match(/^\/api\/scheduled-media-cues\/([^/]+)$/)?.[1];
    if (scheduledCueId && method === "PATCH") {
      const body = (parseJsonBody(req) as {
        mediaId?: string;
        matchStatus?: string;
        triggerSec?: number;
        enabled?: boolean;
      }) ?? {};
      const updates: string[] = [];
      const values: unknown[] = [];
      if (typeof body.mediaId === "string") {
        const media = await prisma.mediaItem.findUnique({ where: { id: body.mediaId } });
        if (!media) return json(400, { error: "Media niet gevonden." });
        updates.push(`"mediaId" = ?`);
        values.push(body.mediaId);
      }
      if (typeof body.matchStatus === "string") {
        updates.push(`"matchStatus" = ?`);
        values.push(body.matchStatus);
      }
      if (Number.isFinite(body.triggerSec)) {
        updates.push(`"triggerSec" = ?`);
        values.push(Math.max(0, Math.round(body.triggerSec ?? 0)));
      }
      if (typeof body.enabled === "boolean") {
        updates.push(`"enabled" = ?`);
        values.push(body.enabled ? 1 : 0);
      }
      if (updates.length === 0) return json(400, { error: "Geen wijzigingen." });
      await prisma.$executeRawUnsafe(
        `UPDATE "ScheduledMediaCue" SET ${updates.join(", ")} WHERE "id" = ?`,
        ...values,
        scheduledCueId,
      );
      await touchState();
      await broadcastDisplayState();
      return json(200, { ok: true });
    }

    if (scheduledCueId && method === "DELETE") {
      await prisma.$executeRawUnsafe(`DELETE FROM "ScheduledMediaCue" WHERE "id" = ?`, scheduledCueId);
      await touchState();
      await broadcastDisplayState();
      return json(200, { ok: true });
    }

    if (pathname === "/api/media" && method === "GET") {
      const media = await prisma.mediaItem.findMany({
        orderBy: { createdAt: "desc" },
      });
      return json(200, media);
    }

    if (pathname === "/api/media" && method === "POST") {
      const media = await prisma.mediaItem.create({ data: parseJsonBody(req) });
      await touchState();
      await broadcastDisplayState();
      return json(200, media);
    }

    const mediaId = pathname.match(/^\/api\/media\/([^/]+)$/)?.[1];
    if (mediaId && method === "PATCH") {
      const media = await prisma.mediaItem.update({
        where: { id: mediaId },
        data: parseJsonBody(req),
      });
      await touchState();
      await broadcastDisplayState();
      return json(200, media);
    }
    if (mediaId && method === "DELETE") {
      await prisma.$executeRawUnsafe(`DELETE FROM "ScheduledMediaCue" WHERE "mediaId" = ?`, mediaId);
      await prisma.playlistItem.deleteMany({ where: { mediaId } });
      await prisma.mediaItem.delete({ where: { id: mediaId } });
      await touchState();
      await broadcastDisplayState();
      return json(200, { ok: true });
    }

    if (pathname === "/api/playlists" && method === "GET") {
      const playlists = await prisma.playlist.findMany({
        include: {
          items: {
            orderBy: { order: "asc" },
            include: { media: true },
          },
        },
        orderBy: { slot: "asc" },
      });
      return json(200, playlists);
    }

    const playlistSlot = pathname.match(/^\/api\/playlists\/([^/]+)$/)?.[1];
    if (playlistSlot && method === "POST") {
      const playlist = await prisma.playlist.findUnique({ where: { slot: playlistSlot } });
      if (!playlist) return json(404, { error: "No playlist" });
      const body = parseJsonBody(req) as {
        mediaId: string;
        durationOverrideSec?: number | null;
      };
      const count = await prisma.playlistItem.count({ where: { playlistId: playlist.id } });
      const item = await prisma.playlistItem.create({
        data: {
          playlistId: playlist.id,
          mediaId: body.mediaId,
          order: count,
          durationOverrideSec: body.durationOverrideSec ?? null,
        },
        include: { media: true },
      });
      await touchState();
      await broadcastDisplayState();
      return json(200, item);
    }
    if (playlistSlot && method === "PATCH") {
      const playlist = await prisma.playlist.findUnique({ where: { slot: playlistSlot } });
      if (!playlist) return json(404, { error: "No playlist" });
      const body = parseJsonBody(req) as { order: string[] };
      await prisma.$transaction(
        body.order.map((id, idx) =>
          prisma.playlistItem.update({ where: { id }, data: { order: idx } }),
        ),
      );
      await touchState();
      await broadcastDisplayState();
      return json(200, { ok: true });
    }

    const playlistItemId = pathname.match(/^\/api\/playlists\/items\/([^/]+)$/)?.[1];
    if (playlistItemId && method === "DELETE") {
      await prisma.playlistItem.delete({ where: { id: playlistItemId } });
      await touchState();
      await broadcastDisplayState();
      return json(200, { ok: true });
    }

    if (pathname === "/api/upload") {
      return json(501, { error: "Desktop build gebruikt lokale bestandskeuze, geen upload route." });
    }

    if (pathname === "/api/localfile") {
      return json(501, { error: "Desktop build gebruikt directe bestands-URL's, geen proxy route." });
    }

    if (pathname === "/api/proof-of-play-logo" && method === "GET") {
      const dataUrl = readLocalImageAsDataUrl(searchParams.get("path"));
      if (!dataUrl) {
        return json(404, { error: "Logo niet gevonden" });
      }
      return json(200, { dataUrl });
    }

    if (pathname === "/api/sponsor-plays" && method === "GET") {
      return await handleSponsorPlaysList(searchParams);
    }
    if (pathname === "/api/sponsor-plays/export.csv" && method === "GET") {
      return await handleSponsorPlaysCsv(searchParams);
    }
    if (pathname === "/api/sponsor-plays/summary" && method === "GET") {
      return await handleSponsorPlaysSummary(searchParams);
    }

    return json(404, { error: "Unknown API route" });
  } catch (err) {
    requireOpts().log(`[api] ${String(err)}`);
    return json(500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Commando's die het sponsor-segment effectief opnieuw starten — telemetrie-ledger
 * moet dan leeg, anders blijft "schermtijd verbruikt" oude waarden tonen na een reset.
 */
function commandResetsSponsorTelemetry(cmd: Command): boolean {
  switch (cmd.type) {
    case "match:setStatus":
    case "match:setActive":
    case "timer:preset":
      return true;
    case "timer:set":
      return cmd.seconds === 0;
    default:
      return false;
  }
}

export async function runCommand(input: Command): Promise<CommandAck> {
  try {
    const cmd = CommandSchema.parse(input);
    const result = await handleCommand(cmd);
    if (result.ok && commandResetsSponsorTelemetry(cmd)) {
      resetSponsorLedger();
    }
    await broadcastDisplayState();
    if (result.ok && result.warning) {
      sendControl("display:error", { message: result.warning });
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    requireOpts().log(`[command] ${message}`);
    sendControl("display:error", { message });
    return { ok: false, error: message };
  }
}

type ExportMatch = Awaited<ReturnType<typeof prisma.match.findUnique>>;

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderHtml(
  match: NonNullable<ExportMatch> & {
    homeTeam: {
      players: { id: string; number: number; firstName: string; lastName: string }[];
      name: string;
    };
    awayTeam: {
      players: { id: string; number: number; firstName: string; lastName: string }[];
      name: string;
    };
    events: {
      id: string;
      type: string;
      minute: number;
      teamId: string | null;
      playerInId: string | null;
      playerOutId: string | null;
      note: string | null;
      createdAt: Date;
    }[];
  },
) {
  const playerMap: Record<string, string> = {};
  for (const player of match.homeTeam.players) {
    playerMap[player.id] = `#${player.number} ${player.firstName} ${player.lastName}`;
  }
  for (const player of match.awayTeam.players) {
    playerMap[player.id] = `#${player.number} ${player.firstName} ${player.lastName}`;
  }

  const rows = match.events
    .map((event) => {
      const playerIn = event.playerInId ? playerMap[event.playerInId] : "";
      const playerOut = event.playerOutId ? playerMap[event.playerOutId] : "";
      const description =
        event.type === "GOAL"
          ? `Goal — ${playerIn}`
          : event.type === "SUB"
            ? `Sub: ${playerOut} → ${playerIn}`
            : event.type === "CARD_YELLOW"
              ? `Yellow — ${playerIn}`
              : event.type === "CARD_RED"
                ? `Red — ${playerIn}`
                : event.type === "TIMER_ADJUST"
                  ? `Timer adjust — ${event.note ?? ""}`
                  : event.type;
      return `<tr><td>${escapeHtml(`${event.minute}'`)}</td><td>${escapeHtml(event.type)}</td><td>${escapeHtml(description)}</td></tr>`;
    })
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Match summary</title>
<style>
  body { font-family: Inter, system-ui, sans-serif; max-width: 800px; margin: 2em auto; padding: 1em; }
  h1 { font-size: 2em; margin-bottom: 0; }
  .sub { color:#666; margin-top:0.25em; }
  .score { font-size: 4em; font-weight: 900; text-align:center; margin: 0.5em 0;}
  table { width: 100%; border-collapse: collapse; margin-top: 1.5em; }
  td,th { padding: 0.4em 0.6em; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; }
  @media print { body { margin: 0; } }
</style></head>
<body>
  <h1>${escapeHtml(match.homeTeam.name)} vs ${escapeHtml(match.awayTeam.name)}</h1>
  <div class="sub">Status: ${escapeHtml(match.status)} · ${escapeHtml(new Date(match.createdAt).toLocaleString())}</div>
  <div class="score">${escapeHtml(`${match.homeScore} – ${match.awayScore}`)}</div>
  <table>
    <thead><tr><th>Min</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">No events</td></tr>'}</tbody>
  </table>
</body></html>`;
}

export async function buildMatchExport(matchId: string, format: ExportFormat) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      homeTeam: { include: { players: true } },
      awayTeam: { include: { players: true } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!match) {
    throw new Error("Match not found");
  }

  const baseName = `${match.homeTeam.shortName || "home"}-vs-${match.awayTeam.shortName || "away"}-${match.id.slice(0, 8)}`;
  if (format === "html") {
    return {
      suggestedName: `${baseName}.html`,
      content: renderHtml(match),
      mimeType: "text/html; charset=utf-8",
    };
  }

  return {
    suggestedName: `${baseName}.json`,
    content: JSON.stringify(match, null, 2),
    mimeType: "application/json; charset=utf-8",
  };
}
