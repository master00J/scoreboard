/**
 * Wedstrijdpakket: één wedstrijd klaarzetten op een andere pc en die op de scorebord-pc inlezen,
 * zonder de rest van die pc te overschrijven (dat doet de venue-back-up wel).
 *
 * Een pakket is een map `arenacue-match/` (in een ZIP) met:
 *   match.json   de wedstrijd, beide teams met spelers en spelerslijsten, de media die de wedstrijd
 *                en de spelers gebruiken (wedstrijdsponsor, goal-media) en hun sponsors
 *   files/       elk bestand waarnaar die gegevens verwijzen: logo's, foto's, video's
 *
 * Inlezen voegt samen. Een team dat er al is (zelfde id, anders zelfde naam) wordt bijgewerkt met wat
 * in het pakket staat; spelers die alleen op deze pc staan blijven staan. Media en sponsors die er al
 * zijn blijven ongemoeid. Dezelfde wedstrijd opnieuw inlezen werkt hem bij, behalve als hij nu speelt.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";
import { compareVersions, isExternalFilePath, replaceExternalPaths, uniqueUploadName } from "./venue-backup";

export const MATCH_PACKAGE_DIR = "arenacue-match";
export const MATCH_PACKAGE_MANIFEST = "match.json";
/** Zelfde grens als de venue-back-up: ZIP-bestanden boven 2 GB lukken niet overal. */
export const MATCH_PACKAGE_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024 - 1;

type Row = Record<string, unknown>;

export type MatchPackageFile = {
  /** Pad zoals het in de gegevens staat: een volledig pad of `/uploads/…`. */
  original: string;
  /** Pad binnen het pakket, bv. `files/0001-logo.png`. */
  archived: string;
  size: number;
};

export type MatchPackageTeam = { team: Row; lists: Row[]; players: Row[] };

export type MatchPackage = {
  format: 1;
  app: "arenacue-match";
  appVersion: string;
  createdAt: string;
  match: Row;
  events: Row[];
  teams: MatchPackageTeam[];
  media: Row[];
  sponsors: Row[];
  files: MatchPackageFile[];
  skipped: Array<{ path: string; reason: "missing" | "too_large" }>;
};

/* ————————————————————————— velden ————————————————————————— */

const scalarFieldCache = new Map<string, Set<string>>();

/** Alleen de kolommen van het model: zo komt er nooit een relatie of onbekend veld in een create. */
function scalarFields(model: Prisma.ModelName): Set<string> {
  let fields = scalarFieldCache.get(model);
  if (!fields) {
    const found = Prisma.dmmf.datamodel.models.find((item) => item.name === model);
    fields = new Set((found?.fields ?? []).filter((field) => field.kind === "scalar").map((field) => field.name));
    scalarFieldCache.set(model, fields);
  }
  return fields;
}

function pick(model: Prisma.ModelName, row: Row, omit: string[] = []): Row {
  const allowed = scalarFields(model);
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (allowed.has(key) && !omit.includes(key)) out[key] = value;
  }
  return out;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** Namen vergelijken zoals een mens dat doet: hoofdletters en spaties tellen niet. */
export function sameName(a: unknown, b: unknown): boolean {
  const norm = (value: unknown) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "");
  const left = norm(a);
  return left !== "" && left === norm(b);
}

/* ————————————————————————— bestanden in de gegevens ————————————————————————— */

function isUploadPath(value: string): boolean {
  return value.startsWith("/uploads/") && value.length > "/uploads/".length && !/[\r\n]/.test(value);
}

function isFileReference(value: string): boolean {
  return isUploadPath(value) || isExternalFilePath(value);
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

/** Alle bestandspaden in een rij, ook binnen JSON-kolommen. */
export function collectFileReferences(row: Row, out: Set<string>): void {
  for (const value of Object.values(row)) {
    if (typeof value !== "string" || !value) continue;
    if (isFileReference(value)) {
      out.add(value);
      continue;
    }
    if (!looksLikeJson(value)) continue;
    try {
      walkStrings(JSON.parse(value), (text) => {
        if (isFileReference(text)) out.add(text);
      });
    } catch {
      /* geen JSON */
    }
  }
}

/** Zet de nieuwe bestandspaden in een rij, ook binnen JSON-kolommen. */
export function remapRowPaths(row: Row, remap: Record<string, string>): Row {
  if (Object.keys(remap).length === 0) return row;
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === "string" ? (replaceExternalPaths(value, remap) ?? value) : value;
  }
  return out;
}

