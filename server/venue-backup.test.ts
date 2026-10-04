import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import {
  BACKUP_MANIFEST,
  BACKUP_ROOT_DIR,
  RESTORE_FOLLOWUP_FILE,
  RESTORE_PENDING_DIR,
  RESTORE_READY_MARKER,
  RESTORE_SAFETY_DIR,
  applyPendingRestore,
  archivedFileName,
  collectExternalPaths,
  compareVersions,
  inspectBackupDir,
  isExternalFilePath,
  listExternalFileReferences,
  remapStoredFilePaths,
  replaceExternalPaths,
  stageConfigFiles,
  stageExternalFiles,
  takeRestoreFollowup,
  writeManifest,
  type BackupManifest,
} from "./venue-backup";

const SQLITE = Buffer.concat([Buffer.from("SQLite format 3\u0000", "latin1"), Buffer.alloc(84)]);

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arenacue-venue-backup-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(file: string, content: string | Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Een pc met eigen gegevens: database, een upload en instellingen. */
function makeUserData(name: string, marker: string): string {
  const dir = path.join(tmp, name);
  write(path.join(dir, "data", "stadium.db"), Buffer.concat([SQLITE, Buffer.from(marker)]));
  write(path.join(dir, "data", "stadium.db-wal"), `wal-${marker}`);
  write(path.join(dir, "uploads", "music", "playlist.json"), `{"owner":"${marker}"}`);
  return dir;
}

/** Zet een uitgepakte back-up klaar in `restore-pending/`, zoals het hoofdproces dat doet. */
function stagePending(userData: string, opts: { marker: string; manifest?: Partial<BackupManifest>; ready?: boolean }) {
  const root = path.join(userData, RESTORE_PENDING_DIR, BACKUP_ROOT_DIR);
  write(path.join(root, "data", "stadium.db"), Buffer.concat([SQLITE, Buffer.from(opts.marker)]));
  write(path.join(root, "uploads", "logo.png"), `upload-${opts.marker}`);
  if (opts.manifest) {
    writeManifest(root, {
      format: 2,
      app: "arenacue-scoreboard",
      appVersion: "0.1.36",
      createdAt: "2026-10-01T10:00:00.000Z",
      files: [],
      skipped: [],
      ...opts.manifest,
    });
  }
  if (opts.ready !== false) write(path.join(userData, RESTORE_PENDING_DIR, RESTORE_READY_MARKER), "{}");
  return root;
}

describe("paden in de database", () => {
  it("herkent Windows- en netwerkpaden op Windows", () => {
    expect(isExternalFilePath("C:\\Users\\club\\Videos\\sponsor.mp4", "win32")).toBe(true);
    expect(isExternalFilePath("d:/media/logo.png", "win32")).toBe(true);
    expect(isExternalFilePath("\\\\nas\\media\\clip.mp4", "win32")).toBe(true);
    expect(isExternalFilePath("/uploads/logo.png", "win32")).toBe(false);
    expect(isExternalFilePath("/sponsors", "win32")).toBe(false);
    expect(isExternalFilePath("#16a34a", "win32")).toBe(false);
    expect(isExternalFilePath("https://arenacue.be/x", "win32")).toBe(false);
  });

  it("herkent Unix-paden elders, maar niet de eigen uploads", () => {
    expect(isExternalFilePath("/home/club/clip.mp4", "linux")).toBe(true);
    expect(isExternalFilePath("/uploads/logo.png", "linux")).toBe(false);
    expect(isExternalFilePath("//cdn.example/x", "linux")).toBe(false);
  });

  it("vindt paden in een losse waarde en binnen JSON", () => {
    const found = new Set<string>();
    const file = path.join(tmp, "clip.mp4");
    collectExternalPaths(file, found);
    collectExternalPaths(JSON.stringify({ fullBackgroundPath: file + "2", elements: { full: [{ src: file + "3" }] } }), found);
    collectExternalPaths("Thuisploeg", found);
    collectExternalPaths("{kapotte json", found);
    collectExternalPaths(null, found);
    expect([...found].sort()).toEqual([file, file + "2", file + "3"]);
  });

  it("vervangt alleen exacte paden, ook diep in JSON", () => {
    const file = path.join(tmp, "bg.png");
    const remap = { [file]: "/uploads/restored-0001-bg.png" };
    expect(replaceExternalPaths(file, remap)).toBe("/uploads/restored-0001-bg.png");
    expect(replaceExternalPaths(file + ".bak", remap)).toBeNull();
    const json = JSON.stringify({ a: 1, bg: file, list: [{ src: file }, "blijft"] });
    expect(JSON.parse(replaceExternalPaths(json, remap) ?? "null")).toEqual({
      a: 1,
      bg: "/uploads/restored-0001-bg.png",
      list: [{ src: "/uploads/restored-0001-bg.png" }, "blijft"],
    });
    expect(replaceExternalPaths(JSON.stringify({ a: 1 }), remap)).toBeNull();
  });

  it("geeft bestanden in de back-up een veilige, unieke naam", () => {
    expect(archivedFileName(0, "C:\\Media\\Sponsor A (2026).mp4")).toBe("0001-Sponsor A _2026_.mp4");
    expect(archivedFileName(11, "/home/x/y/logo.png")).toBe("0012-logo.png");
  });

  it("vergelijkt versies numeriek", () => {
    expect(compareVersions("0.1.36", "0.1.36")).toBe(0);
    expect(compareVersions("0.1.9", "0.1.36")).toBe(-1);
    expect(compareVersions("0.2.0", "0.1.36")).toBe(1);
    expect(compareVersions("1.0", "0.9.9")).toBe(1);
  });
});

describe("back-up samenstellen", () => {
  it("neemt externe bestanden mee en meldt wat ontbreekt", () => {
    const clip = path.join(tmp, "media", "clip.mp4");
    write(clip, "video");
    const staging = path.join(tmp, "staging", BACKUP_ROOT_DIR);
    fs.mkdirSync(staging, { recursive: true });
    const result = stageExternalFiles(staging, [clip, path.join(tmp, "weg.mp4"), path.join(tmp, "media")]);
    expect(result.files).toEqual([{ original: clip, archived: "files/0001-clip.mp4", size: 5 }]);
    expect(result.skipped.map((item) => item.reason)).toEqual(["missing", "missing"]);
    expect(fs.readFileSync(path.join(staging, "files", "0001-clip.mp4"), "utf8")).toBe("video");
    // De bron blijft staan, ook als de kopie een harde koppeling is en daarna wordt opgeruimd.
    fs.rmSync(staging, { recursive: true, force: true });
    expect(fs.readFileSync(clip, "utf8")).toBe("video");
  });

  it("laat streamsleutels uit de back-up", () => {
    const userData = path.join(tmp, "pc");
    write(path.join(userData, "livestream-settings.json"), JSON.stringify({ streamKey: "geheim", streamKey2: "ook", fps: 30 }));
    write(path.join(userData, "control-match-tab-layout.json"), '{"layout":1}');
    const staging = path.join(tmp, "staging");
    fs.mkdirSync(staging, { recursive: true });
    stageConfigFiles(staging, userData);
    expect(JSON.parse(fs.readFileSync(path.join(staging, "config", "livestream-settings.json"), "utf8"))).toEqual({ fps: 30 });
    expect(fs.readFileSync(path.join(staging, "config", "control-match-tab-layout.json"), "utf8")).toBe('{"layout":1}');
  });
});

describe("back-up nakijken", () => {
  it("aanvaardt een back-up van de app en een zelf gezipte map", () => {
    const viaApp = path.join(tmp, "a");
    write(path.join(viaApp, BACKUP_ROOT_DIR, "data", "stadium.db"), SQLITE);
    expect(inspectBackupDir(viaApp, "0.1.36")).toMatchObject({ ok: true, root: path.join(viaApp, BACKUP_ROOT_DIR), manifest: null });
    const zelf = path.join(tmp, "b");
    write(path.join(zelf, "data", "stadium.db"), SQLITE);
    expect(inspectBackupDir(zelf, "0.1.36")).toMatchObject({ ok: true, root: zelf });
  });

  it("weigert een map zonder database of met een ander bestand", () => {
    const leeg = path.join(tmp, "leeg");
    fs.mkdirSync(leeg);
    expect(inspectBackupDir(leeg, "0.1.36")).toEqual({ ok: false, reason: "no_database" });
    const fout = path.join(tmp, "fout");
    write(path.join(fout, "data", "stadium.db"), "dit is geen database");
    expect(inspectBackupDir(fout, "0.1.36")).toEqual({ ok: false, reason: "not_a_database" });
  });

  it("weigert een back-up van een nieuwere app-versie", () => {
    const dir = path.join(tmp, "nieuw");
    write(path.join(dir, BACKUP_ROOT_DIR, "data", "stadium.db"), SQLITE);
    write(path.join(dir, BACKUP_ROOT_DIR, BACKUP_MANIFEST), JSON.stringify({ appVersion: "0.2.0", files: [] }));
    expect(inspectBackupDir(dir, "0.1.36")).toEqual({ ok: false, reason: "newer_version", backupVersion: "0.2.0" });
    expect(inspectBackupDir(dir, "0.2.0")).toMatchObject({ ok: true });
  });

  it("negeert bestandsverwijzingen die buiten de back-up wijzen", () => {
    const dir = path.join(tmp, "kwaad");
    write(path.join(dir, "data", "stadium.db"), SQLITE);
    write(
      path.join(dir, BACKUP_MANIFEST),
      JSON.stringify({
        appVersion: "0.1.0",
        files: [
          { original: "C:\\a.mp4", archived: "files/0001-a.mp4", size: 1 },
          { original: "C:\\b.mp4", archived: "../../Windows/system.ini", size: 1 },
          { original: "C:\\c.mp4", archived: "files/sub/c.mp4", size: 1 },
        ],
      }),
    );
    const result = inspectBackupDir(dir, "0.1.36");
    expect(result.ok && result.manifest?.files.map((file) => file.archived)).toEqual(["files/0001-a.mp4"]);
  });
});

describe("terugzetten bij het opstarten", () => {
  const now = new Date("2026-10-04T12:00:00Z");

  it("doet niets zonder klaarstaande back-up", () => {
    const userData = makeUserData("pc", "huidig");
    expect(applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now })).toEqual({ kind: "none" });
    expect(fs.readFileSync(path.join(userData, "data", "stadium.db")).toString("latin1")).toContain("huidig");
  });

  it("ruimt een half uitgepakte back-up op zonder iets te wijzigen", () => {
    const userData = makeUserData("pc", "huidig");
    stagePending(userData, { marker: "backup", ready: false });
    expect(applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now })).toEqual({ kind: "none" });
    expect(fs.existsSync(path.join(userData, RESTORE_PENDING_DIR))).toBe(false);
    expect(fs.readFileSync(path.join(userData, "data", "stadium.db")).toString("latin1")).toContain("huidig");
  });

  it("zet database en uploads terug en bewaart wat er stond", () => {
    const userData = makeUserData("pc", "huidig");
    stagePending(userData, { marker: "backup", manifest: {} });
    const result = applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now });
    expect(result.kind).toBe("applied");

    expect(fs.readFileSync(path.join(userData, "data", "stadium.db")).toString("latin1")).toContain("backup");
    // De WAL van de oude database hoort niet bij de teruggezette database.
    expect(fs.existsSync(path.join(userData, "data", "stadium.db-wal"))).toBe(false);
    expect(fs.readFileSync(path.join(userData, "uploads", "logo.png"), "utf8")).toBe("upload-backup");
    expect(fs.existsSync(path.join(userData, "uploads", "music"))).toBe(false);

    const safety = path.join(userData, RESTORE_SAFETY_DIR, "2026-10-04T12-00-00");
    expect(fs.readFileSync(path.join(safety, "data", "stadium.db")).toString("latin1")).toContain("huidig");
    expect(fs.readFileSync(path.join(safety, "data", "stadium.db-wal"), "utf8")).toBe("wal-huidig");
    expect(fs.existsSync(path.join(safety, "uploads", "music", "playlist.json"))).toBe(true);
    expect(fs.existsSync(path.join(userData, RESTORE_PENDING_DIR))).toBe(false);

    const followup = takeRestoreFollowup(userData);
    expect(followup).toMatchObject({ backupVersion: "0.1.36", backupCreatedAt: "2026-10-01T10:00:00.000Z", remap: {} });
    expect(fs.existsSync(path.join(userData, RESTORE_FOLLOWUP_FILE))).toBe(false);
    expect(takeRestoreFollowup(userData)).toBeNull();
  });

  it("zet media van elders alleen terug als ze op deze pc ontbreekt", () => {
    const userData = makeUserData("pc", "huidig");
    const hier = path.join(tmp, "media", "blijft.mp4");
    write(hier, "staat er nog");
    const weg = path.join(tmp, "media", "weg.mp4");
    const root = stagePending(userData, {
      marker: "backup",
      manifest: {
        files: [
          { original: hier, archived: "files/0001-blijft.mp4", size: 3 },
          { original: weg, archived: "files/0002-weg.mp4", size: 3 },
        ],
      },
    });
    write(path.join(root, "files", "0001-blijft.mp4"), "uit backup 1");
    write(path.join(root, "files", "0002-weg.mp4"), "uit backup 2");

    const result = applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now });
    expect(result).toMatchObject({ kind: "applied", followup: { remap: { [weg]: "/uploads/restored-0002-weg.mp4" } } });
    expect(fs.readFileSync(path.join(userData, "uploads", "restored-0002-weg.mp4"), "utf8")).toBe("uit backup 2");
    expect(fs.existsSync(path.join(userData, "uploads", "restored-0001-blijft.mp4"))).toBe(false);
    expect(fs.readFileSync(hier, "utf8")).toBe("staat er nog");
  });

  it("zet instellingen terug maar houdt de streamsleutels van deze pc", () => {
    const userData = makeUserData("pc", "huidig");
    write(path.join(userData, "livestream-settings.json"), JSON.stringify({ streamKey: "lokaal", fps: 25 }));
    const root = stagePending(userData, { marker: "backup", manifest: {} });
    write(path.join(root, "config", "livestream-settings.json"), JSON.stringify({ fps: 60, streamKey2: "mag niet" }));
    write(path.join(root, "config", "control-match-tab-layout.json"), '{"van":"backup"}');
    expect(applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now }).kind).toBe("applied");
    expect(JSON.parse(fs.readFileSync(path.join(userData, "livestream-settings.json"), "utf8"))).toEqual({ fps: 60, streamKey: "lokaal" });
    expect(fs.readFileSync(path.join(userData, "control-match-tab-layout.json"), "utf8")).toBe('{"van":"backup"}');
  });

  it("laat alles staan als de back-up niet bruikbaar is", () => {
    const userData = makeUserData("pc", "huidig");
    const root = stagePending(userData, { marker: "backup" });
    fs.writeFileSync(path.join(root, "data", "stadium.db"), "geen database");
    const result = applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now });
    expect(result.kind).toBe("failed");
    expect(fs.readFileSync(path.join(userData, "data", "stadium.db")).toString("latin1")).toContain("huidig");
    expect(fs.readFileSync(path.join(userData, "data", "stadium.db-wal"), "utf8")).toBe("wal-huidig");
    expect(fs.existsSync(path.join(userData, "uploads", "music", "playlist.json"))).toBe(true);
    expect(fs.existsSync(path.join(userData, RESTORE_PENDING_DIR))).toBe(false);
    expect(fs.existsSync(path.join(userData, RESTORE_FOLLOWUP_FILE))).toBe(false);
  });

  it("werkt op een nieuwe pc zonder bestaande gegevens", () => {
    const userData = path.join(tmp, "nieuw");
    fs.mkdirSync(userData, { recursive: true });
    stagePending(userData, { marker: "backup", manifest: {} });
    expect(applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now }).kind).toBe("applied");
    expect(fs.readFileSync(path.join(userData, "data", "stadium.db")).toString("latin1")).toContain("backup");
    expect(fs.readFileSync(path.join(userData, "uploads", "logo.png"), "utf8")).toBe("upload-backup");
  });

  it("bewaart alleen de laatste veiligheidskopie", () => {
    const userData = makeUserData("pc", "een");
    stagePending(userData, { marker: "twee", manifest: {} });
    applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now });
    stagePending(userData, { marker: "drie", manifest: {} });
    applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now: new Date("2026-10-05T12:00:00Z") });
    expect(fs.readdirSync(path.join(userData, RESTORE_SAFETY_DIR))).toEqual(["2026-10-05T12-00-00"]);
    expect(fs.readFileSync(path.join(userData, "data", "stadium.db")).toString("latin1")).toContain("drie");
  });
});

