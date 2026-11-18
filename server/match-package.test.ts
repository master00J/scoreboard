import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  MATCH_PACKAGE_DIR,
  applyMatchImport,
  collectFileReferences,
  collectMatchPackage,
  placeMatchFiles,
  planMatchImport,
  readMatchPackageDir,
  remapRowPaths,
  stageMatchFiles,
  writeMatchPackage,
  type MatchPackage,
} from "./match-package";

/**
 * Twee databases in één test: `prep` is de pc waar de wedstrijd wordt klaargezet, `venue` de pc aan
 * het scorebord. Het pakket gaat er via een map met bestanden tussen, zoals in de app via een ZIP.
 */
let tmpDir: string;
let venue: PrismaClient;
let prep: PrismaClient;
let prepUploads: string;
let venueUploads: string;
let mediaDir: string;

const sql = (file: string) => `file:${file.replace(/\\/g, "/")}?connection_limit=1`;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arenacue-match-package-"));
  const venueDb = path.join(tmpDir, "venue.db");
  const prepDb = path.join(tmpDir, "prep.db");
  process.env.DATABASE_URL = sql(venueDb);
  const dbInit = await import("./db-init");
  await dbInit.ensureSqliteSchema();
  venue = (await import("../lib/prisma")).prisma;
  await dbInit.checkpointSqlite();
  fs.copyFileSync(venueDb, prepDb);
  prep = new PrismaClient({ datasources: { db: { url: sql(prepDb) } } });

  prepUploads = path.join(tmpDir, "prep-uploads");
  venueUploads = path.join(tmpDir, "venue-uploads");
  mediaDir = path.join(tmpDir, "media-on-prep-pc");
  for (const dir of [prepUploads, venueUploads, mediaDir]) fs.mkdirSync(dir, { recursive: true });
});

afterAll(async () => {
  await prep?.$disconnect();
  await venue?.$disconnect();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* Windows kan het bestand nog even vasthouden */
  }
});

