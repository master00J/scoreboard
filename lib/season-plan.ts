/**
 * Seizoensplan: alle sponsors en clubmedia in één tabel met minuten per fase, zoals clubs het in Excel bijhouden.
 * Pure logica (geen React, geen database), zodat plakken uit Excel, het koppelen van bestanden en de
 * berekening van de echte schermtijd getest kunnen worden.
 *
 * Sponsors en clubmedia delen op het scherm dezelfde rotatie (`mergeSponsorsWithClubMedia`): per fase
 * krijgen ze samen hoogstens de lengte van die fase, de rest is scorebord. Een clip wordt nooit afgekapt,
 * dus de echte tijd is het budget naar boven afgerond op hele clips (`buildSponsorAppearancePlan`).
 */

import type { Match, MediaItem, Sponsor, SponsorSection } from "./types";
import {
  clubGroupKey,
  clubGroupToRotationSponsor,
  clubPhaseBudgetTotalSeconds,
  parseClubPhaseBudgetJson,
  serializeClubPhaseBudgetJson,
} from "./club-media-rotation";
import { activeSponsorsForSection, buildSponsorAppearancePlan } from "./sponsor-distribution";
import {
  cueGuarantee,
  defaultSponsorGuarantee,
  parseSponsorGuarantee,
  sameSponsorGuarantee,
  serializeSponsorGuarantee,
  type CueGuarantee,
  type SponsorGuarantee,
} from "./sponsor-guarantee";
import {
  parseSponsorMediaPhaseTags,
  serializeSponsorMediaPhaseTags,
  type SponsorMediaPhase,
} from "./sponsor-media-phases";

/** De vijf fases van de voetbalrotatie, in de volgorde van een wedstrijd. */
export const PLAN_PHASES = ["prematch", "firstHalf", "halftime", "secondHalf", "postmatch"] as const;
export type PlanPhase = (typeof PLAN_PHASES)[number];

/** Fases buiten de speeltijd, waarover "buiten de 90 minuten" verdeeld wordt. */
export const OUTSIDE_PHASES = ["prematch", "halftime", "postmatch"] as const;
export type OutsidePhase = (typeof OUTSIDE_PHASES)[number];

/** Sponsor of clubmedia. Beide kunnen meerdere bestanden hebben; clubmedia worden nooit een sponsor. */
export type PlanRowKind = "sponsor" | "club";

/** Een gekozen bestand dat nog geen media-item is. */
export type PlanFile = { path: string; type: "VIDEO" | "IMAGE"; durationSec: number };

/**
 * Eén bestand van een rij, met de fases waarin het mag spelen. `phases: null` = in alle fases,
 * zoals een bestand zonder fase-tags. De rotatie slaat een bestand over in een fase die niet in de lijst staat.
 */
export type PlanClip = {
  /** Media-id, of `pending-…` voor een gekozen bestand dat bij opslaan een media-item wordt. */
  id: string;
  title: string;
  path: string;
  type: "VIDEO" | "IMAGE";
  durationSec: number;
  active: boolean;
  phases: PlanPhase[] | null;
  /** De fase-tags zoals ze in de database staan; nodig om "Verlenging" te bewaren. */
  originalTagsJson: string | null;
  pending: boolean;
};

let pendingCounter = 0;

/** Een net gekozen bestand als bestand van een rij; het wordt pas bij opslaan aangemaakt. */
export function pendingClip(file: PlanFile): PlanClip {
  pendingCounter += 1;
  return {
    id: `pending-${Date.now()}-${pendingCounter}`,
    title: file.path.replace(/^.*[/\\]/, ""),
    path: file.path,
    type: file.type,
    durationSec: file.durationSec,
    active: true,
    phases: null,
    originalTagsJson: null,
    pending: true,
  };
}

/** Eén rij van het plan zoals de tabel hem toont en bewerkt. Tijden in seconden. */
export type PlanRow = {
  /** Vaste sleutel: sponsor-id, `club:<media-id>`, of `new-…` voor een rij die nog niet bestaat. */
  key: string;
  kind: PlanRowKind;
  /** Sponsor-id of media-id; leeg voor een rij die nog aangemaakt moet worden. */
  id: string | null;
  name: string;
  active: boolean;
  seconds: Record<PlanPhase, number>;
  notes: string;
  /** Soort garantie en inhaalfases van de boeking (alleen sponsors; clubmedia: standaard). */
  guarantee: SponsorGuarantee;
  mediaCount: number;
  /**
   * De bestanden met de fases waarin ze spelen. Bij een sponsor komen nieuwe bestanden meteen via de API;
   * bij clubmedia staan nieuwe bestanden hier als `pending` tot de tabel opgeslagen wordt.
   */
  clips: PlanClip[];
};

/** Fase-tags uit de database als planfases. Geen tags (of alle vijf) = null: speelt overal. */
export function planPhasesFromTags(raw: string | null | undefined): PlanPhase[] | null {
  const tags = parseSponsorMediaPhaseTags(raw);
  if (tags.length === 0) return null;
  const phases = PLAN_PHASES.filter((p) =>
    p === "secondHalf" ? tags.includes("secondHalf") : tags.includes(p as SponsorMediaPhase),
  );
  return phases.length === PLAN_PHASES.length ? null : phases;
}

