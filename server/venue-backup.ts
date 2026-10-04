/**
 * Venue-back-up: wat erin zit, hoe we een back-up nakijken en hoe die wordt teruggezet.
 *
 * Een back-up is een map `stadium-backup/` (in een ZIP) met:
 *   data/stadium.db      de clubdatabase
 *   uploads/             bestanden die de app zelf beheert
 *   files/               media die elders op de pc stond (video's, logo's, foto's)
 *   config/              indeling van het Live-tabblad en livestream-instellingen (zonder streamsleutels)
 *   backup.json          versie, datum en de lijst van `files/`
 *
 * Terugzetten gebeurt bij het opstarten, vóór de database open is: de ZIP wordt eerst uitgepakt naar
 * `restore-pending/`, daarna herstart de app en wisselt `applyPendingRestore` de bestanden om.
 */
import fs from "node:fs";
import path from "node:path";

export const BACKUP_ROOT_DIR = "stadium-backup";
export const BACKUP_MANIFEST = "backup.json";
export const RESTORE_PENDING_DIR = "restore-pending";
export const RESTORE_READY_MARKER = "ready.json";
export const RESTORE_SAFETY_DIR = "restore-safety";
/** Wat er na het terugzetten nog met de database moet gebeuren, zodra die open is. */
export const RESTORE_FOLLOWUP_FILE = "restore-followup.json";
/** Compress-Archive (Windows PowerShell 5.1) kan geen bestanden van 2 GB of meer aan. */
export const BACKUP_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024 - 1;

const DB_NAME = "stadium.db";
const DB_FILES = [DB_NAME, `${DB_NAME}-wal`, `${DB_NAME}-shm`];
const SQLITE_HEADER = "SQLite format 3\u0000";
const MATCH_TAB_LAYOUT_FILE = "control-match-tab-layout.json";
const LIVESTREAM_SETTINGS_FILE = "livestream-settings.json";
/** Sleutels van de streamdienst horen niet in een bestand dat op een USB-stick rondgaat. */
const LIVESTREAM_SECRET_KEYS = ["streamKey", "streamKey2"];

export type BackupManifestFile = {
  /** Volledig pad op de pc waar de back-up gemaakt is. */
  original: string;
  /** Pad binnen de back-up, bv. `files/0001-sponsor.mp4`. */
  archived: string;
  size: number;
};

export type BackupManifest = {
  format: 2;
  app: "arenacue-scoreboard";
  appVersion: string;
  createdAt: string;
  files: BackupManifestFile[];
  /** Bestanden waarnaar de database verwijst maar die niet mee konden. */
  skipped: Array<{ path: string; reason: "missing" | "too_large" }>;
};

/* ————————————————————————— paden in de database ————————————————————————— */

/**
 * Een volledig pad naar een bestand buiten de uploads-map van de app. Op Windows een schijfletter
 * of netwerkpad; elders een pad vanaf `/`. Zo ziet Windows een tekst als "/sponsors" niet als bestand.
 */
export function isExternalFilePath(value: string, platform: string = process.platform): boolean {
  if (value.length < 4 || value.length > 1024 || /[\r\n]/.test(value)) return false;
  if (platform === "win32") return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
  return value.startsWith("/") && !value.startsWith("/uploads/") && !value.startsWith("//");
}

function looksLikeJson(value: string): boolean {
  const first = value.trimStart()[0];
  return first === "{" || first === "[";
}

function walkStrings(value: unknown, visit: (text: string) => void): void {
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) for (const item of value) walkStrings(item, visit);
  else if (value && typeof value === "object") for (const item of Object.values(value)) walkStrings(item, visit);
}

/** Haalt bestandspaden uit één databasewaarde: het pad zelf, of paden binnen een JSON-waarde. */
export function collectExternalPaths(value: unknown, out: Set<string>): void {
  if (typeof value !== "string" || !value) return;
  if (isExternalFilePath(value)) {
    out.add(value);
    return;
  }
  if (!looksLikeJson(value)) return;
  try {
    walkStrings(JSON.parse(value), (text) => {
      if (isExternalFilePath(text)) out.add(text);
    });
  } catch {
    /* geen JSON: niets te vinden */
  }
}

/**
 * Vervangt paden in één databasewaarde. Geeft de nieuwe waarde terug, of null als er niets wijzigt.
 */