function write(file: string, content: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

/** Een volledig pad zoals de bestandskiezer het opslaat (op Windows met schijfletter). */
function absolute(file: string): string {
  return path.resolve(file);
}

async function exportFrom(db: PrismaClient, matchId: string, name: string, appVersion = "0.2.0") {
  const { pkg, references } = await collectMatchPackage(db, matchId, { appVersion });
  const root = path.join(tmpDir, name, MATCH_PACKAGE_DIR);
  stageMatchFiles(root, pkg, references, prepUploads);
  writeMatchPackage(root, pkg);
  return { root: path.join(tmpDir, name), pkg };
}

async function importInto(db: PrismaClient, dir: string) {
  const read = readMatchPackageDir(dir, "0.2.0");
  if (!read.ok) throw new Error(read.reason);
  const plan = await planMatchImport(db, read.pkg);
  const remap = placeMatchFiles(read.root, read.pkg, venueUploads);
  const result = await db.$transaction((tx) => applyMatchImport(tx, read.pkg, remap));
  return { plan, result, remap };
}

describe("wedstrijdpakket", () => {
  let matchId = "";
  let packageDir = "";

  it("neemt de wedstrijd, beide teams, spelers, media en hun bestanden mee", async () => {
    // Op de scorebord-pc staat de thuisploeg al, met een speler die alleen daar bestaat.
    await venue.team.create({
      data: { id: "home-1", name: "KV Thuis", shortName: "KVT", primaryColor: "#f00", secondaryColor: "#fff" },
    });
    await venue.player.create({ data: { teamId: "home-1", number: 7, firstName: "Jan", lastName: "Peeters" } });
    await venue.player.create({ data: { teamId: "home-1", number: 99, firstName: "Enkel", lastName: "Hier" } });

    // Op de voorbereidings-pc: zelfde thuisploeg (zelfde id), met nieuwe foto's en een extra speler.
    const logo = absolute(write(path.join(mediaDir, "logos", "gast.png"), "png-gast"));
    const photo = absolute(write(path.join(mediaDir, "foto's", "jan.jpg"), "jpg-jan"));
    write(path.join(prepUploads, "goal-anna.mp4"), "mp4-anna");
    const sponsorClip = absolute(write(path.join(mediaDir, "sponsor.mp4"), "mp4-sponsor"));
    const lineup = absolute(write(path.join(mediaDir, "lineup.mp4"), "mp4-lineup"));

    await prep.team.create({
      data: { id: "home-1", name: "KV Thuis", shortName: "KVT", primaryColor: "#c00", secondaryColor: "#fff" },
    });
    const away = await prep.team.create({
      data: { name: "FC Gast", shortName: "FCG", logoPath: logo, primaryColor: "#00f", secondaryColor: "#000" },
    });
    const basis = await prep.playerList.create({ data: { teamId: "home-1", name: "Basis" } });
    await prep.team.update({ where: { id: "home-1" }, data: { activePlayerListId: basis.id } });
    const sponsor = await prep.sponsor.create({ data: { name: "Bakkerij Prep" } });
    const goalMedia = await prep.mediaItem.create({
      data: { type: "VIDEO", path: "/uploads/goal-anna.mp4", title: "Goal Anna", durationSec: 8, hideFromLibrary: true },
    });
    const sponsorMedia = await prep.mediaItem.create({
      data: { type: "VIDEO", path: sponsorClip, title: "Wedstrijdsponsor", durationSec: 15, sponsorId: sponsor.id },
    });
    const jan = await prep.player.create({
      data: { teamId: "home-1", number: 7, firstName: "Jan", lastName: "Peeters", photoPath: photo, listId: basis.id },
    });
    const anna = await prep.player.create({
      data: { teamId: "home-1", number: 9, firstName: "Anna", lastName: "Claes", goalMediaId: goalMedia.id, lineupVideoPath: lineup },
    });
    await prep.player.create({ data: { teamId: away.id, number: 1, firstName: "Gert", lastName: "Doel" } });
    const match = await prep.match.create({
      data: {
        homeTeamId: "home-1",
        awayTeamId: away.id,
        sport: "FOOTBALL",
        kickoffAt: new Date("2026-11-21T19:30:00Z"),
        matchSponsorMediaId: sponsorMedia.id,
        homeFieldPlayerIdsJson: JSON.stringify([jan.id, anna.id]),
      },
    });
    matchId = match.id;

    const exported = await exportFrom(prep, matchId, "pakket-1");
    packageDir = exported.root;
    expect(exported.pkg.skipped).toEqual([]);
    expect(exported.pkg.files.map((file) => file.original).sort()).toEqual(
      ["/uploads/goal-anna.mp4", lineup, logo, photo, sponsorClip].sort(),
    );
    expect(exported.pkg.teams.map(({ team }) => team.name)).toEqual(["KV Thuis", "FC Gast"]);
    expect(exported.pkg.media).toHaveLength(2);
    expect(exported.pkg.sponsors.map((item) => item.name)).toEqual(["Bakkerij Prep"]);
  });

  it("voegt samen op de scorebord-pc zonder iets anders te wissen", async () => {
    // De bestanden staan op de scorebord-pc niet op dezelfde plek.
    for (const dir of [mediaDir, prepUploads]) fs.rmSync(dir, { recursive: true, force: true });

    const { plan, result, remap } = await importInto(venue, packageDir);
    expect(plan.matchExists).toBe(false);
    expect(plan.teams).toEqual([
      { name: "KV Thuis", action: "update", playersNew: 1, playersUpdated: 1 },
      { name: "FC Gast", action: "create", playersNew: 1, playersUpdated: 0 },
    ]);
    expect(result).toMatchObject({ matchCreated: true, teamsCreated: 1, teamsUpdated: 1, playersCreated: 2, playersUpdated: 1, mediaCreated: 2 });
    expect(Object.keys(remap)).toHaveLength(5);

    const home = await venue.team.findUniqueOrThrow({ where: { id: "home-1" }, include: { players: true, playerLists: true } });
    expect(home.primaryColor).toBe("#c00");
    expect(home.players.map((p) => p.number).sort((a, b) => a - b)).toEqual([7, 9, 99]);
    expect(home.playerLists.map((list) => list.name)).toEqual(["Basis"]);
    expect(home.activePlayerListId).toBe(home.playerLists[0].id);

    const jan = home.players.find((p) => p.number === 7)!;
    expect(jan.photoPath).toMatch(/^\/uploads\/match-jan\.jpg$/);
    expect(fs.readFileSync(path.join(venueUploads, "match-jan.jpg"), "utf8")).toBe("jpg-jan");
    expect(jan.listId).toBe(home.playerLists[0].id);

    const anna = home.players.find((p) => p.number === 9)!;
    const goal = await venue.mediaItem.findUniqueOrThrow({ where: { id: anna.goalMediaId! } });
    expect(goal.path).toBe("/uploads/match-goal-anna.mp4");
    expect(goal.hideFromLibrary).toBe(true);

    const match = await venue.match.findUniqueOrThrow({ where: { id: matchId }, include: { awayTeam: true, matchSponsorMedia: { include: { sponsor: true } } } });
    expect(match.homeTeamId).toBe("home-1");
    expect(match.awayTeam.name).toBe("FC Gast");
    expect(match.awayTeam.logoPath).toBe("/uploads/match-gast.png");
    expect(match.kickoffAt?.toISOString()).toBe("2026-11-21T19:30:00.000Z");
    expect(match.matchSponsorMedia?.sponsor?.name).toBe("Bakkerij Prep");
    expect(JSON.parse(match.homeFieldPlayerIdsJson ?? "[]")).toEqual([jan.id, anna.id]);
  });

  it("werkt dezelfde wedstrijd bij als je hem opnieuw inleest, zonder dubbele spelers of bestanden", async () => {
    const before = await venue.player.count();
    const filesBefore = fs.readdirSync(venueUploads).length;
    const { plan, result, remap } = await importInto(venue, packageDir);
    expect(plan.matchExists).toBe(true);
    expect(result).toMatchObject({ matchCreated: false, teamsCreated: 0, teamsUpdated: 2, playersCreated: 0, mediaCreated: 0 });
    expect(await venue.player.count()).toBe(before);
    expect(await venue.match.count()).toBe(1);
    expect(await venue.mediaItem.count()).toBe(2);
    // De kopieën van de eerste import worden hergebruikt.
    expect(fs.readdirSync(venueUploads)).toHaveLength(filesBefore);
    expect(remap).toMatchObject({ "/uploads/goal-anna.mp4": "/uploads/match-goal-anna.mp4" });
    const jan = await venue.player.findFirstOrThrow({ where: { teamId: "home-1", number: 7 } });
    expect(jan.photoPath).toBe("/uploads/match-jan.jpg");
  });

  it("maakt een nieuwe kopie als een ander bestand dezelfde naam heeft", () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, "zelfde-naam-"));
    const root = path.join(dir, MATCH_PACKAGE_DIR);
    write(path.join(root, "files", "0001-logo.png"), "nieuw-logo");
    write(path.join(venueUploads, "match-logo.png"), "oud-logo");
    const pkg = {
      files: [{ original: "/uploads/logo.png", archived: "files/0001-logo.png", size: "nieuw-logo".length }],
    } as MatchPackage;
    expect(placeMatchFiles(root, pkg, venueUploads)).toEqual({ "/uploads/logo.png": "/uploads/match-logo-2.png" });
    expect(fs.readFileSync(path.join(venueUploads, "match-logo.png"), "utf8")).toBe("oud-logo");
  });

  it("herkent een team op naam als het op de andere pc een ander id heeft", async () => {
    const other = await prep.team.create({
      data: { name: "  kv  thuis ", shortName: "X", primaryColor: "#111", secondaryColor: "#222" },
    });
    const opponent = await prep.team.create({
      data: { name: "Nieuw Team", shortName: "NT", primaryColor: "#333", secondaryColor: "#444" },
    });
    const match = await prep.match.create({ data: { homeTeamId: other.id, awayTeamId: opponent.id } });
    const { root } = await exportFrom(prep, match.id, "pakket-naam");
    const { result } = await importInto(venue, root);
    expect(result.teamsUpdated).toBe(1);
    expect(result.teamsCreated).toBe(1);
    const imported = await venue.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(imported.homeTeamId).toBe("home-1");
  });
});