/**
 * Planfases terug naar fase-tags. "Verlenging" volgt de 2e helft, tenzij de tags in de database
 * verlenging los van de 2e helft hadden; dan blijft dat zoals het was.
 */
export function tagsJsonFromPlanPhases(phases: PlanPhase[] | null, originalTagsJson: string | null): string | null {
  if (phases == null || phases.length === PLAN_PHASES.length) return null;
  const original = parseSponsorMediaPhaseTags(originalTagsJson);
  const extraOnItsOwn = original.includes("extraTime") && !original.includes("secondHalf");
  const tags: SponsorMediaPhase[] = [...phases];
  if (phases.includes("secondHalf") || extraOnItsOwn) tags.push("extraTime");
  /** Geen enkele fase: de motor leest een lege lijst als "overal". De tabel laat dat niet toe; hier blijft het oude staan. */
  if (phases.length === 0) return originalTagsJson;
  return serializeSponsorMediaPhaseTags(tags);
}

function sameClipPhases(a: PlanPhase[] | null, b: PlanPhase[] | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.length === b.length && a.every((p) => b.includes(p));
}

/** `ignoreTags`: losse clubmedia zonder groep spelen in alle fases met minuten; hun tags telt de rotatie niet. */
function clipFromMedia(m: MediaItem, ignoreTags = false): PlanClip {
  return {
    id: m.id,
    title: m.title,
    path: m.path,
    type: m.type === "VIDEO" ? "VIDEO" : "IMAGE",
    durationSec: m.durationSec,
    active: m.active,
    phases: ignoreTags ? null : planPhasesFromTags(m.sponsorPhaseTagsJson),
    originalTagsJson: ignoreTags ? null : (m.sponsorPhaseTagsJson ?? null),
    pending: false,
  };
}

/** Bestanden toegevoegd, weggehaald of in andere fases? */
export function clipsChanged(row: PlanRow, original: PlanRow | undefined): boolean {
  const before = original?.clips ?? [];
  if (row.clips.length !== before.length) return true;
  if (row.clips.some((c) => c.pending)) return true;
  const ids = new Set(before.map((c) => c.id));
  if (row.clips.some((c) => !ids.has(c.id))) return true;
  return changedClipTags(row, original).length > 0;
}

/** Bestanden van een sponsorrij waarvan de fases veranderd zijn (voor PATCH /api/media/:id). */
export function changedClipTags(row: PlanRow, original: PlanRow | undefined): { id: string; sponsorPhaseTagsJson: string | null }[] {
  const before = new Map((original?.clips ?? []).map((c) => [c.id, c]));
  return row.clips
    .filter((c) => {
      const o = before.get(c.id);
      return o != null && !sameClipPhases(c.phases, o.phases);
    })
    .map((c) => ({ id: c.id, sponsorPhaseTagsJson: tagsJsonFromPlanPhases(c.phases, c.originalTagsJson) }));
}

/**
 * Nieuwe bestanden uit de database in een rij met open wijzigingen: gewijzigde fases blijven staan,
 * nieuwe bestanden komen erbij, verwijderde verdwijnen.
 */
export function mergeFreshClips(current: PlanClip[], fresh: PlanClip[]): PlanClip[] {
  const edited = new Map(current.map((c) => [c.id, c]));
  const kept = fresh.map((c) => {
    const e = edited.get(c.id);
    return e ? { ...c, phases: e.phases } : c;
  });
  return [...kept, ...current.filter((c) => c.pending)];
}

export function planRowKey(kind: PlanRowKind, id: string): string {
  return kind === "club" ? `club:${id}` : id;
}

/** Sleutel van een clubrij met een groepsnaam: blijft gelijk zolang de naam gelijk blijft. */
export function clubGroupRowKey(groupName: string): string {
  return `clubgroup:${clubGroupKey(groupName)}`;
}

export function emptySeconds(): Record<PlanPhase, number> {
  return { prematch: 0, firstHalf: 0, halftime: 0, secondHalf: 0, postmatch: 0 };
}

/** Een sponsor uit de database als planrij. Oude sponsors met alleen `matchSeconds` tellen die als 1e helft, zoals de sponsorkaart. */
export function planRowFromSponsor(s: Sponsor): PlanRow {
  const m1 = s.matchFirstHalfSeconds ?? 0;
  const m2 = s.matchSecondHalfSeconds ?? 0;
  const split = m1 > 0 || m2 > 0;
  return {
    key: planRowKey("sponsor", s.id),
    kind: "sponsor",
    id: s.id,
    name: s.name,
    active: s.active,
    seconds: {
      prematch: Math.max(0, s.prematchSeconds ?? 0),
      firstHalf: Math.max(0, split ? m1 : (s.matchSeconds ?? 0)),
      halftime: Math.max(0, s.halftimeSeconds ?? 0),
      secondHalf: Math.max(0, split ? m2 : 0),
      postmatch: Math.max(0, s.postmatchSeconds ?? 0),
    },
    notes: s.notes ?? "",
    guarantee: parseSponsorGuarantee(s.guaranteeJson),
    mediaCount: (s.media ?? []).filter((m) => m.active !== false).length,
    clips: (s.media ?? []).filter((m) => !m.hideFromLibrary).map((m) => clipFromMedia(m)),
  };
}