export function replaceExternalPaths(value: string, remap: Record<string, string>): string | null {
  if (Object.prototype.hasOwnProperty.call(remap, value)) return remap[value];
  if (!looksLikeJson(value)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  let changed = false;
  const swap = (node: unknown): unknown => {
    if (typeof node === "string") {
      if (Object.prototype.hasOwnProperty.call(remap, node)) {
        changed = true;
        return remap[node];
      }
      return node;
    }
    if (Array.isArray(node)) return node.map(swap);
    if (node && typeof node === "object") {
      const next: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(node)) next[key] = swap(item);
      return next;
    }
    return node;
  };
  const next = swap(parsed);
  return changed ? JSON.stringify(next) : null;
}

/** Minimale databasetoegang, zodat dit zowel met Prisma als in tests werkt. */
export type RawDb = {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
};

/** Rijen die een pad of JSON kunnen bevatten; de rest (namen, kleuren, getallen) slaan we over. */
const CANDIDATE_FILTER = (column: string) =>
  `"${column}" LIKE '_:\\%' OR "${column}" LIKE '_:/%' OR "${column}" LIKE '\\\\%' OR "${column}" LIKE '/%' OR "${column}" LIKE '{%' OR "${column}" LIKE '[%'`;

async function textColumns(db: RawDb): Promise<Array<{ table: string; column: string }>> {
  const tables = await db.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'`,
  );
  const out: Array<{ table: string; column: string }> = [];
  for (const { name } of tables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    const columns = await db.$queryRawUnsafe<Array<{ name: string; type: string }>>(`PRAGMA table_info("${name}")`);
    for (const column of columns) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(column.name)) continue;
      if (/TEXT|CHAR|CLOB/i.test(column.type ?? "")) out.push({ table: name, column: column.name });
    }
  }
  return out;
}

/** Alle bestandspaden buiten de uploads-map waarnaar de database verwijst. */
export async function listExternalFileReferences(db: RawDb): Promise<string[]> {
  const found = new Set<string>();
  for (const { table, column } of await textColumns(db)) {
    const rows = await db.$queryRawUnsafe<Array<{ v: string | null }>>(
      `SELECT DISTINCT "${column}" AS v FROM "${table}" WHERE ${CANDIDATE_FILTER(column)}`,
    );
    for (const row of rows) collectExternalPaths(row.v, found);
  }
  return [...found].sort();
}

/** Schrijft de nieuwe paden in de database. Geeft het aantal gewijzigde waarden terug. */
export async function remapStoredFilePaths(db: RawDb, remap: Record<string, string>): Promise<number> {
  if (Object.keys(remap).length === 0) return 0;
  let changed = 0;
  for (const { table, column } of await textColumns(db)) {
    const rows = await db.$queryRawUnsafe<Array<{ rid: string; v: string | null }>>(
      `SELECT CAST(rowid AS TEXT) AS rid, "${column}" AS v FROM "${table}" WHERE ${CANDIDATE_FILTER(column)}`,
    );
    for (const row of rows) {
      if (typeof row.v !== "string") continue;
      const next = replaceExternalPaths(row.v, remap);
      if (next === null) continue;
      await db.$executeRawUnsafe(
        `UPDATE "${table}" SET "${column}" = ? WHERE rowid = CAST(? AS INTEGER)`,
        next,
        String(row.rid),
      );
      changed += 1;
    }
  }
  return changed;
}

/* ————————————————————————— back-up samenstellen ————————————————————————— */

/** Bestandsnaam binnen de back-up: volgnummer + oorspronkelijke naam, zonder vreemde tekens. */
export function archivedFileName(index: number, originalPath: string): string {
  const base = originalPath.split(/[\\/]/).pop() ?? "bestand";
  const safe = base.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(-80) || "bestand";
  return `${String(index + 1).padStart(4, "0")}-${safe}`;
}

/** Zelfde inhoud zonder dubbele schijfruimte waar dat kan; anders een gewone kopie. */
function linkOrCopy(from: string, to: string): void {
  try {
    fs.linkSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
  }
}

/**
 * Zet een map (de uploads) klaar in de back-up, met harde koppelingen waar het kan zodat er geen
 * dubbele schijfruimte nodig is. Te grote of onleesbare bestanden komen in `skipped`.
 */
export function stageDirectory(from: string, to: string, skipped: BackupManifest["skipped"]): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      stageDirectory(source, target, skipped);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      if (fs.statSync(source).size > BACKUP_MAX_FILE_BYTES) {
        skipped.push({ path: source, reason: "too_large" });
        continue;
      }
      linkOrCopy(source, target);
    } catch {
      skipped.push({ path: source, reason: "missing" });
    }
  }
}

/**
 * Zet de externe bestanden in `<stagingRoot>/files/` en geeft terug wat er in de inhoudsopgave komt.
 * `stagingRoot` is de map `stadium-backup` die daarna gezipt wordt.
 */