describe("paden in een echte database", () => {
  let dbDir: string;
  let prisma: PrismaClient;

  beforeAll(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "arenacue-venue-backup-db-"));
    process.env.DATABASE_URL = `file:${path.join(dbDir, "test.db").replace(/\\/g, "/")}?connection_limit=1`;
    await (await import("./db-init")).ensureSqliteSchema();
    prisma = (await import("../lib/prisma")).prisma;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    try {
      fs.rmSync(dbDir, { recursive: true, force: true });
    } catch {
      /* Windows kan het bestand nog even vasthouden */
    }
  });

  it("vindt en vervangt paden in kolommen en in JSON", async () => {
    const clip = path.join(dbDir, "media", "clip.mp4");
    const logo = path.join(dbDir, "media", "logo.png");
    const background = path.join(dbDir, "media", "achtergrond.jpg");
    const media = await prisma.mediaItem.create({ data: { type: "VIDEO", path: clip, title: "Clip", durationSec: 10 } });
    const eigen = await prisma.mediaItem.create({
      data: { type: "IMAGE", path: "/uploads/eigen.png", title: "Eigen", durationSec: 5 },
    });
    const team = await prisma.team.create({
      data: { name: "Thuis", shortName: "THU", primaryColor: "#111111", secondaryColor: "#ffffff", logoPath: logo },
    });
    const theme = JSON.stringify({ fullBackgroundPath: background, elements: { full: [{ id: "el-1", type: "image", src: logo }] } });
    const template = await prisma.scoreboardTemplate.create({ data: { name: "Test", themeJson: theme } });

    expect(await listExternalFileReferences(prisma)).toEqual([background, clip, logo].sort());

    const changed = await remapStoredFilePaths(prisma, {
      [clip]: "/uploads/restored-0001-clip.mp4",
      [logo]: "/uploads/restored-0002-logo.png",
    });
    expect(changed).toBe(3);
    expect((await prisma.mediaItem.findUnique({ where: { id: media.id } }))?.path).toBe("/uploads/restored-0001-clip.mp4");
    expect((await prisma.mediaItem.findUnique({ where: { id: eigen.id } }))?.path).toBe("/uploads/eigen.png");
    expect((await prisma.team.findUnique({ where: { id: team.id } }))?.logoPath).toBe("/uploads/restored-0002-logo.png");
    const saved = JSON.parse((await prisma.scoreboardTemplate.findUnique({ where: { id: template.id } }))?.themeJson ?? "{}");
    expect(saved.elements.full[0].src).toBe("/uploads/restored-0002-logo.png");
    expect(saved.fullBackgroundPath).toBe(background);
    expect(await listExternalFileReferences(prisma)).toEqual([background]);
    expect(await remapStoredFilePaths(prisma, {})).toBe(0);
  });
});