/** Losse clubmedia met zendtijd: zo draait ze mee in de rotatie en hoort ze in het plan. */
export function isPlanClubMedia(m: MediaItem): boolean {
  return (
    !m.sponsorId &&
    !m.hideFromLibrary &&
    clubPhaseBudgetTotalSeconds(parseClubPhaseBudgetJson(m.clubPhaseBudgetJson)) > 0
  );
}

/**
 * Clubmedia als planrij: een groep (zelfde `clubGroup`) met al zijn bestanden, of één los bestand van vóór
 * het seizoensplan. Minuten en notitie komen van het eerste bestand, zoals in de rotatie.
 */
export function planRowFromClubItems(items: MediaItem[], groupName: string | null): PlanRow {
  const sorted = [...items].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const first = sorted[0];
  const b = parseClubPhaseBudgetJson(first.clubPhaseBudgetJson);
  return {
    key: groupName ? clubGroupRowKey(groupName) : planRowKey("club", first.id),
    kind: "club",
    id: first.id,
    name: groupName ?? first.title,
    active: sorted.some((m) => m.active),
    seconds: {
      prematch: b.prematch,
      firstHalf: b.firstHalf,
      halftime: b.halftime,
      secondHalf: b.secondHalf,
      postmatch: b.postmatch,
    },
    guarantee: defaultSponsorGuarantee(),
    notes: first.notes ?? "",
    mediaCount: sorted.length,
    clips: sorted.map((m) => clipFromMedia(m, groupName == null)),
  };
}

/** @deprecated Gebruik planRowFromClubItems; blijft voor één los bestand. */
export function planRowFromClubMedia(m: MediaItem): PlanRow {
  return planRowFromClubItems([m], m.clubGroup?.trim() || null);
}

/** Alle rijen uit de database: eerst de sponsors, dan de clubmedia (groepen in de volgorde van hun eerste bestand). */
export function planRowsFromDatabase(sponsors: Sponsor[], media: MediaItem[]): PlanRow[] {
  const clubRows: PlanRow[] = [];
  const groups = new Map<string, { name: string; items: MediaItem[]; index: number }>();
  for (const m of media.filter(isPlanClubMedia)) {
    const group = m.clubGroup?.trim();
    if (!group) {
      clubRows.push(planRowFromClubItems([m], null));
      continue;
    }
    const key = clubGroupKey(group);
    const g = groups.get(key);
    if (g) g.items.push(m);
    else {
      groups.set(key, { name: group, items: [m], index: clubRows.length });
      clubRows.push(null as unknown as PlanRow);
    }
  }
  for (const g of groups.values()) clubRows[g.index] = planRowFromClubItems(g.items, g.name);
  return [...sponsors.map(planRowFromSponsor), ...clubRows];
}

/** De minuten van een clubrij als budget op elk van zijn bestanden. Alles op 0 = null: uit de rotatie. */
export function clubBudgetJsonFromPlanRow(row: PlanRow): string | null {
  const s = row.seconds;
  return serializeClubPhaseBudgetJson({
    prematch: s.prematch,
    firstHalf: s.firstHalf,
    halftime: s.halftime,
    secondHalf: s.secondHalf,
    postmatch: s.postmatch,
  });
}

/** @deprecated Een clubrij schrijft nu via clubMediaWrites; dit geeft de velden die op elk bestand gelijk zijn. */
export function clubMediaPatchFromPlanRow(row: PlanRow): Record<string, unknown> {
  return {
    active: row.active,
    clubPhaseBudgetJson: clubBudgetJsonFromPlanRow(row),
    notes: row.notes.trim() || null,
  };
}

export type ClubMediaWrites = {
  /** Bestaande bestanden: zelfde budget, notitie en groepsnaam, eigen fases. */
  update: { id: string; body: Record<string, unknown> }[];
  /** Gekozen bestanden die een media-item worden. */
  create: Record<string, unknown>[];
  /** Weggehaalde bestanden: terug naar de bibliotheek, uit de rotatie. */
  release: { id: string; body: Record<string, unknown> }[];
};

/**
 * Wat opslaan van een clubrij in de database schrijft. Elk bestand krijgt de groepsnaam, zodat de rotatie de
 * rij als één ingang ziet (`clubGroupToRotationSponsor`), en zijn eigen fases als fase-tags.
 */
export function clubMediaWrites(row: PlanRow, original: PlanRow | undefined): ClubMediaWrites {
  const budget = clubBudgetJsonFromPlanRow(row);
  const group = budget ? row.name.trim() : null;
  const shared = { clubPhaseBudgetJson: budget, notes: row.notes.trim() || null, clubGroup: group, active: row.active };
  const tags = (c: PlanClip) => (budget ? tagsJsonFromPlanPhases(c.phases, c.originalTagsJson) : c.originalTagsJson);
  const kept = new Set(row.clips.map((c) => c.id));
  return {
    update: row.clips.filter((c) => !c.pending).map((c) => ({ id: c.id, body: { ...shared, sponsorPhaseTagsJson: tags(c) } })),
    create: row.clips
      .filter((c) => c.pending)
      .map((c) => ({
        ...shared,
        type: c.type,
        path: c.path,
        title: c.title,
        durationSec: Math.round(c.durationSec),
        sponsorPhaseTagsJson: tags(c),
      })),
    release: (original?.clips ?? [])
      .filter((c) => !kept.has(c.id))
      .map((c) => ({ id: c.id, body: { clubPhaseBudgetJson: null, clubGroup: null } })),
  };
}