describe("wedstrijdpakket nakijken", () => {
  function packageWith(manifest: unknown): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arenacue-match-read-"));
    write(path.join(dir, MATCH_PACKAGE_DIR, "match.json"), JSON.stringify(manifest));
    return dir;
  }

  const minimal = (): MatchPackage => ({
    format: 1,
    app: "arenacue-match",
    appVersion: "0.2.0",
    createdAt: "2026-11-17T10:00:00.000Z",
    match: { id: "m1", homeTeamId: "a", awayTeamId: "b" },
    events: [],
    teams: [
      { team: { id: "a", name: "A" }, lists: [], players: [] },
      { team: { id: "b", name: "B" }, lists: [], players: [] },
    ],
    media: [],
    sponsors: [],
    files: [],
    skipped: [],
  });

  it("weigert een pakket van een nieuwere versie", () => {
    const read = readMatchPackageDir(packageWith({ ...minimal(), appVersion: "0.3.0" }), "0.2.0");
    expect(read).toEqual({ ok: false, reason: "newer_version", packageVersion: "0.3.0" });
  });

  it("weigert een map die geen wedstrijdpakket is", () => {
    expect(readMatchPackageDir(fs.mkdtempSync(path.join(os.tmpdir(), "arenacue-empty-")), "0.2.0")).toEqual({
      ok: false,
      reason: "not_a_match_package",
    });
    const noTeams = { ...minimal(), teams: [] };
    expect(readMatchPackageDir(packageWith(noTeams), "0.2.0").ok).toBe(false);
  });

  it("neemt geen bestanden mee die buiten het pakket wijzen", () => {
    const read = readMatchPackageDir(
      packageWith({
        ...minimal(),
        files: [
          { original: "C:\\x.png", archived: "files/0001-x.png", size: 1 },
          { original: "C:\\y.png", archived: "../../y.png", size: 1 },
          { original: "C:\\z.png", archived: "files/../z.png", size: 1 },
        ],
      }),
      "0.2.0",
    );
    expect(read.ok && read.pkg.files.map((file) => file.archived)).toEqual(["files/0001-x.png"]);
  });
});

describe("bestandspaden in rijen", () => {
  it("vindt paden in gewone kolommen en in JSON, en zet ze om", () => {
    const external = process.platform === "win32" ? "C:\\media\\a.mp4" : "/media/a.mp4";
    const row = {
      id: "x",
      name: "Niet een pad",
      path: external,
      json: JSON.stringify({ list: ["/uploads/b.png", "tekst"] }),
    };
    const found = new Set<string>();
    collectFileReferences(row, found);
    expect([...found].sort()).toEqual(["/uploads/b.png", external].sort());
    const next = remapRowPaths(row, { [external]: "/uploads/match-a.mp4", "/uploads/b.png": "/uploads/match-b.png" });
    expect(next.path).toBe("/uploads/match-a.mp4");
    expect(JSON.parse(String(next.json))).toEqual({ list: ["/uploads/match-b.png", "tekst"] });
    expect(next.name).toBe("Niet een pad");
  });
});