/* ————————————————————————— pakket samenstellen ————————————————————————— */

function plain<T>(value: T): Row {
  return JSON.parse(JSON.stringify(value)) as Row;
}

/** De gegevens van één wedstrijd, klaar voor `match.json` (nog zonder bestanden). */
export async function collectMatchPackage(
  db: PrismaClient,
  matchId: string,
  meta: { appVersion: string; now?: Date },
): Promise<{ pkg: MatchPackage; references: string[] }> {
  const match = await db.match.findUnique({ where: { id: matchId } });
  if (!match) throw new Error("match_not_found");
  const events = await db.matchEvent.findMany({ where: { matchId }, orderBy: { createdAt: "asc" } });

  const teamIds = [...new Set([match.homeTeamId, match.awayTeamId])];
  const teams: MatchPackageTeam[] = [];
  for (const teamId of teamIds) {
    const team = await db.team.findUnique({ where: { id: teamId } });
    if (!team) continue;
    const lists = await db.playerList.findMany({ where: { teamId }, orderBy: { name: "asc" } });
    const players = await db.player.findMany({ where: { teamId }, orderBy: [{ number: "asc" }, { lastName: "asc" }] });
    teams.push({ team: plain(team), lists: lists.map(plain), players: players.map(plain) });
  }

  const mediaIds = new Set<string>();
  if (match.matchSponsorMediaId) mediaIds.add(match.matchSponsorMediaId);
  for (const { players } of teams) {
    for (const player of players) {
      const id = str(player.goalMediaId);
      if (id) mediaIds.add(id);
    }
  }
  const media = mediaIds.size ? await db.mediaItem.findMany({ where: { id: { in: [...mediaIds] } } }) : [];
  const sponsorIds = [...new Set(media.map((item) => item.sponsorId).filter((id): id is string => !!id))];
  const sponsors = sponsorIds.length ? await db.sponsor.findMany({ where: { id: { in: sponsorIds } } }) : [];

  const pkg: MatchPackage = {
    format: 1,
    app: "arenacue-match",
    appVersion: meta.appVersion,
    createdAt: (meta.now ?? new Date()).toISOString(),
    match: plain(match),
    events: events.map(plain),
    teams,
    media: media.map(plain),
    sponsors: sponsors.map(plain),
    files: [],
    skipped: [],
  };

  const references = new Set<string>();
  collectFileReferences(pkg.match, references);
  for (const { team, lists, players } of teams) {
    collectFileReferences(team, references);
    for (const row of [...lists, ...players]) collectFileReferences(row, references);
  }
  for (const row of pkg.media) collectFileReferences(row, references);
  return { pkg, references: [...references].sort() };
}

/** Waar een opgeslagen pad op deze pc staat. */
export function resolveStoredPath(stored: string, uploadsDir: string): string {
  return isUploadPath(stored) ? path.join(uploadsDir, ...stored.slice("/uploads/".length).split("/")) : stored;
}

function archivedName(index: number, stored: string): string {
  const base = stored.split(/[\\/]/).pop() ?? "bestand";
  const safe = base.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(-80) || "bestand";
  return `${String(index + 1).padStart(4, "0")}-${safe}`;
}

/** Kopieert de bestanden naar `<root>/files/` en vult `files` en `skipped` van het pakket. */
export function stageMatchFiles(root: string, pkg: MatchPackage, references: string[], uploadsDir: string): void {
  const filesDir = path.join(root, "files");
  for (const stored of references) {
    const source = resolveStoredPath(stored, uploadsDir);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(source);
    } catch {
      pkg.skipped.push({ path: stored, reason: "missing" });
      continue;
    }
    if (!stat.isFile()) {
      pkg.skipped.push({ path: stored, reason: "missing" });
      continue;
    }
    if (stat.size > MATCH_PACKAGE_MAX_FILE_BYTES) {
      pkg.skipped.push({ path: stored, reason: "too_large" });
      continue;
    }
    fs.mkdirSync(filesDir, { recursive: true });
    const name = archivedName(pkg.files.length, stored);
    try {
      fs.copyFileSync(source, path.join(filesDir, name));
      pkg.files.push({ original: stored, archived: `files/${name}`, size: stat.size });
    } catch {
      pkg.skipped.push({ path: stored, reason: "missing" });
    }
  }
}