/** De velden die een planrij in de database schrijft (voetbalkolommen + notitie). */
export function sponsorPatchFromPlanRow(row: PlanRow): Record<string, unknown> {
  const s = row.seconds;
  return {
    name: row.name.trim(),
    active: row.active,
    prematchSeconds: s.prematch,
    matchFirstHalfSeconds: s.firstHalf,
    matchSecondHalfSeconds: s.secondHalf,
    matchSeconds: s.firstHalf + s.secondHalf,
    halftimeSeconds: s.halftime,
    postmatchSeconds: s.postmatch,
    notes: row.notes.trim() || null,
    guaranteeJson: serializeSponsorGuarantee(row.guarantee),
  };
}

/** Is er iets aan deze rij veranderd tegenover wat in de database staat? */
export function planRowChanged(row: PlanRow, original: PlanRow | undefined): boolean {
  if (!original) return true;
  if (row.kind !== original.kind) return true;
  if (row.name.trim() !== original.name.trim()) return true;
  if (row.active !== original.active) return true;
  if (row.notes.trim() !== original.notes.trim()) return true;
  if (!sameSponsorGuarantee(row.guarantee, original.guarantee)) return true;
  if (clipsChanged(row, original)) return true;
  return PLAN_PHASES.some((p) => row.seconds[p] !== original.seconds[p]);
}

/** Minuten (ook "1,5" of "1.5") naar seconden. Leeg of ongeldig = null. */
export function parseMinutes(value: string): number | null {
  const v = value.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 60);
}

/** Seconden als minuten voor in een cel: 90 → "1,5", 0 → "". */
export function formatMinutes(sec: number, decimalSeparator = ","): string {
  if (!sec || sec <= 0) return "";
  const m = sec / 60;
  const text = Number.isInteger(m) ? String(m) : m.toFixed(2).replace(/\.?0+$/, "");
  return text.replace(".", decimalSeparator);
}

/** Naam om te vergelijken: hoofdletters, accenten, leestekens en dubbele spaties tellen niet. */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Tekst van het klembord (Excel, Google Sheets, LibreOffice) als rijen en cellen.
 * Cellen zijn gescheiden door tabs; een cel met een tab of nieuwe regel staat tussen aanhalingstekens.
 */
export function parseClipboardTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const src = text.replace(/\r\n?/g, "\n");
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === "\t") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows
    .map((r) => [...r, ...Array<string>(width - r.length).fill("")].map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));
}

/** Wat een geplakte kolom betekent. */
export type PlanColumnKind = "name" | PlanPhase | "inside90" | "outside90" | "notes" | "ignore";

export const PLAN_COLUMN_KINDS: PlanColumnKind[] = [
  "ignore",
  "name",
  "prematch",
  "firstHalf",
  "halftime",
  "secondHalf",
  "postmatch",
  "inside90",
  "outside90",
  "notes",
];

const TIME_KINDS = new Set<PlanColumnKind>([...PLAN_PHASES, "inside90", "outside90"]);

/** Herkent een kopregel aan tekst in kolommen waar de rijen eronder getallen hebben. */
export function looksLikeHeader(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const [first, ...rest] = rows;
  for (let col = 1; col < first.length; col++) {
    const head = first[col];
    if (!head || parseMinutes(head) != null) continue;
    if (rest.some((r) => parseMinutes(r[col] ?? "") != null)) return true;
  }
  return false;
}

/** Raadt per kolom wat erin staat, op basis van de koptekst. Wat niet duidelijk is, wordt genegeerd. */
export function guessColumnKinds(header: string[] | null, width: number): PlanColumnKind[] {
  const kinds: PlanColumnKind[] = Array<PlanColumnKind>(width).fill("ignore");
  if (header) {
    header.forEach((raw, col) => {
      const h = normalizeName(raw);
      if (!h) return;
      if (/\bbinnen\b.*\b90\b|\binside\b.*\b90\b|\bwithin\b.*\b90\b/.test(h)) kinds[col] = "inside90";
      else if (/\bbuiten\b.*\b90\b|\boutside\b.*\b90\b/.test(h)) kinds[col] = "outside90";
      else if (/\b(1e|1ste|eerste|first|1st) (helft|half)\b/.test(h)) kinds[col] = "firstHalf";
      else if (/\b(2e|2de|tweede|second|2nd) (helft|half)\b/.test(h)) kinds[col] = "secondHalf";
      else if (/\b(rust|pauze|halftime|half time|mi temps)\b/.test(h)) kinds[col] = "halftime";
      else if (/\b(voor de (wedstrijd|match)|prematch|pre match|opwarming|before)\b/.test(h)) kinds[col] = "prematch";
      else if (/\b(na de (wedstrijd|match)|postmatch|post match|after)\b/.test(h)) kinds[col] = "postmatch";
      else if (/\b(notitie|notities|opmerking|opmerkingen|info|informatie|note|notes|remark|remarks)\b/.test(h)) {
        kinds[col] = "notes";
      } else if (/\b(sponsor|sponsors|partner|partners|naam|name)\b/.test(h) && !kinds.includes("name")) {
        kinds[col] = "name";
      }
    });
  }
  if (!kinds.includes("name") && width > 0 && kinds[0] === "ignore") kinds[0] = "name";
  return kinds;
}

