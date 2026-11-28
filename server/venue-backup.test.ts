import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  BACKUP_MANIFEST,
  BACKUP_ROOT_DIR,
  RESTORE_FOLLOWUP_FILE,
  RESTORE_PENDING_DIR,
  RESTORE_READY_MARKER,
  RESTORE_SAFETY_DIR,
  acceptIncompleteRestore,
  applyPendingRestore,
  archivedFileName,
  canRollbackRestore,
  clearRestoreFollowup,
  collectExternalPaths,
  compareVersions,
  finishPendingRestore,
  inspectBackupDir,
  isExternalFilePath,
  listExternalFileReferences,
  readRestoreFollowup,
  remapStoredFilePaths,
  replaceExternalPaths,
  resolveStoredMediaPath,
  stageConfigFiles,
  stageExternalFiles,
  stageRollbackFromSafety,
  writeManifest,
  type BackupManifest,
  type RawDb,
  type RestoreFollowup,
} from "./venue-backup";

let SQLITE: Buffer;
beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arenacue-backup-fixture-"));
  const file = path.join(dir, "stadium.db");
  const copy = new PrismaClient({ datasourceUrl: "file:" + file.split(path.sep).join("/") });
  try {
    for (const name of ["Match", "Team", "MediaItem"]) {
      await copy.$executeRawUnsafe(`CREATE TABLE "${name}" (id TEXT PRIMARY KEY)`);
    }
  } finally {
    await copy.$disconnect();
    try { SQLITE = fs.readFileSync(file); } finally { fs.rmSync(dir, { recursive: true }); }
  }
});

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
  it("aanvaardt een back-up van de app en een zelf gezipte map", async () => {
    const viaApp = path.join(tmp, "a");
    write(path.join(viaApp, BACKUP_ROOT_DIR, "data", "stadium.db"), SQLITE);
    expect(await inspectBackupDir(viaApp, "0.1.36")).toMatchObject({ ok: true, root: path.join(viaApp, BACKUP_ROOT_DIR), manifest: null });
    const zelf = path.join(tmp, "b");
    write(path.join(zelf, "data", "stadium.db"), SQLITE);
    expect(await inspectBackupDir(zelf, "0.1.36")).toMatchObject({ ok: true, root: zelf });
  });

  it("weigert een map zonder database of met een ander bestand", async () => {
    const leeg = path.join(tmp, "leeg");
    fs.mkdirSync(leeg);
    expect(await inspectBackupDir(leeg, "0.1.36")).toEqual({ ok: false, reason: "no_database" });
    const fout = path.join(tmp, "fout");
    write(path.join(fout, "data", "stadium.db"), "dit is geen database");
    expect(await inspectBackupDir(fout, "0.1.36")).toEqual({ ok: false, reason: "not_a_database" });
  });

  it("weigert een back-up van een nieuwere app-versie", async () => {
    const dir = path.join(tmp, "nieuw");
    write(path.join(dir, BACKUP_ROOT_DIR, "data", "stadium.db"), SQLITE);
    write(path.join(dir, BACKUP_ROOT_DIR, BACKUP_MANIFEST), JSON.stringify({ appVersion: "0.2.0", files: [] }));
    expect(await inspectBackupDir(dir, "0.1.36")).toEqual({ ok: false, reason: "newer_version", backupVersion: "0.2.0" });
    expect(await inspectBackupDir(dir, "0.2.0")).toMatchObject({ ok: true });
  });

  it("negeert bestandsverwijzingen die buiten de back-up wijzen", async () => {
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
    const result = await inspectBackupDir(dir, "0.1.36");
    expect(result.ok && result.manifest?.files.map((file) => file.archived)).toEqual(["files/0001-a.mp4"]);
  });
});