export function stageExternalFiles(
  stagingRoot: string,
  references: string[],
): Pick<BackupManifest, "files" | "skipped"> {
  const files: BackupManifestFile[] = [];
  const skipped: BackupManifest["skipped"] = [];
  const filesDir = path.join(stagingRoot, "files");
  for (const original of references) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(original);
    } catch {
      skipped.push({ path: original, reason: "missing" });
      continue;
    }
    if (!stat.isFile()) {
      skipped.push({ path: original, reason: "missing" });
      continue;
    }
    if (stat.size > BACKUP_MAX_FILE_BYTES) {
      skipped.push({ path: original, reason: "too_large" });
      continue;
    }
    fs.mkdirSync(filesDir, { recursive: true });
    const name = archivedFileName(files.length, original);
    try {
      linkOrCopy(original, path.join(filesDir, name));
      files.push({ original, archived: `files/${name}`, size: stat.size });
    } catch {
      skipped.push({ path: original, reason: "missing" });
    }
  }
  return { files, skipped };
}

/** Kleine instellingenbestanden die naast de database staan. Streamsleutels gaan er niet in. */
export function stageConfigFiles(stagingRoot: string, userDataDir: string): void {
  const configDir = path.join(stagingRoot, "config");
  const layout = path.join(userDataDir, MATCH_TAB_LAYOUT_FILE);
  if (fs.existsSync(layout)) {
    fs.mkdirSync(configDir, { recursive: true });
    fs.copyFileSync(layout, path.join(configDir, MATCH_TAB_LAYOUT_FILE));
  }
  const livestream = path.join(userDataDir, LIVESTREAM_SETTINGS_FILE);
  if (fs.existsSync(livestream)) {
    try {
      const settings = JSON.parse(fs.readFileSync(livestream, "utf8")) as Record<string, unknown>;
      for (const key of LIVESTREAM_SECRET_KEYS) delete settings[key];
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, LIVESTREAM_SETTINGS_FILE), JSON.stringify(settings, null, 2), "utf8");
    } catch {
      /* onleesbaar bestand: de app start dan met standaardinstellingen, dus niets om te bewaren */
    }
  }
}

export function writeManifest(stagingRoot: string, manifest: BackupManifest): void {
  fs.writeFileSync(path.join(stagingRoot, BACKUP_MANIFEST), JSON.stringify(manifest, null, 2), "utf8");
}

/* ————————————————————————— back-up nakijken ————————————————————————— */

export type BackupInspection =
  | { ok: true; root: string; manifest: BackupManifest | null }
  | { ok: false; reason: "no_database" | "not_a_database" | "newer_version"; backupVersion?: string };

function readManifest(root: string): BackupManifest | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, BACKUP_MANIFEST), "utf8")) as Partial<BackupManifest>;
    if (!raw || typeof raw !== "object") return null;
    const files: BackupManifestFile[] = [];
    for (const item of Array.isArray(raw.files) ? raw.files : []) {
      if (!item || typeof item.original !== "string" || typeof item.archived !== "string") continue;
      // Alleen bestanden uit de eigen `files/`-map: geen paden die buiten de back-up wijzen.
      if (!/^files\/[^\\/]+$/.test(item.archived)) continue;
      files.push({ original: item.original, archived: item.archived, size: Number(item.size) || 0 });
    }
    return {
      format: 2,
      app: "arenacue-scoreboard",
      appVersion: typeof raw.appVersion === "string" ? raw.appVersion : "",
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
      files,
      skipped: [],
    };
  } catch {
    return null;
  }
}