/** Sleutel om de gekozen kolommen per pc te onthouden voor een sheet met dezelfde kopregel. */
export function headerSignature(header: string[]): string {
  return header.map(normalizeName).join("|");
}

/** Een geplakte rij, klaar om in de tabel te zetten. Alleen gedekte fases hebben een waarde. */
export type PlanImportRow = {
  name: string;
  /** Uit de sectiekop erboven ("RAFC COMMUNICATIE" → clubmedia, "PARTNERS" → sponsor). */
  kind: PlanRowKind;
  seconds: Partial<Record<PlanPhase, number>>;
  notes: string | null;
};

export type PlanImportSkip = { name: string; reason: "total" | "no_times" };

export type PlanImportOptions = {
  /** Fases waarover "buiten de 90 minuten" gelijk verdeeld wordt. */
  outsideSplit: OutsidePhase[];
};

/** Welke fases door de gekozen kolommen een waarde krijgen (leeg = 0); de rest blijft zoals hij is. */
export function coveredPhases(kinds: PlanColumnKind[], opts: PlanImportOptions): Set<PlanPhase> {
  const covered = new Set<PlanPhase>();
  for (const kind of kinds) {
    if ((PLAN_PHASES as readonly string[]).includes(kind)) covered.add(kind as PlanPhase);
    if (kind === "inside90") {
      covered.add("firstHalf");
      covered.add("secondHalf");
    }
    if (kind === "outside90") for (const p of opts.outsideSplit) covered.add(p);
  }
  return covered;
}

function splitEvenly(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const rest = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rest ? 1 : 0));
}

/** Sectiekop in een sheet: een rij zonder minuten die zegt wat eronder staat. */
export function sectionKindFromHeader(name: string): PlanRowKind | null {
  const n = normalizeName(name);
  if (/\b(communicatie|communication|marcom|marketing|club|clubmedia|eigen|intern|internal)\b/.test(n)) return "club";
  if (/\b(partner|partners|sponsor|sponsors|sponsoring|matchsponsor)\b/.test(n)) return "sponsor";
  return null;
}

/**
 * Zet geplakte rijen om naar planrijen. Kopregels, totalen en rijen zonder tijden worden overgeslagen.
 * Een sectiekop zonder minuten bepaalt of de rijen eronder sponsors of clubmedia zijn.
 */
export function buildPlanImport(
  rows: string[][],
  kinds: PlanColumnKind[],
  opts: PlanImportOptions,
): { rows: PlanImportRow[]; skipped: PlanImportSkip[] } {
  const nameCol = kinds.indexOf("name");
  const notesCol = kinds.indexOf("notes");
  const covered = coveredPhases(kinds, opts);
  const out: PlanImportRow[] = [];
  const skipped: PlanImportSkip[] = [];
  if (nameCol < 0) return { rows: out, skipped };

  let sectionKind: PlanRowKind = "sponsor";
  for (const row of rows) {
    const name = (row[nameCol] ?? "").trim();
    if (!name) continue;
    if (/^(sub)?tota(a)?l\b/i.test(normalizeName(name))) {
      skipped.push({ name, reason: "total" });
      continue;
    }
    const seconds: Partial<Record<PlanPhase, number>> = {};
    for (const p of covered) seconds[p] = 0;
    let anyTime = false;
    kinds.forEach((kind, col) => {
      if (!TIME_KINDS.has(kind)) return;
      const sec = parseMinutes(row[col] ?? "");
      if (sec == null) return;
      anyTime = true;
      if (kind === "inside90") {
        const [a, b] = splitEvenly(sec, 2);
        seconds.firstHalf = (seconds.firstHalf ?? 0) + a;
        seconds.secondHalf = (seconds.secondHalf ?? 0) + b;
      } else if (kind === "outside90") {
        const parts = splitEvenly(sec, opts.outsideSplit.length);
        opts.outsideSplit.forEach((p, i) => {
          seconds[p] = (seconds[p] ?? 0) + parts[i];
        });
      } else {
        const p = kind as PlanPhase;
        seconds[p] = (seconds[p] ?? 0) + sec;
      }
    });
    if (!anyTime) {
      sectionKind = sectionKindFromHeader(name) ?? sectionKind;
      skipped.push({ name, reason: "no_times" });
      continue;
    }
    const notes = notesCol >= 0 ? (row[notesCol] ?? "").trim() : "";
    out.push({ name, kind: sectionKind, seconds, notes: notes || null });
  }
  return { rows: out, skipped };
}

export type PlanImportSummary = {
  created: string[];
  updated: string[];
  unchanged: number;
  duplicates: string[];
};

let newRowCounter = 0;

/**
 * Zet geplakte rijen in de tabel: op naam bij een bestaande rij, anders als nieuwe sponsor.
 * Er wordt nog niets opgeslagen; de operator ziet de wijzigingen eerst in de tabel.
 */
