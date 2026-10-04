import fs from "node:fs";
import path from "node:path";

const VERSION_MARKER = "app-version.txt";
const BACKUP_DIR = "backups";
/** De WAL- en SHM-bestanden horen erbij: na een crash staan de laatste schrijfacties alleen daarin. */
const DB_FILES = ["stadium.db", "stadium.db-wal", "stadium.db-shm"];
const DEFAULT_KEEP = 5;

export type UpgradeBackupResult =
  | { kind: "skipped"; reason: "same_version" | "no_database" }
  | { kind: "created"; dir: string; fromVersion: string | null }
  | { kind: "failed"; error: string };

function readMarker(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}

function pruneBackups(backupsRoot: string, keep: number): void {
  const dirs = fs
    .readdirSync(backupsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of dirs.slice(0, Math.max(0, dirs.length - keep))) {
    fs.rmSync(path.join(backupsRoot, name), { recursive: true, force: true });
  }
}

/**
 * Kopieert de clubdatabase één keer per nieuwe app-versie naar `data/backups/`, vóórdat de app
 * ze opent en het schema bijwerkt. Terugzetten = de bestanden uit de map terug naar `data/` kopiëren.
 *
 * Roep dit aan voordat er een databaseverbinding open is. Een mislukte kopie houdt het opstarten
 * niet tegen; de volgende start probeert het opnieuw.
 */
export function backupDatabaseBeforeUpgrade(opts: {
  dataDir: string;
  version: string;
  keep?: number;
  now?: Date;
}): UpgradeBackupResult {
  const marker = path.join(opts.dataDir, VERSION_MARKER);
  const previous = readMarker(marker);
  if (previous === opts.version) {
    return { kind: "skipped", reason: "same_version" };
  }

  try {
    if (!fs.existsSync(path.join(opts.dataDir, DB_FILES[0]))) {
      fs.writeFileSync(marker, opts.version, "utf8");
      return { kind: "skipped", reason: "no_database" };
    }

    const stamp = (opts.now ?? new Date()).toISOString().slice(0, 19).replace(/:/g, "-");
    const backupsRoot = path.join(opts.dataDir, BACKUP_DIR);
    const dir = path.join(backupsRoot, `${stamp}-van-${(previous ?? "onbekend").replace(/[^\w.-]/g, "_")}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const name of DB_FILES) {
      const from = path.join(opts.dataDir, name);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, name));
    }
    pruneBackups(backupsRoot, opts.keep ?? DEFAULT_KEEP);
    fs.writeFileSync(marker, opts.version, "utf8");
    return { kind: "created", dir, fromVersion: previous };
  } catch (err) {
    return { kind: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
