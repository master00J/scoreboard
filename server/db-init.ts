import { prisma } from "../lib/prisma";

/**
 * SQLite-initialisatie zonder Electron-afhankelijkheden, zodat dit pad in Vitest getest kan worden.
 *
 * Let op: PRAGMA's die een rij teruggeven (journal_mode, busy_timeout, wal_checkpoint) moeten via
 * $queryRawUnsafe; $executeRawUnsafe gooit dan "Execute returned results, which is not allowed in SQLite".
 * Elke PRAGMA is best-effort: een oudere/afwijkende SQLite mag de app nooit tegenhouden bij het opstarten.
 */
export async function applySqlitePragmas(log: (line: string) => void = () => {}): Promise<void> {
  const pragmas: Array<{ sql: string; returnsRow: boolean }> = [
    { sql: "PRAGMA journal_mode=WAL", returnsRow: true },
    { sql: "PRAGMA busy_timeout=5000", returnsRow: true },
    { sql: "PRAGMA synchronous=NORMAL", returnsRow: false },
  ];
  for (const p of pragmas) {
    try {
      if (p.returnsRow) await prisma.$queryRawUnsafe(p.sql);
      else await prisma.$executeRawUnsafe(p.sql);
    } catch (err) {
      const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
      log(`[db] ${p.sql} overgeslagen: ${message}`);
    }
  }
}

/** Huidige journal mode ("wal" na een geslaagde `applySqlitePragmas`). */
export async function readJournalMode(): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ journal_mode: string }>>("PRAGMA journal_mode");
  return String(rows[0]?.journal_mode ?? "").toLowerCase();
}

/**
 * Schrijft de WAL terug in het hoofdbestand en maakt hem leeg. Vóór een bestandskopie (venue-backup)
 * noodzakelijk: anders mist de kopie alle recente, wél gecommitte wijzigingen.
 */
export async function checkpointSqlite(): Promise<void> {
  await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
}

export async function ensureSqliteSchema(log: (line: string) => void = () => {}) {
  await applySqlitePragmas(log);
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
      "period" INTEGER,
      "clockSec" REAL,
      "metaJson" TEXT,
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
      "timerBaseSec" REAL NOT NULL DEFAULT 0,
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
  await addColumnIfMissing("DisplayState", "externalCaptureAudio", "BOOLEAN NOT NULL DEFAULT 0");
  await addColumnIfMissing("DisplayState", "blackoutResumeCapture", "BOOLEAN NOT NULL DEFAULT 0");
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
  await addColumnIfMissing("Match", "servingSide", "TEXT");
  await addColumnIfMissing("Match", "setHistoryJson", "TEXT");
  await addColumnIfMissing("Match", "technicalTimeoutsEnabled", "BOOLEAN NOT NULL DEFAULT 0");
  await addColumnIfMissing("Match", "setFirstServer", "TEXT");
  await addColumnIfMissing("Match", "setsToWin", "INTEGER NOT NULL DEFAULT 3");
  await addColumnIfMissing("Match", "pointsToWinSet", "INTEGER NOT NULL DEFAULT 25");
  await addColumnIfMissing("Match", "pointsToWinDecider", "INTEGER NOT NULL DEFAULT 15");
  await addColumnIfMissing("MatchEvent", "period", "INTEGER");
  await addColumnIfMissing("MatchEvent", "clockSec", "REAL");
  await addColumnIfMissing("MatchEvent", "metaJson", "TEXT");
  await addColumnIfMissing("DisplayState", "shotClockRunning", "BOOLEAN NOT NULL DEFAULT 0");
  await addColumnIfMissing("DisplayState", "shotClockStartedAt", "DATETIME");
  await addColumnIfMissing("DisplayState", "shotClockBaseSec", "REAL NOT NULL DEFAULT 24");
  await addColumnIfMissing("DisplayState", "activeCardColor", "TEXT");
  await addColumnIfMissing("DisplayState", "homePenaltyRunning", "BOOLEAN NOT NULL DEFAULT 0");
  await addColumnIfMissing("DisplayState", "homePenaltyStartedAt", "DATETIME");
  await addColumnIfMissing("DisplayState", "homePenaltyBaseSec", "REAL NOT NULL DEFAULT 0");
  await addColumnIfMissing("DisplayState", "awayPenaltyRunning", "BOOLEAN NOT NULL DEFAULT 0");
  await addColumnIfMissing("DisplayState", "awayPenaltyStartedAt", "DATETIME");
  await addColumnIfMissing("DisplayState", "awayPenaltyBaseSec", "REAL NOT NULL DEFAULT 0");
  await addColumnIfMissing("DisplayState", "timeoutRunning", "BOOLEAN NOT NULL DEFAULT 0");
  await addColumnIfMissing("DisplayState", "timeoutStartedAt", "DATETIME");
  await addColumnIfMissing("DisplayState", "timeoutBaseSec", "REAL NOT NULL DEFAULT 0");
  await addColumnIfMissing("DisplayState", "timeoutSide", "TEXT");
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