export function applyPlanImport(
  current: PlanRow[],
  imported: PlanImportRow[],
): { rows: PlanRow[]; summary: PlanImportSummary } {
  const rows = current.map((r) => ({ ...r, seconds: { ...r.seconds } }));
  const byName = new Map(rows.map((r, i) => [normalizeName(r.name), i]));
  const seen = new Set<string>();
  const summary: PlanImportSummary = { created: [], updated: [], unchanged: 0, duplicates: [] };

  for (const imp of imported) {
    const key = normalizeName(imp.name);
    if (!key) continue;
    if (seen.has(key)) summary.duplicates.push(imp.name);
    seen.add(key);
    const idx = byName.get(key);
    if (idx == null) {
      newRowCounter += 1;
      rows.push({
        key: `new-${Date.now()}-${newRowCounter}`,
        kind: imp.kind,
        id: null,
        name: imp.name,
        active: true,
        seconds: { ...emptySeconds(), ...imp.seconds },
        notes: imp.notes ?? "",
        guarantee: defaultSponsorGuarantee(),
        mediaCount: 0,
        clips: [],
      });
      byName.set(key, rows.length - 1);
      summary.created.push(imp.name);
      continue;
    }
    const row = rows[idx];
    let changed = false;
    for (const p of PLAN_PHASES) {
      const next = imp.seconds[p];
      if (next != null && next !== row.seconds[p]) {
        row.seconds[p] = next;
        changed = true;
      }
    }
    if (imp.notes != null && imp.notes !== row.notes.trim()) {
      row.notes = imp.notes;
      changed = true;
    }
    if (changed) {
      if (!summary.updated.includes(row.name) && !summary.created.includes(row.name)) summary.updated.push(row.name);
    } else if (!summary.created.includes(row.name)) {
      summary.unchanged += 1;
    }
  }
  return { rows, summary };
}

/** Totaal per fase van de actieve rijen (seconden). */
export function planTotals(rows: PlanRow[]): Record<PlanPhase, number> {
  const totals = emptySeconds();
  for (const row of rows) {
    if (!row.active) continue;
    for (const p of PLAN_PHASES) totals[p] += row.seconds[p];
  }
  return totals;
}

/** Woorden die in bestandsnamen en sponsornamen vaak staan maar niets zeggen over de sponsor. */
const FILE_STOPWORDS = new Set([
  "the",
  "de",
  "het",
  "een",
  "van",
  "of",
  "and",
  "en",
  "x",
  "main",
  "partner",
  "partners",
  "sponsor",
  "copy",
  "kopie",
  "video",
  "final",
  "led",
  "scherm",
  "screen",
  "groot",
  "big",
  "bigscreen",
  "grootscherm",
  "animatie",
  "visual",
  "extra",
  "rafc",
  "antwerp",
  "ant",
  "t4",
  "16x9",
  "4k",
  "hd",
  "fps",
]);

function significantTokens(value: string): string[] {
  return normalizeName(value)
    .split(" ")
    .filter((t) => t.length >= 3 && !FILE_STOPWORDS.has(t) && !/^\d+$/.test(t) && !/^\d+x\d+$/.test(t));
}

/**
 * Welke sponsor bij een bestand hoort, op basis van de naam: "ANT EBury LED 1920x1080.mp4" → Ebury.
 * Geeft null als geen sponsor duidelijk past of als twee sponsors even goed passen.
 */
export function suggestSponsorForFile(
  fileName: string,
  sponsors: { id: string; name: string }[],
): string | null {
  const base = fileName.replace(/^.*[/\\]/, "").replace(/\.[a-z0-9]+$/i, "");
  const fileTokens = normalizeName(base).split(" ").filter(Boolean);
  const fileJoined = fileTokens.join("");
  let best: { id: string; score: number } | null = null;
  let tie = false;
  for (const sponsor of sponsors) {
    const tokens = significantTokens(sponsor.name);
    if (tokens.length === 0) continue;
    let matched = 0;
    let total = 0;
    for (const tok of tokens) {
      total += tok.length;
      if (fileTokens.some((ft) => ft === tok || (tok.length >= 4 && ft.startsWith(tok)))) matched += tok.length;
    }
    /** Namen die in de bestandsnaam aan elkaar staan: "VanMossel", "TheRoots". */
    if (matched === 0) {
      const joined = tokens.join("");
      if (joined.length >= 5 && fileJoined.includes(joined)) matched = total;
    }
    if (matched === 0) continue;
    const score = matched / total;
    if (score < 0.5) continue;
    if (!best || score > best.score) {
      best = { id: sponsor.id, score };
      tie = false;
    } else if (score === best.score) {
      tie = true;
    }
  }
  return best && !tie ? best.id : null;
}

/** Hoe de motor een fase van het plan aanspreekt. */
const PHASE_ENGINE: Record<PlanPhase, { section: SponsorSection; status: string }> = {
  prematch: { section: "prematch", status: "PREMATCH" },
  firstHalf: { section: "match", status: "FIRST_HALF" },
  halftime: { section: "halftime", status: "HALF_TIME" },
  secondHalf: { section: "match", status: "SECOND_HALF" },
  postmatch: { section: "postmatch", status: "POST_MATCH" },
};

/**
 * Een planrij als deelnemer aan de rotatie, precies zoals het scherm hem zou krijgen:
 * een sponsor met zijn bestanden, volgorde en herhalingen, of clubmedia via `clubMediaToRotationSponsor`.
 */