export function writeMatchPackage(root: string, pkg: MatchPackage): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, MATCH_PACKAGE_MANIFEST), JSON.stringify(pkg, null, 2), "utf8");
}

/* ————————————————————————— pakket inlezen ————————————————————————— */

export type MatchPackageInspection =
  | { ok: true; root: string; pkg: MatchPackage }
  | { ok: false; reason: "not_a_match_package" | "newer_version"; packageVersion?: string };

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => !!item && typeof item === "object") : [];
}

/** Leest een uitgepakt pakket. `match.json` mag in `arenacue-match/` staan of rechtstreeks in de map. */
export function readMatchPackageDir(dir: string, appVersion: string): MatchPackageInspection {
  const root = [path.join(dir, MATCH_PACKAGE_DIR), dir].find((candidate) =>
    fs.existsSync(path.join(candidate, MATCH_PACKAGE_MANIFEST)),
  );
  if (!root) return { ok: false, reason: "not_a_match_package" };
  let raw: Partial<MatchPackage>;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(root, MATCH_PACKAGE_MANIFEST), "utf8")) as Partial<MatchPackage>;
  } catch {
    return { ok: false, reason: "not_a_match_package" };
  }
  if (!raw || raw.app !== "arenacue-match" || raw.format !== 1 || !raw.match || typeof raw.match !== "object") {
    return { ok: false, reason: "not_a_match_package" };
  }
  const appVersionInPackage = typeof raw.appVersion === "string" ? raw.appVersion : "";
  // Een oudere app kent de velden van een nieuwere versie niet: eerst de app bijwerken.
  if (appVersionInPackage && compareVersions(appVersionInPackage, appVersion) > 0) {
    return { ok: false, reason: "newer_version", packageVersion: appVersionInPackage };
  }
  const teams: MatchPackageTeam[] = rows(raw.teams)
    .filter((item) => item.team && typeof item.team === "object")
    .map((item) => ({ team: item.team as Row, lists: rows(item.lists), players: rows(item.players) }));
  const files: MatchPackageFile[] = [];
  for (const item of rows(raw.files)) {
    // Alleen bestanden uit de eigen `files/`-map: geen paden die buiten het pakket wijzen.
    if (typeof item.original !== "string" || typeof item.archived !== "string") continue;
    if (!/^files\/[^\\/]+$/.test(item.archived) || item.archived.includes("..")) continue;
    files.push({ original: item.original, archived: item.archived, size: Number(item.size) || 0 });
  }
  const match = raw.match as Row;
  if (!str(match.id) || !str(match.homeTeamId) || !str(match.awayTeamId)) {
    return { ok: false, reason: "not_a_match_package" };
  }
  const teamIds = new Set(teams.map(({ team }) => team.id));
  if (!teamIds.has(match.homeTeamId) || !teamIds.has(match.awayTeamId)) {
    return { ok: false, reason: "not_a_match_package" };
  }
  return {
    ok: true,
    root,
    pkg: {
      format: 1,
      app: "arenacue-match",
      appVersion: appVersionInPackage,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
      match,
      events: rows(raw.events),
      teams,
      media: rows(raw.media),
      sponsors: rows(raw.sponsors),
      files,
      skipped: [],
    },
  };
}

function sameSize(file: string, size: number): boolean {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size === size;
  } catch {
    return false;
  }
}