describe("terugzetten bij het opstarten", () => {
  const now = new Date("2026-10-04T12:00:00Z");

  it("behoudt de actieve database wanneer de aangeleverde SQLite-pagina's afgeknot zijn", async () => {
    const userData = makeUserData("pc", "huidig");
    const root = stagePending(userData, { marker: "backup" });
    write(path.join(root, "data", "stadium.db"), SQLITE.subarray(0, Math.floor(SQLITE.length / 2)));
    expect(await applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now })).toMatchObject({ kind: "failed" });
    expect(fs.readFileSync(path.join(userData, "data", "stadium.db")).toString("latin1")).toContain("huidig");
  });

  it("doet niets zonder klaarstaande back-up", async () => {
    const userData = makeUserData("pc", "huidig");
    expect(await applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now })).toEqual({ kind: "none" });
    expect(fs.readFileSync(path.join(userData, "data", "stadium.db")).toString("latin1")).toContain("huidig");
  });

  it("ruimt een half uitgepakte back-up op zonder iets te wijzigen", async () => {
    const userData = makeUserData("pc", "huidig");
    stagePending(userData, { marker: "backup", ready: false });
    expect(await applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now })).toEqual({ kind: "none" });
    expect(fs.existsSync(path.join(userData, RESTORE_PENDING_DIR))).toBe(false);
    expect(fs.readFileSync(path.join(userData, "data", "stadium.db")).toString("latin1")).toContain("huidig");
  });

  it("zet database en uploads terug en bewaart wat er stond", async () => {
    const userData = makeUserData("pc", "huidig");
    stagePending(userData, { marker: "backup", manifest: {} });
    const result = await applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now });
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

    // Het vervolg blijft staan tot de database het verwerkt heeft.
    const followup = readRestoreFollowup(userData);
    expect(followup).toMatchObject({
      source: "backup",
      backupVersion: "0.1.36",
      backupCreatedAt: "2026-10-01T10:00:00.000Z",
      remap: {},
      pathsRewritten: true,
    });
    expect(readRestoreFollowup(userData)).toEqual(followup);
    clearRestoreFollowup(userData);
    expect(fs.existsSync(path.join(userData, RESTORE_FOLLOWUP_FILE))).toBe(false);
    expect(readRestoreFollowup(userData)).toBeNull();
  });

  it("zet media van elders alleen terug als ze op deze pc ontbreekt", async () => {
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

    const result = await applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now });
    expect(result).toMatchObject({
      kind: "applied",
      followup: { remap: { [weg]: "/uploads/restored-0002-weg.mp4" }, pathsRewritten: false },
    });
    expect(readRestoreFollowup(userData)?.pathsRewritten).toBe(false);
    expect(fs.readFileSync(path.join(userData, "uploads", "restored-0002-weg.mp4"), "utf8")).toBe("uit backup 2");
    expect(fs.existsSync(path.join(userData, "uploads", "restored-0001-blijft.mp4"))).toBe(false);
    expect(fs.readFileSync(hier, "utf8")).toBe("staat er nog");
  });

  it("zet instellingen terug maar houdt de streamsleutels van deze pc", async () => {
    const userData = makeUserData("pc", "huidig");
    write(path.join(userData, "livestream-settings.json"), JSON.stringify({ streamKey: "lokaal", fps: 25 }));
    const root = stagePending(userData, { marker: "backup", manifest: {} });
    write(path.join(root, "config", "livestream-settings.json"), JSON.stringify({ fps: 60, streamKey2: "mag niet" }));
    write(path.join(root, "config", "control-match-tab-layout.json"), '{"van":"backup"}');
    expect((await applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now })).kind).toBe("applied");
    expect(JSON.parse(fs.readFileSync(path.join(userData, "livestream-settings.json"), "utf8"))).toEqual({ fps: 60, streamKey: "lokaal" });
    expect(fs.readFileSync(path.join(userData, "control-match-tab-layout.json"), "utf8")).toBe('{"van":"backup"}');
  });

  it("laat alles staan als de back-up niet bruikbaar is", async () => {
    const userData = makeUserData("pc", "huidig");
    const root = stagePending(userData, { marker: "backup" });
    fs.writeFileSync(path.join(root, "data", "stadium.db"), "geen database");
    const result = await applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now });
    expect(result.kind).toBe("failed");
    expect(fs.readFileSync(path.join(userData, "data", "stadium.db")).toString("latin1")).toContain("huidig");
    expect(fs.readFileSync(path.join(userData, "data", "stadium.db-wal"), "utf8")).toBe("wal-huidig");
    expect(fs.existsSync(path.join(userData, "uploads", "music", "playlist.json"))).toBe(true);
    expect(fs.existsSync(path.join(userData, RESTORE_PENDING_DIR))).toBe(false);
    expect(fs.existsSync(path.join(userData, RESTORE_FOLLOWUP_FILE))).toBe(false);
  });

  it("werkt op een nieuwe pc zonder bestaande gegevens", async () => {
    const userData = path.join(tmp, "nieuw");
    fs.mkdirSync(userData, { recursive: true });
    stagePending(userData, { marker: "backup", manifest: {} });
    expect((await applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now })).kind).toBe("applied");
    expect(fs.readFileSync(path.join(userData, "data", "stadium.db")).toString("latin1")).toContain("backup");
    expect(fs.readFileSync(path.join(userData, "uploads", "logo.png"), "utf8")).toBe("upload-backup");
  });

  it("gaat terug naar de toestand van vóór het terugzetten", async () => {
    const userData = makeUserData("pc", "huidig");
    write(path.join(userData, "control-match-tab-layout.json"), '{"van":"pc"}');
    const root = stagePending(userData, { marker: "backup", manifest: {} });
    write(path.join(root, "config", "control-match-tab-layout.json"), '{"van":"backup"}');
    const applied = await applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now });
    if (applied.kind !== "applied") throw new Error("terugzetten mislukt");
    expect(canRollbackRestore(userData, applied.followup)).toBe(true);

    stageRollbackFromSafety(userData, applied.followup);
    // De veiligheidskopie blijft staan tot de omwisseling gelukt is.
    expect(fs.existsSync(path.join(applied.followup.safetyDir, "data", "stadium.db"))).toBe(true);
    const back = await applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now: new Date("2026-10-04T12:05:00Z") });
    expect(back).toMatchObject({ kind: "applied", followup: { source: "rollback" } });
    expect(readRestoreFollowup(userData)?.source).toBe("rollback");
    expect(fs.readFileSync(path.join(userData, "data", "stadium.db")).toString("latin1")).toContain("huidig");
    expect(fs.readFileSync(path.join(userData, "data", "stadium.db-wal"), "utf8")).toBe("wal-huidig");
    expect(fs.existsSync(path.join(userData, "uploads", "music", "playlist.json"))).toBe(true);
    expect(fs.existsSync(path.join(userData, "uploads", "logo.png"))).toBe(false);
    expect(fs.readFileSync(path.join(userData, "control-match-tab-layout.json"), "utf8")).toBe('{"van":"pc"}');
    // De teruggezette back-up is nu op zijn beurt de veiligheidskopie.
    expect(fs.readdirSync(path.join(userData, RESTORE_SAFETY_DIR))).toEqual(["2026-10-04T12-05-00"]);
  });

  it("biedt geen weg terug op een nieuwe pc of naar een map buiten restore-safety", async () => {
    const userData = path.join(tmp, "nieuw");
    fs.mkdirSync(userData, { recursive: true });
    stagePending(userData, { marker: "backup", manifest: {} });
    const applied = await applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now });
    if (applied.kind !== "applied") throw new Error("terugzetten mislukt");
    expect(canRollbackRestore(userData, applied.followup)).toBe(false);
    expect(() => stageRollbackFromSafety(userData, applied.followup)).toThrow();
    expect(fs.existsSync(path.join(userData, RESTORE_PENDING_DIR))).toBe(false);

    const elders = makeUserData("elders", "vreemd");
    expect(canRollbackRestore(userData, { ...applied.followup, safetyDir: elders })).toBe(false);
  });

  it("bewaart alleen de laatste veiligheidskopie", async () => {
    const userData = makeUserData("pc", "een");
    stagePending(userData, { marker: "twee", manifest: {} });
    await applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now });
    stagePending(userData, { marker: "drie", manifest: {} });
    await applyPendingRestore({ userDataDir: userData, appVersion: "0.1.36", now: new Date("2026-10-05T12:00:00Z") });
    expect(fs.readdirSync(path.join(userData, RESTORE_SAFETY_DIR))).toEqual(["2026-10-05T12-00-00"]);
    expect(fs.readFileSync(path.join(userData, "data", "stadium.db")).toString("latin1")).toContain("drie");
  });
});