export function rotationParticipantFromRow(
  row: PlanRow,
  ctx: { sponsorsById: Map<string, Sponsor>; mediaById: Map<string, MediaItem> },
): Sponsor | null {
  const s = row.seconds;
  if (row.kind === "sponsor") {
    const base = row.id ? ctx.sponsorsById.get(row.id) : undefined;
    const phasesById = new Map(row.clips.map((c) => [c.id, c]));
    const media = (base?.media ?? []).map((m) => {
      const clip = phasesById.get(m.id);
      return clip ? { ...m, sponsorPhaseTagsJson: tagsJsonFromPlanPhases(clip.phases, clip.originalTagsJson) } : m;
    });
    return {
      ...(base ?? {
        id: row.key,
        imageDefaultSec: 10,
        createdAt: new Date(0).toISOString(),
      }),
      media,
      id: row.key,
      name: row.name,
      active: row.active,
      prematchSeconds: s.prematch,
      matchFirstHalfSeconds: s.firstHalf,
      matchSecondHalfSeconds: s.secondHalf,
      matchSeconds: s.firstHalf + s.secondHalf,
      halftimeSeconds: s.halftime,
      postmatchSeconds: s.postmatch,
    } as Sponsor;
  }
  if (row.clips.length === 0) return null;
  const budget = clubBudgetJsonFromPlanRow(row);
  /** Zoals na opslaan: elk bestand met de groepsnaam, het budget van de rij en zijn eigen fases. */
  const items: MediaItem[] = row.clips.map((c, i) => {
    const base = c.pending ? undefined : ctx.mediaById.get(c.id);
    return {
      ...(base ?? ({ id: c.id, createdAt: new Date(8.64e15 - 1000 + i).toISOString() } as MediaItem)),
      type: c.type,
      path: c.path,
      title: c.title,
      durationSec: c.durationSec,
      active: row.active && c.active,
      sponsorId: null,
      hideFromLibrary: false,
      clubPhaseBudgetJson: budget,
      clubGroup: row.name || row.key,
      sponsorPhaseTagsJson: tagsJsonFromPlanPhases(c.phases, c.originalTagsJson),
    };
  });
  const participant = clubGroupToRotationSponsor(row.name || row.key, items);
  return participant ? { ...participant, id: row.key } : null;
}

export type PlanEffective = {
  /** Per rij (sleutel) de tijd die de rotatie echt toont: hele clips, en 0 zonder bestand voor die fase. */
  byRow: Map<string, Record<PlanPhase, number>>;
  /** Per rij: hoeveel daarvan op een vast tijdstip speelt. */
  cueByRow: Map<string, Record<PlanPhase, number>>;
  /** Som over alle rijen plus vaste tijdstippen van bestanden zonder rij: wat de fase samen vraagt. */
  totals: Record<PlanPhase, number>;
};

/** Een clip op een vast tijdstip (tijdscue), vertaald naar een fase van het plan. */
export type PlanCue = {
  id: string;
  mediaId: string;
  phase: PlanPhase;
  /** Wedstrijdklok (helften) of tijd sinds de start van de fase (voor en na de match). */
  startSec: number;
  endSec: number | null;
  /** Hoe lang hij op het scherm staat: tot de eindtijd, anders de duur van het bestand. */
  seconds: number;
  enabled: boolean;
  /** Soort boeking: tijdvenster, één volledige vertoning, of geen garantie. */
  guarantee: CueGuarantee;
};

/** Fases van de tijdscues in het plan. In de rust kan geen tijdscue (die volgt de rotatie). */
export const CUE_PLAN_PHASES = ["prematch", "firstHalf", "secondHalf", "postmatch"] as const;
export type CuePlanPhase = (typeof CUE_PLAN_PHASES)[number];

const CUE_STATUS_BY_PHASE: Record<CuePlanPhase, string> = {
  prematch: "PREMATCH",
  firstHalf: "FIRST_HALF",
  secondHalf: "SECOND_HALF",
  postmatch: "POST_MATCH",
};

export function cueStatusForPlanPhase(phase: CuePlanPhase): string {
  return CUE_STATUS_BY_PHASE[phase];
}

/** Matchstatus van een tijdscue naar een planfase; verlenging en onbekende fases tellen niet mee. */
export function planPhaseForCueStatus(status: string): CuePlanPhase | null {
  if (status === "PREMATCH" || status === "SETUP") return "prematch";
  if (status === "FIRST_HALF") return "firstHalf";
  if (status === "SECOND_HALF") return "secondHalf";
  if (status === "POST_MATCH" || status === "FULL_TIME") return "postmatch";
  return null;
}

/** Tijdscues zoals `/api/scheduled-media-cues` ze geeft, als plancues. */
export function planCuesFromApi(
  cues: {
    id: string;
    mediaId: string;
    matchStatus: string;
    triggerSec: number;
    endSec?: number | null;
    enabled: boolean;
    guarantee?: string | null;
    media?: { durationSec?: number } | null;
  }[],
): PlanCue[] {
  const out: PlanCue[] = [];
  for (const c of cues) {
    const phase = planPhaseForCueStatus(c.matchStatus);
    if (!phase) continue;
    const end = c.endSec != null && c.endSec > c.triggerSec ? c.endSec : null;
    out.push({
      id: c.id,
      mediaId: c.mediaId,
      phase,
      startSec: c.triggerSec,
      endSec: end,
      seconds: Math.max(1, end != null ? end - c.triggerSec : Math.round(c.media?.durationSec ?? 0) || 1),
      enabled: c.enabled,
      guarantee: cueGuarantee(c),
    });
  }
  return out;
}