function fileHash(file: string): string {
  const hash = crypto.createHash("sha1");
  const fd = fs.openSync(file, "r");
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    for (;;) {
      const read = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (read <= 0) break;
      hash.update(chunk.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/** Een eerdere import van hetzelfde bestand in uploads (`match-naam.ext`, `match-naam-2.ext`, …). */
function earlierImport(uploadsDir: string, wanted: string, source: string, size: number): string | null {
  const ext = path.extname(wanted);
  const stem = wanted.slice(0, wanted.length - ext.length);
  let sourceHash: string | null = null;
  for (let n = 1; n < 1000; n += 1) {
    const name = n === 1 ? wanted : `${stem}-${n}${ext}`;
    const candidate = path.join(uploadsDir, name);
    if (!fs.existsSync(candidate)) return null;
    if (!sameSize(candidate, size)) continue;
    sourceHash ??= fileHash(source);
    if (fileHash(candidate) === sourceHash) return name;
  }
  return null;
}

/**
 * Zet de bestanden van het pakket op deze pc. Staat hetzelfde bestand er al (op dezelfde plek, of
 * van een eerdere import in uploads), dan wordt dat gebruikt; anders komt een kopie in de
 * uploads-map. Geeft oud pad → nieuw pad.
 */
export function placeMatchFiles(root: string, pkg: MatchPackage, uploadsDir: string): Record<string, string> {
  const remap: Record<string, string> = {};
  fs.mkdirSync(uploadsDir, { recursive: true });
  for (const file of pkg.files) {
    const archived = path.join(root, ...file.archived.split("/"));
    if (!fs.existsSync(archived)) continue;
    if (sameSize(resolveStoredPath(file.original, uploadsDir), file.size)) continue;
    const wanted = `match-${path.basename(archived).replace(/^\d{4}-/, "")}`;
    const reuse = earlierImport(uploadsDir, wanted, archived, file.size);
    const name = reuse ?? uniqueUploadName(uploadsDir, wanted);
    if (!reuse) fs.copyFileSync(archived, path.join(uploadsDir, name));
    remap[file.original] = `/uploads/${name}`;
  }
  return remap;
}

/* ————————————————————————— samenvoegen ————————————————————————— */

export type MatchImportTeamPlan = {
  name: string;
  /** Nieuw team, of een bestaand team dat wordt bijgewerkt. */
  action: "create" | "update";
  playersNew: number;
  playersUpdated: number;
};

export type MatchImportPlan = {
  matchId: string;
  homeName: string;
  awayName: string;
  sport: string;
  kickoffAt: string | null;
  /** Dezelfde wedstrijd staat al op deze pc en wordt bijgewerkt. */
  matchExists: boolean;
  teams: MatchImportTeamPlan[];
  mediaNew: number;
  files: number;
  packageCreatedAt: string;
  packageVersion: string;
};

type Db = PrismaClient | Prisma.TransactionClient;

async function findTeam(db: Db, team: Row): Promise<Row | null> {
  const id = str(team.id);
  if (id) {
    const byId = await db.team.findUnique({ where: { id } });
    if (byId) return byId as unknown as Row;
  }
  const all = await db.team.findMany({ select: { id: true, name: true } });
  const byName = all.find((item) => sameName(item.name, team.name));
  return byName ? (byName as unknown as Row) : null;
}

async function findPlayer(db: Db, teamId: string, player: Row): Promise<string | null> {
  const id = str(player.id);
  if (id) {
    const byId = await db.player.findUnique({ where: { id }, select: { id: true, teamId: true } });
    if (byId && byId.teamId === teamId) return byId.id;
  }
  const candidates = await db.player.findMany({
    where: { teamId, number: Number(player.number) || 0 },
    select: { id: true, firstName: true, lastName: true },
  });
  const match = candidates.find(
    (item) => sameName(item.firstName, player.firstName) && sameName(item.lastName, player.lastName),
  );
  return match?.id ?? null;
}

/** Wat inlezen zou doen, zonder iets te wijzigen: voor de bevestiging aan de operator. */
export async function planMatchImport(db: Db, pkg: MatchPackage): Promise<MatchImportPlan> {
  const teams: MatchImportTeamPlan[] = [];
  for (const entry of pkg.teams) {
    const existing = await findTeam(db, entry.team);
    let playersNew = 0;
    let playersUpdated = 0;
    for (const player of entry.players) {
      const found = existing ? await findPlayer(db, String(existing.id), player) : null;
      if (found) playersUpdated += 1;
      else playersNew += 1;
    }
    teams.push({
      name: String(entry.team.name ?? ""),
      action: existing ? "update" : "create",
      playersNew,
      playersUpdated,
    });
  }
  let mediaNew = 0;
  for (const item of pkg.media) {
    const id = str(item.id);
    if (!id || !(await db.mediaItem.findUnique({ where: { id }, select: { id: true } }))) mediaNew += 1;
  }
  const nameOf = (teamId: unknown) => String(pkg.teams.find(({ team }) => team.id === teamId)?.team.name ?? "");
  const matchId = String(pkg.match.id);
  return {
    matchId,
    homeName: nameOf(pkg.match.homeTeamId),
    awayName: nameOf(pkg.match.awayTeamId),
    sport: String(pkg.match.sport ?? ""),
    kickoffAt: str(pkg.match.kickoffAt),
    matchExists: !!(await db.match.findUnique({ where: { id: matchId }, select: { id: true } })),
    teams,
    mediaNew,
    files: pkg.files.length,
    packageCreatedAt: pkg.createdAt,
    packageVersion: pkg.appVersion,
  };
}

export type MatchImportResult = {
  matchId: string;
  matchCreated: boolean;
  teamsCreated: number;
  teamsUpdated: number;
  playersCreated: number;
  playersUpdated: number;
  mediaCreated: number;
};

function remapIdList(json: unknown, ids: Map<string, string>): unknown {
  if (typeof json !== "string" || !json) return json;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return json;
    return JSON.stringify(parsed.map((item) => (typeof item === "string" ? (ids.get(item) ?? item) : item)));
  } catch {
    return json;
  }
}

/**
 * Voegt het pakket samen met de database. Draai dit in één transactie: lukt één stap niet, dan
 * blijft alles zoals het was. `remap` komt van `placeMatchFiles`.
 */
export async function applyMatchImport(
  db: Db,
  pkg: MatchPackage,
  remap: Record<string, string>,
): Promise<MatchImportResult> {
  const result: MatchImportResult = {
    matchId: String(pkg.match.id),
    matchCreated: false,
    teamsCreated: 0,
    teamsUpdated: 0,
    playersCreated: 0,
    playersUpdated: 0,
    mediaCreated: 0,
  };

  // Sponsors: bestaande (zelfde id of naam) blijven zoals ze zijn.
  const sponsorIds = new Map<string, string>();
  for (const sponsor of pkg.sponsors) {
    const id = str(sponsor.id);
    if (!id) continue;
    const byId = await db.sponsor.findUnique({ where: { id }, select: { id: true } });
    if (byId) {
      sponsorIds.set(id, byId.id);
      continue;
    }
    const all = await db.sponsor.findMany({ select: { id: true, name: true } });
    const byName = all.find((item) => sameName(item.name, sponsor.name));
    if (byName) {
      sponsorIds.set(id, byName.id);
      continue;
    }
    const created = await db.sponsor.create({ data: pick("Sponsor", sponsor) as Prisma.SponsorUncheckedCreateInput });
    sponsorIds.set(id, created.id);
  }

  // Media: wat er al is blijft ongemoeid; nieuwe media krijgt de paden op deze pc.
  const mediaIds = new Map<string, string>();
  for (const item of pkg.media) {
    const id = str(item.id);
    if (!id) continue;
    if (await db.mediaItem.findUnique({ where: { id }, select: { id: true } })) {
      mediaIds.set(id, id);
      continue;
    }
    const data = pick("MediaItem", remapRowPaths(item, remap));
    const sponsorId = str(item.sponsorId);
    data.sponsorId = sponsorId ? (sponsorIds.get(sponsorId) ?? null) : null;
    const created = await db.mediaItem.create({ data: data as Prisma.MediaItemUncheckedCreateInput });
    mediaIds.set(id, created.id);
    result.mediaCreated += 1;
  }

  // Teams, spelerslijsten en spelers.
  const teamIds = new Map<string, string>();
  const playerIds = new Map<string, string>();
  for (const entry of pkg.teams) {
    const packageTeamId = String(entry.team.id);
    const existing = await findTeam(db, entry.team);
    const teamData = pick("Team", remapRowPaths(entry.team, remap), ["id", "activePlayerListId"]);
    let teamId: string;
    if (existing) {
      teamId = String(existing.id);
      await db.team.update({ where: { id: teamId }, data: teamData as Prisma.TeamUncheckedUpdateInput });
      result.teamsUpdated += 1;
    } else {
      const taken = await db.team.findUnique({ where: { id: packageTeamId }, select: { id: true } });
      const created = await db.team.create({
        data: { ...(taken ? {} : { id: packageTeamId }), ...teamData } as Prisma.TeamUncheckedCreateInput,
      });
      teamId = created.id;
      result.teamsCreated += 1;
    }
    teamIds.set(packageTeamId, teamId);

    const listIds = new Map<string, string>();
    for (const list of entry.lists) {
      const id = str(list.id);
      if (!id) continue;
      const byId = await db.playerList.findUnique({ where: { id }, select: { id: true, teamId: true } });
      if (byId && byId.teamId === teamId) {
        await db.playerList.update({ where: { id }, data: { name: String(list.name ?? "") } });
        listIds.set(id, id);
        continue;
      }
      const sameTeam = await db.playerList.findMany({ where: { teamId }, select: { id: true, name: true } });
      const byName = sameTeam.find((item) => sameName(item.name, list.name));
      if (byName) {
        listIds.set(id, byName.id);
        continue;
      }
      const created = await db.playerList.create({
        data: { ...(byId ? {} : { id }), teamId, name: String(list.name ?? "") },
      });
      listIds.set(id, created.id);
    }

    for (const player of entry.players) {
      const packagePlayerId = String(player.id);
      const data = pick("Player", remapRowPaths(player, remap), ["id"]);
      data.teamId = teamId;
      const listId = str(player.listId);
      data.listId = listId ? (listIds.get(listId) ?? null) : null;
      const goalMediaId = str(player.goalMediaId);
      data.goalMediaId = goalMediaId ? (mediaIds.get(goalMediaId) ?? null) : null;
      const found = await findPlayer(db, teamId, player);
      if (found) {
        await db.player.update({ where: { id: found }, data: data as Prisma.PlayerUncheckedUpdateInput });
        playerIds.set(packagePlayerId, found);
        result.playersUpdated += 1;
      } else {
        const taken = await db.player.findUnique({ where: { id: packagePlayerId }, select: { id: true } });
        const created = await db.player.create({
          data: { ...(taken ? {} : { id: packagePlayerId }), ...data } as Prisma.PlayerUncheckedCreateInput,
        });
        playerIds.set(packagePlayerId, created.id);
        result.playersCreated += 1;
      }
    }

    const activeList = str(entry.team.activePlayerListId);
    await db.team.update({
      where: { id: teamId },
      data: { activePlayerListId: activeList ? (listIds.get(activeList) ?? null) : null },
    });
  }

  // De wedstrijd zelf.
  const matchId = String(pkg.match.id);
  const matchData = pick("Match", remapRowPaths(pkg.match, remap), ["id"]);
  matchData.homeTeamId = teamIds.get(String(pkg.match.homeTeamId));
  matchData.awayTeamId = teamIds.get(String(pkg.match.awayTeamId));
  const sponsorMedia = str(pkg.match.matchSponsorMediaId);
  matchData.matchSponsorMediaId = sponsorMedia ? (mediaIds.get(sponsorMedia) ?? null) : null;
  matchData.homeFieldPlayerIdsJson = remapIdList(pkg.match.homeFieldPlayerIdsJson, playerIds);
  matchData.awayFieldPlayerIdsJson = remapIdList(pkg.match.awayFieldPlayerIdsJson, playerIds);
  if (await db.match.findUnique({ where: { id: matchId }, select: { id: true } })) {
    await db.match.update({ where: { id: matchId }, data: matchData as Prisma.MatchUncheckedUpdateInput });
    await db.matchEvent.deleteMany({ where: { matchId } });
  } else {
    await db.match.create({ data: { id: matchId, ...matchData } as Prisma.MatchUncheckedCreateInput });
    result.matchCreated = true;
  }

  for (const event of pkg.events) {
    const data = pick("MatchEvent", event, ["id", "matchId"]);
    data.matchId = matchId;
    for (const key of ["playerInId", "playerOutId"] as const) {
      const id = str(event[key]);
      data[key] = id ? (playerIds.get(id) ?? id) : null;
    }
    const teamId = str(event.teamId);
    data.teamId = teamId ? (teamIds.get(teamId) ?? teamId) : null;
    await db.matchEvent.create({ data: data as Prisma.MatchEventUncheckedCreateInput });
  }

  return result;
}
