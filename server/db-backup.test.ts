import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupDatabaseBeforeUpgrade } from "./db-backup";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arenacue-db-backup-"));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function writeDb(content: string) {
  fs.writeFileSync(path.join(dataDir, "stadium.db"), content);
}

function backups(): string[] {
  const root = path.join(dataDir, "backups");
  return fs.existsSync(root) ? fs.readdirSync(root).sort() : [];
}

describe("backupDatabaseBeforeUpgrade", () => {
  it("maakt bij een nieuwe versie één kopie van database, WAL en SHM", () => {
    writeDb("db-v1");
    fs.writeFileSync(path.join(dataDir, "stadium.db-wal"), "wal-v1");
    fs.writeFileSync(path.join(dataDir, "stadium.db-shm"), "shm-v1");
    fs.writeFileSync(path.join(dataDir, "app-version.txt"), "0.1.33\n");

    const result = backupDatabaseBeforeUpgrade({ dataDir, version: "0.1.34", now: new Date("2026-10-03T20:22:18Z") });

    expect(result.kind).toBe("created");
    expect(backups()).toEqual(["2026-10-03T20-22-18-van-0.1.33"]);
    const dir = path.join(dataDir, "backups", backups()[0]);
    expect(fs.readFileSync(path.join(dir, "stadium.db"), "utf8")).toBe("db-v1");
    expect(fs.readFileSync(path.join(dir, "stadium.db-wal"), "utf8")).toBe("wal-v1");
    expect(fs.readFileSync(path.join(dir, "stadium.db-shm"), "utf8")).toBe("shm-v1");
    expect(fs.readFileSync(path.join(dataDir, "app-version.txt"), "utf8")).toBe("0.1.34");
  });

  it("doet niets bij dezelfde versie", () => {
    writeDb("db");
    backupDatabaseBeforeUpgrade({ dataDir, version: "0.1.34" });
    expect(backups()).toHaveLength(1);

    writeDb("db-changed");
    expect(backupDatabaseBeforeUpgrade({ dataDir, version: "0.1.34" })).toEqual({
      kind: "skipped",
      reason: "same_version",
    });
    expect(backups()).toHaveLength(1);
  });

  it("maakt ook een kopie als de vorige versie onbekend is (eerste start met deze functie)", () => {
    writeDb("db");
    const result = backupDatabaseBeforeUpgrade({ dataDir, version: "0.1.35", now: new Date("2026-10-04T09:00:00Z") });
    expect(result).toMatchObject({ kind: "created", fromVersion: null });
    expect(backups()).toEqual(["2026-10-04T09-00-00-van-onbekend"]);
  });

  it("slaat een verse installatie zonder database over maar onthoudt de versie", () => {
    expect(backupDatabaseBeforeUpgrade({ dataDir, version: "0.1.35" })).toEqual({
      kind: "skipped",
      reason: "no_database",
    });
    expect(backups()).toEqual([]);
    expect(fs.readFileSync(path.join(dataDir, "app-version.txt"), "utf8")).toBe("0.1.35");
  });

  it("bewaart alleen de nieuwste kopieën", () => {
    writeDb("db");
    for (let i = 1; i <= 7; i++) {
      backupDatabaseBeforeUpgrade({
        dataDir,
        version: `0.2.${i}`,
        keep: 3,
        now: new Date(`2026-11-0${i}T10:00:00Z`),
      });
    }
    expect(backups()).toEqual([
      "2026-11-05T10-00-00-van-0.2.4",
      "2026-11-06T10-00-00-van-0.2.5",
      "2026-11-07T10-00-00-van-0.2.6",
    ]);
  });

  it("meldt een mislukte kopie en probeert het bij de volgende start opnieuw", () => {
    writeDb("db");
    // Een bestand op de plek van de back-upmap maakt het aanmaken van de map onmogelijk.
    fs.writeFileSync(path.join(dataDir, "backups"), "geen map");
    const failed = backupDatabaseBeforeUpgrade({ dataDir, version: "0.1.35" });
    expect(failed.kind).toBe("failed");
    expect(fs.existsSync(path.join(dataDir, "app-version.txt"))).toBe(false);

    fs.rmSync(path.join(dataDir, "backups"));
    expect(backupDatabaseBeforeUpgrade({ dataDir, version: "0.1.35" }).kind).toBe("created");
  });
});