/**
 * De schermtijd die elke rij echt krijgt als de fase lang genoeg is. Rekent met dezelfde functies als het
 * scherm: alleen actieve deelnemers met een bestand voor die fase, en een gestarte clip speelt helemaal uit.
 */
export function planEffectiveSeconds(
  rows: PlanRow[],
  ctx: { sponsorsById: Map<string, Sponsor>; mediaById: Map<string, MediaItem> },
  cues: PlanCue[] = [],
): PlanEffective {
  const participants = rows
    .map((row) => rotationParticipantFromRow(row, ctx))
    .filter((p): p is Sponsor => p != null);
  const byRow = new Map<string, Record<PlanPhase, number>>(rows.map((r) => [r.key, emptySeconds()]));
  const cueByRow = new Map<string, Record<PlanPhase, number>>(rows.map((r) => [r.key, emptySeconds()]));
  for (const phase of PLAN_PHASES) {
    const { section, status } = PHASE_ENGINE[phase];
    const active = activeSponsorsForSection(participants, section, status);
    for (const plan of buildSponsorAppearancePlan(active, section, status)) {
      const row = byRow.get(plan.id);
      if (row) row[phase] = plan.appearanceSecs.reduce((sum, x) => sum + x, 0);
    }
  }

  /**
   * Vaste tijdstippen. Een clip van een sponsor telt in het afspeellog onder die sponsor en verbruikt dus zijn
   * minuten: de rotatie geeft hem daarna minder. Hij krijgt dan het meeste van de twee. Clubmedia en losse
   * bestanden tellen op een tijdstip onder "tijdscue", dus die tijd komt erbij.
   */
  const rowByMedia = new Map<string, PlanRow>();
  for (const row of rows) for (const c of row.clips) if (!c.pending) rowByMedia.set(c.id, row);
  const totals = emptySeconds();
  for (const cue of cues) {
    if (!cue.enabled) continue;
    const row = rowByMedia.get(cue.mediaId);
    if (row && !row.active) continue;
    if (row) cueByRow.get(row.key)![cue.phase] += cue.seconds;
    else totals[cue.phase] += cue.seconds;
  }
  for (const row of rows) {
    const rot = byRow.get(row.key)!;
    const cue = cueByRow.get(row.key)!;
    for (const phase of PLAN_PHASES) {
      rot[phase] = row.kind === "sponsor" ? Math.max(rot[phase], cue[phase]) : rot[phase] + cue[phase];
      totals[phase] += rot[phase];
    }
  }
  return { byRow, cueByRow, totals };
}

/**
 * Hoeveel tijd een fase heeft voor sponsors en clubmedia samen. De helften en de rust hebben een vaste lengte;
 * voor de match alleen als de wedstrijd een venster heeft, anders duurt dat rooster zo lang als nodig.
 * Na de match is er geen eindpunt.
 */
export function planCapacity(
  match: Pick<Match, "halfDurationSec" | "halfBreakSec" | "prematchSpreadWindowSec"> | null,
): Partial<Record<PlanPhase, number>> {
  const half = match?.halfDurationSec && match.halfDurationSec > 0 ? match.halfDurationSec : 45 * 60;
  const pause = match?.halfBreakSec && match.halfBreakSec > 0 ? match.halfBreakSec : 15 * 60;
  const out: Partial<Record<PlanPhase, number>> = { firstHalf: half, secondHalf: half, halftime: pause };
  const pre = match?.prematchSpreadWindowSec;
  if (pre != null && pre > 0) out.prematch = pre;
  return out;
}

/** "12:30", "12" of "12,5" (minuten) naar seconden. Leeg of ongeldig = null. */
export function parseClockText(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const mmss = v.match(/^(\d{1,3}):(\d{1,2})$/);
  if (mmss) {
    const sec = Number(mmss[2]);
    if (sec > 59) return null;
    return Number(mmss[1]) * 60 + sec;
  }
  const minutes = parseMinutes(v);
  return minutes;
}

/** Seconden als wedstrijdklok: 660 → "11:00". */
export function formatClock(sec: number): string {
  const safe = Math.max(0, Math.round(sec));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/**
 * Nieuwe bestanden die bij meer dan één rij staan (zelfde id of zelfde pad). Opslaan zou ze dan twee keer
 * aanmaken, bij twee verschillende clubmedia; de tabel stopt in dat geval en zegt welke.
 */
export function pendingClipConflicts(rows: PlanRow[]): { file: string; rows: string[] }[] {
  const byFile = new Map<string, { file: string; rows: Set<string> }>();
  for (const row of rows) {
    for (const clip of row.clips) {
      if (!clip.pending) continue;
      for (const key of [`id:${clip.id}`, `path:${clip.path.toLowerCase()}`]) {
        const entry = byFile.get(key) ?? { file: clip.title, rows: new Set<string>() };
        entry.rows.add(row.name.trim() || row.key);
        byFile.set(key, entry);
      }
    }
  }
  const seen = new Set<string>();
  const out: { file: string; rows: string[] }[] = [];
  for (const entry of byFile.values()) {
    if (entry.rows.size < 2 || seen.has(entry.file)) continue;
    seen.add(entry.file);
    out.push({ file: entry.file, rows: [...entry.rows] });
  }
  return out;
}