function isSqliteFile(file: string): boolean {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const head = Buffer.alloc(16);
      fs.readSync(fd, head, 0, 16, 0);
      return head.toString("latin1") === SQLITE_HEADER;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** -1, 0 of 1 voor versies als "0.1.36"; onbekende delen tellen als 0. */
export function compareVersions(a: string, b: string): number {
  const parts = (value: string) => value.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length, 3); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Kijkt een uitgepakte back-up na. De database mag in `stadium-backup/data/` staan (zo maakt de app
 * ze) of rechtstreeks in `data/` (als iemand de map zelf heeft gezipt).
 */
export function inspectBackupDir(dir: string, appVersion: string): BackupInspection {
  const root = [path.join(dir, BACKUP_ROOT_DIR), dir].find((candidate) =>
    fs.existsSync(path.join(candidate, "data", DB_NAME)),
  );
  if (!root) return { ok: false, reason: "no_database" };
  if (!isSqliteFile(path.join(root, "data", DB_NAME))) return { ok: false, reason: "not_a_database" };
  const manifest = readManifest(root);
  // Een oudere app kent de kolommen van een nieuwere database niet: eerst de app bijwerken.
  if (manifest?.appVersion && compareVersions(manifest.appVersion, appVersion) > 0) {
    return { ok: false, reason: "newer_version", backupVersion: manifest.appVersion };
  }
  return { ok: true, root, manifest };
}

/* ————————————————————————— terugzetten bij het opstarten ————————————————————————— */

export type RestoreFollowup = {
  appliedAt: string;
  /** Datum en versie van de back-up, voor de melding aan de operator. */
  backupCreatedAt: string | null;
  backupVersion: string | null;
  /** Oud pad → nieuw pad in `/uploads/`, voor media die op deze pc niet meer op de oude plek staat. */
  remap: Record<string, string>;
  safetyDir: string;
};

export type RestoreApplyResult =
  | { kind: "none" }
  | { kind: "applied"; followup: RestoreFollowup }
  | { kind: "failed"; error: string };

/** Verplaatst een bestand of map; valt terug op kopiëren als hernoemen niet kan (andere schijf). */
function move(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch {
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

function pruneSafetyCopies(safetyRoot: string, keepName: string): void {
  let names: string[] = [];
  try {
    names = fs.readdirSync(safetyRoot);
  } catch {
    return;
  }
  for (const name of names) {
    if (name !== keepName) fs.rmSync(path.join(safetyRoot, name), { recursive: true, force: true });
  }
}

function uniqueUploadName(uploadsDir: string, wanted: string): string {
  if (!fs.existsSync(path.join(uploadsDir, wanted))) return wanted;
  const ext = path.extname(wanted);
  const stem = wanted.slice(0, wanted.length - ext.length);
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem}-${n}${ext}`;
    if (!fs.existsSync(path.join(uploadsDir, candidate))) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

function restoreConfigFiles(root: string, userDataDir: string): void {
  const configDir = path.join(root, "config");
  const layout = path.join(configDir, MATCH_TAB_LAYOUT_FILE);
  if (fs.existsSync(layout)) fs.copyFileSync(layout, path.join(userDataDir, MATCH_TAB_LAYOUT_FILE));

  const livestream = path.join(configDir, LIVESTREAM_SETTINGS_FILE);
  if (!fs.existsSync(livestream)) return;
  try {
    const restored = JSON.parse(fs.readFileSync(livestream, "utf8")) as Record<string, unknown>;
    const target = path.join(userDataDir, LIVESTREAM_SETTINGS_FILE);
    // De streamsleutels van deze pc blijven; de back-up bevat er geen.
    let local: Record<string, unknown> = {};
    try {
      local = JSON.parse(fs.readFileSync(target, "utf8")) as Record<string, unknown>;
    } catch {
      /* nog geen instellingen op deze pc */
    }
    for (const key of LIVESTREAM_SECRET_KEYS) {
      if (typeof local[key] === "string") restored[key] = local[key];
      else delete restored[key];
    }
    fs.writeFileSync(target, JSON.stringify(restored, null, 2), "utf8");
  } catch {
    /* kapot bestand in de back-up: livestream-instellingen van deze pc blijven staan */
  }
}

/**
 * Wisselt de database en uploads om voor die uit `restore-pending/`. Roep dit aan vóórdat er een
 * databaseverbinding open is. Wat er stond gaat naar `restore-safety/<datum>/` (alleen de laatste
 * blijft bewaard). Gaat er iets mis, dan komt de oude toestand terug.
 */
export function applyPendingRestore(opts: {
  userDataDir: string;
  appVersion: string;
  now?: Date;
  /** Bestaat dit pad op deze pc? Vervangbaar in tests. */
  fileExists?: (file: string) => boolean;
}): RestoreApplyResult {
  const pending = path.join(opts.userDataDir, RESTORE_PENDING_DIR);
  if (!fs.existsSync(pending)) return { kind: "none" };
  if (!fs.existsSync(path.join(pending, RESTORE_READY_MARKER))) {
    // Uitpakken werd onderbroken: opruimen en gewoon starten.
    fs.rmSync(pending, { recursive: true, force: true });
    return { kind: "none" };
  }

  const fileExists = opts.fileExists ?? ((file: string) => fs.existsSync(file));
  const dataDir = path.join(opts.userDataDir, "data");
  const uploadsDir = path.join(opts.userDataDir, "uploads");
  const stamp = (opts.now ?? new Date()).toISOString().slice(0, 19).replace(/:/g, "-");
  const safetyRoot = path.join(opts.userDataDir, RESTORE_SAFETY_DIR);
  const safetyDir = path.join(safetyRoot, stamp);
  const movedDb: string[] = [];
  const placedDb: string[] = [];
  let movedUploads = false;

  try {
    const inspection = inspectBackupDir(pending, opts.appVersion);
    if (!inspection.ok) throw new Error(`Back-up is niet bruikbaar (${inspection.reason}).`);
    const { root, manifest } = inspection;

    // 1. Wat er nu staat veiligstellen.
    fs.mkdirSync(path.join(safetyDir, "data"), { recursive: true });
    for (const name of DB_FILES) {
      const current = path.join(dataDir, name);
      if (fs.existsSync(current)) {
        move(current, path.join(safetyDir, "data", name));
        movedDb.push(name);
      }
    }
    if (fs.existsSync(uploadsDir)) {
      move(uploadsDir, path.join(safetyDir, "uploads"));
      movedUploads = true;
    }

    // 2. De back-up op zijn plaats zetten.
    fs.mkdirSync(dataDir, { recursive: true });
    for (const name of DB_FILES) {
      const restored = path.join(root, "data", name);
      if (fs.existsSync(restored)) {
        move(restored, path.join(dataDir, name));
        placedDb.push(name);
      }
    }
    const restoredUploads = path.join(root, "uploads");
    if (fs.existsSync(restoredUploads)) move(restoredUploads, uploadsDir);
    else fs.mkdirSync(uploadsDir, { recursive: true });

    // 3. Media die elders stond: alleen terugzetten als ze op deze pc niet meer op de oude plek staat.
    const remap: Record<string, string> = {};
    for (const file of manifest?.files ?? []) {
      const archived = path.join(root, ...file.archived.split("/"));
      if (!fs.existsSync(archived) || fileExists(file.original)) continue;
      const name = uniqueUploadName(uploadsDir, `restored-${path.basename(archived)}`);
      move(archived, path.join(uploadsDir, name));
      remap[file.original] = `/uploads/${name}`;
    }

    // 4. Instellingen naast de database.
    restoreConfigFiles(root, opts.userDataDir);

    const followup: RestoreFollowup = {
      appliedAt: (opts.now ?? new Date()).toISOString(),
      backupCreatedAt: manifest?.createdAt || null,
      backupVersion: manifest?.appVersion || null,
      remap,
      safetyDir,
    };
    fs.writeFileSync(path.join(opts.userDataDir, RESTORE_FOLLOWUP_FILE), JSON.stringify(followup, null, 2), "utf8");
    fs.rmSync(pending, { recursive: true, force: true });
    pruneSafetyCopies(safetyRoot, stamp);
    return { kind: "applied", followup };
  } catch (err) {
    // Terug naar hoe het was: de app moet met de oude gegevens blijven starten. Alleen weghalen wat
    // deze stap zelf heeft neergezet; faalt de controle vooraf, dan is er nog niets aangeraakt.
    try {
      for (const name of placedDb) fs.rmSync(path.join(dataDir, name), { force: true });
      for (const name of movedDb) move(path.join(safetyDir, "data", name), path.join(dataDir, name));
      if (movedUploads) {
        fs.rmSync(uploadsDir, { recursive: true, force: true });
        move(path.join(safetyDir, "uploads"), uploadsDir);
      }
      fs.rmSync(safetyDir, { recursive: true, force: true });
    } catch {
      /* de veiligheidskopie blijft dan in restore-safety staan */
    }
    fs.rmSync(pending, { recursive: true, force: true });
    return { kind: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Leest het vervolg na terugzetten en verwijdert het bestand: het wordt één keer verwerkt. */
export function takeRestoreFollowup(userDataDir: string): RestoreFollowup | null {
  const file = path.join(userDataDir, RESTORE_FOLLOWUP_FILE);
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<RestoreFollowup>;
    fs.rmSync(file, { force: true });
    const remap: Record<string, string> = {};
    if (raw.remap && typeof raw.remap === "object") {
      for (const [from, to] of Object.entries(raw.remap)) {
        if (typeof to === "string" && to.startsWith("/uploads/")) remap[from] = to;
      }
    }
    return {
      appliedAt: typeof raw.appliedAt === "string" ? raw.appliedAt : new Date().toISOString(),
      backupCreatedAt: typeof raw.backupCreatedAt === "string" ? raw.backupCreatedAt : null,
      backupVersion: typeof raw.backupVersion === "string" ? raw.backupVersion : null,
      remap,
      safetyDir: typeof raw.safetyDir === "string" ? raw.safetyDir : "",
    };
  } catch {
    fs.rmSync(file, { force: true });
    return null;
  }
}