describe("media terugvinden", () => {
  it("zet opgeslagen paden om naar een bestand op schijf", () => {
    const uploads = path.join(tmp, "uploads");
    expect(resolveStoredMediaPath("/uploads/sponsors/clip.mp4", uploads)).toBe(path.join(uploads, "sponsors", "clip.mp4"));
    const extern = path.join(tmp, "media", "clip.mp4");
    expect(resolveStoredMediaPath(extern, uploads)).toBe(extern);
    expect(resolveStoredMediaPath("https://arenacue.be/clip.mp4", uploads)).toBeNull();
    expect(resolveStoredMediaPath("/uploads/", uploads)).toBeNull();
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

  beforeEach(async () => {
    await prisma.mediaItem.deleteMany();
    await prisma.player.deleteMany();
    await prisma.team.deleteMany();
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

  describe("terugzetten afronden zodra de database open is", () => {
    let userData: string;
    let uploads: string;

    beforeEach(() => {
      userData = path.join(tmp, "pc");
      uploads = path.join(userData, "uploads");
      fs.mkdirSync(uploads, { recursive: true });
    });

    /** Het vervolgbestand zoals `applyPendingRestore` het achterlaat. */
    function writeFollowup(remap: Record<string, string>): void {
      const followup: RestoreFollowup = {
        source: "backup",
        appliedAt: "2026-10-04T12:00:00.000Z",
        backupCreatedAt: "2026-10-01T10:00:00.000Z",
        backupVersion: "0.1.36",
        remap,
        pathsRewritten: Object.keys(remap).length === 0,
        safetyDir: path.join(userData, RESTORE_SAFETY_DIR, "2026-10-04T12-00-00"),
      };
      write(path.join(userData, RESTORE_FOLLOWUP_FILE), JSON.stringify(followup));
    }

    /** Database die na `okWrites` geslaagde wijzigingen uitvalt, zoals bij een onderbroken start. */
    function failingAfter(okWrites: number): RawDb {
      let writes = 0;
      return {
        $queryRawUnsafe: (query, ...values) => prisma.$queryRawUnsafe(query, ...values),
        $executeRawUnsafe: async (query, ...values) => {
          if (writes >= okWrites) throw new Error("database is locked");
          writes += 1;
          return prisma.$executeRawUnsafe(query, ...values);
        },
      };
    }

    it("zet een onderbroken padwijziging bij de volgende start verder", async () => {
      const oud1 = path.join(dbDir, "weg", "sponsor-a.mp4");
      const oud2 = path.join(dbDir, "weg", "sponsor-b.mp4");
      const a = await prisma.mediaItem.create({ data: { type: "VIDEO", path: oud1, title: "Sponsor A", durationSec: 10 } });
      const b = await prisma.mediaItem.create({ data: { type: "VIDEO", path: oud2, title: "Sponsor B", durationSec: 10 } });
      write(path.join(uploads, "restored-0001-sponsor-a.mp4"), "a");
      write(path.join(uploads, "restored-0002-sponsor-b.mp4"), "b");
      writeFollowup({ [oud1]: "/uploads/restored-0001-sponsor-a.mp4", [oud2]: "/uploads/restored-0002-sponsor-b.mp4" });

      const eerste = await finishPendingRestore(failingAfter(1), { userDataDir: userData, uploadsDir: uploads });
      expect(eerste).toMatchObject({ kind: "incomplete", pathRewriteError: "database is locked" });
      // Het vervolg is er nog en weet dat de paden nog niet klaar zijn.
      expect(readRestoreFollowup(userData)).toMatchObject({ pathsRewritten: false });
      const paden = async () => [
        (await prisma.mediaItem.findUnique({ where: { id: a.id } }))?.path,
        (await prisma.mediaItem.findUnique({ where: { id: b.id } }))?.path,
      ];
      expect((await paden()).filter((p) => p?.startsWith("/uploads/"))).toHaveLength(1);

      // Verdergaan laat het vervolg staan zolang de paden niet in de database staan.
      if (eerste.kind === "incomplete") acceptIncompleteRestore(userData, eerste);
      expect(readRestoreFollowup(userData)).not.toBeNull();

      const tweede = await finishPendingRestore(prisma, { userDataDir: userData, uploadsDir: uploads });
      expect(tweede).toMatchObject({ kind: "restored", pathsChanged: 1 });
      expect(await paden()).toEqual(["/uploads/restored-0001-sponsor-a.mp4", "/uploads/restored-0002-sponsor-b.mp4"]);
      expect(readRestoreFollowup(userData)).toBeNull();
      expect(await finishPendingRestore(prisma, { userDataDir: userData, uploadsDir: uploads })).toEqual({ kind: "none" });
    });

    it("meldt media die niet opent bij naam en noemt het terugzetten dan onvolledig", async () => {
      const aanwezig = path.join(dbDir, "media", "intro.mp4");
      write(aanwezig, "video");
      write(path.join(uploads, "logo.png"), "png");
      await prisma.mediaItem.create({ data: { type: "VIDEO", path: aanwezig, title: "Intro", durationSec: 10 } });
      await prisma.mediaItem.create({
        data: { type: "VIDEO", path: path.join(dbDir, "media", "weg.mp4"), title: "Sponsor Brouwerij", durationSec: 10 },
      });
      await prisma.mediaItem.create({ data: { type: "IMAGE", path: "/uploads/kwijt.png", title: "Sponsor Bakkerij", durationSec: 5 } });
      // Uitgeschakelde media komt niet op het scherm en telt niet mee.
      await prisma.mediaItem.create({
        data: { type: "VIDEO", path: path.join(dbDir, "media", "oud.mp4"), title: "Oude clip", durationSec: 10, active: false },
      });
      await prisma.team.create({
        data: { name: "Thuis", shortName: "THU", primaryColor: "#111111", secondaryColor: "#ffffff", logoPath: "/uploads/logo.png" },
      });
      await prisma.team.create({
        data: { name: "Bezoekers", shortName: "BEZ", primaryColor: "#111111", secondaryColor: "#ffffff", logoPath: "/uploads/bez.png" },
      });
      writeFollowup({});

      const result = await finishPendingRestore(prisma, { userDataDir: userData, uploadsDir: uploads });
      expect(result.kind).toBe("incomplete");
      if (result.kind !== "incomplete") return;
      expect(result.pathRewriteError).toBeNull();
      expect(result.missingFiles).toEqual([
        { label: "Bezoekers", path: "/uploads/bez.png" },
        { label: "Sponsor Bakkerij", path: "/uploads/kwijt.png" },
        { label: "Sponsor Brouwerij", path: path.join(dbDir, "media", "weg.mp4") },
      ]);
      // Zolang de operator niet gekozen heeft, komt de vraag bij de volgende start terug.
      expect(readRestoreFollowup(userData)).not.toBeNull();
      acceptIncompleteRestore(userData, result);
      expect(readRestoreFollowup(userData)).toBeNull();
    });

    it("meldt pas teruggezet als de paden in de database staan én alle media opent", async () => {
      const oud = path.join(dbDir, "weg", "goal.mp4");
      await prisma.mediaItem.create({ data: { type: "VIDEO", path: oud, title: "Goal", durationSec: 8 } });
      writeFollowup({ [oud]: "/uploads/restored-0001-goal.mp4" });

      // Paden lukken, maar het bestand opent nog niet: onvolledig, en de padstap is afgevinkt.
      const eerst = await finishPendingRestore(prisma, { userDataDir: userData, uploadsDir: uploads });
      expect(eerst).toMatchObject({
        kind: "incomplete",
        pathRewriteError: null,
        missingFiles: [{ label: "Goal", path: "/uploads/restored-0001-goal.mp4" }],
      });
      expect(readRestoreFollowup(userData)).toMatchObject({ pathsRewritten: true });

      // Bestand aanwezig, maar de database valt uit: ook dan geen "teruggezet".
      write(path.join(uploads, "restored-0001-goal.mp4"), "video");
      const kapot: RawDb = {
        $queryRawUnsafe: async () => {
          throw new Error("disk I/O error");
        },
        $executeRawUnsafe: async () => {
          throw new Error("disk I/O error");
        },
      };
      const storing = await finishPendingRestore(kapot, { userDataDir: userData, uploadsDir: uploads });
      expect(storing).toMatchObject({ kind: "incomplete", checkError: "disk I/O error" });
      // Verdergaan zonder controle: de volgende start kijkt opnieuw na.
      if (storing.kind === "incomplete") acceptIncompleteRestore(userData, storing);
      expect(readRestoreFollowup(userData)).not.toBeNull();

      const klaar = await finishPendingRestore(prisma, { userDataDir: userData, uploadsDir: uploads });
      expect(klaar).toMatchObject({ kind: "restored", pathsChanged: 0, followup: { source: "backup" } });
      expect(readRestoreFollowup(userData)).toBeNull();
    });
  });
});
