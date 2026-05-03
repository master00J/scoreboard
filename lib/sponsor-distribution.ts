import type { Sponsor, SponsorSection } from "./types";

/** Schermtijd tijdens speelhelft: aparte budgets, anders legacy `matchSeconds` voor beide. */
export function matchPlayBudgetSeconds(s: Sponsor, matchStatus: string | undefined): number {
  const first = Math.max(0, s.matchFirstHalfSeconds ?? 0);
  const second = Math.max(0, s.matchSecondHalfSeconds ?? 0);
  const useSplit = first > 0 || second > 0;
  if (!useSplit) return Math.max(0, s.matchSeconds);
  if (matchStatus === "FIRST_HALF") return first;
  if (matchStatus === "SECOND_HALF" || matchStatus === "EXTRA_TIME") return second;
  return Math.max(0, s.matchSeconds);
}

/** Totaal geplande schermtijd (s) voor deze sponsor in deze sectie / wedstrijdfase. */
export function sponsorSectionBudgetSeconds(
  s: Sponsor,
  section: SponsorSection,
  matchStatus?: string,
): number {
  if (section === "prematch") return Math.max(0, s.prematchSeconds);
  if (section === "halftime") return Math.max(0, s.halftimeSeconds);
  return matchPlayBudgetSeconds(s, matchStatus);
}

export function sponsorBudgetSectionFromMatchStatus(
  status: string | undefined,
): SponsorSection {
  if (status === "HALF_TIME") return "halftime";
  if (status === "FIRST_HALF" || status === "SECOND_HALF" || status === "EXTRA_TIME") {
    return "match";
  }
  return "prematch";
}

export function activeSponsorsForSection(
  sponsors: Sponsor[],
  section: SponsorSection,
  matchStatus?: string,
): Sponsor[] {
  return sponsors.filter(
    (s) =>
      s.active &&
      sponsorSectionBudgetSeconds(s, section, matchStatus) > 0 &&
      (s.media?.some((m) => m.active) ?? false),
  );
}

/**
 * Langste actieve clip voor één sponsor (video = duur uit bestand; afbeelding = item of sponsor-default).
 */
export function maxClipSecondsForSponsor(s: Sponsor): number {
  let m = Math.max(1, s.imageDefaultSec ?? 10);
  for (const media of s.media ?? []) {
    if (!media.active) continue;
    if (media.type === "VIDEO") {
      m = Math.max(m, Math.max(1, media.durationSec > 0 ? media.durationSec : 10));
    } else {
      const imgSec = Math.max(
        1,
        media.durationSec > 0 ? media.durationSec : s.imageDefaultSec || 10,
      );
      m = Math.max(m, imgSec);
    }
  }
  return Math.min(Math.max(m, 1), 600);
}

/**
 * Duur van de sponsor-fase na een slot: langste clip van **deze** sponsor.
 * Fallback = sectie-max (alle sponsors), bv. onbekend id.
 */
export function holdSecondsForSponsorPhase(
  sponsors: Sponsor[],
  section: SponsorSection,
  matchStatus: string | undefined,
  sponsorId: string | null | undefined,
): number {
  if (sponsorId) {
    const s = sponsors.find((x) => x.id === sponsorId);
    if (s) return maxClipSecondsForSponsor(s);
  }
  return maxSponsorClipSecondsForSection(sponsors, section, matchStatus);
}

export function maxSponsorClipSecondsForSection(
  sponsors: Sponsor[],
  section: SponsorSection,
  matchStatus?: string,
): number {
  const active = activeSponsorsForSection(sponsors, section, matchStatus);
  let m = 10;
  for (const s of active) {
    m = Math.max(m, maxClipSecondsForSponsor(s));
  }
  return Math.min(Math.max(m, 1), 600);
}

/** Seconden sinds start van de actuele helft / blok (0 … H). */
export function halfWindowElapsed(
  elapsed: number,
  status: string | undefined,
  halfDurationSec: number,
): number {
  const H = Math.max(60, halfDurationSec);
  if (status === "FIRST_HALF") return Math.min(Math.max(0, elapsed), H);
  if (status === "SECOND_HALF") {
    return Math.min(Math.max(0, elapsed - H), H);
  }
  if (status === "EXTRA_TIME") {
    const et1 = 2 * H;
    if (elapsed < et1 + H) return Math.min(Math.max(0, elapsed - et1), H);
    return Math.min(Math.max(0, elapsed - (et1 + H)), H);
  }
  return 0;
}

/**
 * Als er meer sponsor-“seconden” dan plekken op de tijdlijn zijn: uniform uit de
 * round-robin-wachtrij samplen i.p.v. alleen de eerste H seconden te pakken (scheef).
 */
export function thinSponsorQueue(queue: string[], maxLen: number): string[] {
  const L = queue.length;
  const cap = Math.floor(maxLen);
  if (L <= cap || cap <= 0) return queue;
  const out: string[] = [];
  for (let k = 0; k < cap; k++) {
    const idx = Math.min(L - 1, Math.floor(((k + 0.5) * L) / cap));
    out.push(queue[idx]!);
  }
  return out;
}

/**
 * Meerdere sponsors kunnen naar dezelfde seconde wijzen (stratified bins botsen).
 * Schuif naar het dichtstbijzijnde vrije seconde zodat geen budget verloren gaat.
 */
export function assignBinsCollisionFree(preferredBins: number[], Hc: number): number[] {
  const occupied = new Set<number>();
  const out: number[] = [];
  for (const pref of preferredBins) {
    let b = Math.min(Hc - 1, Math.max(0, Math.floor(pref)));
    if (!occupied.has(b)) {
      occupied.add(b);
      out.push(b);
      continue;
    }
    let found = -1;
    for (let d = 1; d < Hc; d++) {
      const right = b + d;
      if (right < Hc && !occupied.has(right)) {
        found = right;
        break;
      }
      const left = b - d;
      if (left >= 0 && !occupied.has(left)) {
        found = left;
        break;
      }
    }
    if (found === -1) {
      for (let j = 0; j < Hc; j++) {
        if (!occupied.has(j)) {
          found = j;
          break;
        }
      }
    }
    if (found === -1) break;
    occupied.add(found);
    out.push(found);
  }
  return out;
}

/**
 * Verdeel N sponsor-slots over H seconden (stratified): sponsoring loopt over de hele
 * periode i.p.v. te clusteren. Bij N > H wordt uniform gedunt via `thinSponsorQueue`.
 */
export function spreadSponsorBinIndices(N: number, H: number): number[] {
  const Hf = Math.max(1, Math.floor(H));
  if (N <= 0) return [];
  const out: number[] = [];
  const n = Math.min(N, Hf);
  for (let k = 0; k < n; k++) {
    const idx = Math.min(Hf - 1, Math.floor(((k + 0.5) * Hf) / n));
    out.push(idx);
  }
  return out;
}

/**
 * Aantal geplande sponsor-seconden (slotmap) voor `sponsorId` van seconde 0 t/m `tSec`
 * (inclusief, op basis van floor(tSec)).
 */
export function sponsorAirtimeScheduledSeconds(
  map: (string | null)[],
  sponsorId: string,
  tSec: number,
): number {
  if (map.length === 0) return 0;
  const end = Math.min(map.length - 1, Math.max(0, Math.floor(tSec)));
  let c = 0;
  for (let i = 0; i <= end; i++) {
    if (map[i] === sponsorId) c++;
  }
  return c;
}

/** Round-robin: elke seconde sponsor-tijd af van rij tot alles op is. */
export function buildSponsorSecondQueue(
  active: Sponsor[],
  section: SponsorSection,
  matchStatus?: string,
): string[] {
  const pool = active.map((s) => ({
    id: s.id,
    left: sponsorSectionBudgetSeconds(s, section, matchStatus),
  }));
  const q: string[] = [];
  let k = 0;
  for (;;) {
    const alive = pool.filter((p) => p.left > 0);
    if (alive.length === 0) break;
    const idx = k % pool.length;
    k++;
    if (pool[idx].left <= 0) continue;
    pool[idx].left--;
    q.push(pool[idx].id);
  }
  return q;
}

/** Per seconde-index in de helft: welke sponsor-id of null (= scorebord). */
export function buildSponsorSlotMap(
  active: Sponsor[],
  section: SponsorSection,
  H: number,
  matchStatus?: string,
): (string | null)[] {
  const Hc = Math.max(1, Math.floor(H));
  let queue = buildSponsorSecondQueue(active, section, matchStatus);
  const map: (string | null)[] = Array(Hc).fill(null);
  if (queue.length === 0) return map;
  if (queue.length > Hc) {
    queue = thinSponsorQueue(queue, Hc);
  }
  const bins = spreadSponsorBinIndices(queue.length, Hc);
  const safeBins = assignBinsCollisionFree(bins, Hc);
  for (let i = 0; i < queue.length; i++) {
    const b = safeBins[i] ?? 0;
    map[b] = queue[i]!;
  }
  return map;
}

/** Ref voor vol te houden sponsor-slide terwijl de slotmap al naar scorebord zou gaan. */
export type SponsorPhaseHangRef = {
  current: { sponsorId: string; untilMs: number } | null;
};

export type ResolveSponsorSpreadOptions = {
  /**
   * Één gemengd sponsorblok: geen filter per tijdslot; alle sponsors rouleren samen.
   * Hang-duur = langste clip in de sectie (past bij wisselende clips in de roulering).
   */
  unifiedRotation?: boolean;
};

/**
 * Zelfde logica als het display: hang vast aan sponsor gedurende langste clip in deze sectie.
 */
export function resolveSponsorSpreadPhase(
  raw: { phase: "scoreboard" | "sponsor"; sponsorId: string | null },
  sponsors: Sponsor[],
  section: SponsorSection,
  matchStatus: string | undefined,
  nowMs: number,
  hangRef: SponsorPhaseHangRef,
  options?: ResolveSponsorSpreadOptions,
): { phase: "scoreboard" | "sponsor"; sponsorFilterId: string | null } {
  const unified = options?.unifiedRotation ?? false;
  const hang = hangRef.current;
  if (hang && nowMs < hang.untilMs) {
    return {
      phase: "sponsor",
      sponsorFilterId: unified ? null : hang.sponsorId,
    };
  }
  hangRef.current = null;
  if (raw.phase === "sponsor" && raw.sponsorId) {
    const holdSec = unified
      ? maxSponsorClipSecondsForSection(sponsors, section, matchStatus)
      : holdSecondsForSponsorPhase(sponsors, section, matchStatus, raw.sponsorId);
    hangRef.current = {
      sponsorId: raw.sponsorId,
      untilMs: nowMs + holdSec * 1000,
    };
  }
  const filterOut =
    unified && raw.phase === "sponsor" ? null : raw.sponsorId;
  return { phase: raw.phase, sponsorFilterId: filterOut };
}

export function lookupSponsorAtSecond(
  map: (string | null)[],
  tSec: number,
): { phase: "scoreboard" | "sponsor"; sponsorId: string | null } {
  if (map.length === 0) {
    return { phase: "scoreboard", sponsorId: null };
  }
  const idx = Math.min(Math.max(0, Math.floor(tSec)), map.length - 1);
  const id = map[idx];
  if (id == null) return { phase: "scoreboard", sponsorId: null };
  return { phase: "sponsor", sponsorId: id };
}

export type SponsorScreenConsumedOptions = {
  /**
   * Zelfde als display met unifiedRotation: hang-lengte = langste clip in de sectie.
   * Schermtijd telt alleen voor de sponsor die op de slotmap aan het begin van die hang staat
   * (niet proportioneel verdelen over alle sponsors).
   */
  unifiedHangDuration?: boolean;
};

/**
 * Cumulatieve schermtijd (seconden) voor één sponsor tot wedstrijdtijd `tEnd` op de tijdlijn,
 * met hang-regels als het display (één slot kan een clip van meerdere seconden zijn).
 */
export function sponsorScreenSecondsConsumed(
  map: (string | null)[],
  sponsors: Sponsor[],
  section: SponsorSection,
  matchStatus: string | undefined,
  tEnd: number,
  sponsorId: string,
  options?: SponsorScreenConsumedOptions,
): number {
  if (map.length === 0 || tEnd <= 0) return 0;
  const unifiedHang = options?.unifiedHangDuration ?? false;
  let t = 0;
  let consumed = 0;
  let hangUntil = -1;
  let hangFor: string | null = null;
  const EPS = 1e-6;

  while (t < tEnd - EPS) {
    if (hangFor != null && hangUntil > t + EPS) {
      const segEnd = Math.min(hangUntil, tEnd);
      if (hangFor === sponsorId) consumed += segEnd - t;
      t = segEnd;
      if (t >= hangUntil - EPS) {
        hangFor = null;
        hangUntil = -1;
      }
      continue;
    }

    const raw = lookupSponsorAtSecond(map, t);
    if (raw.phase === "sponsor" && raw.sponsorId) {
      const hold = unifiedHang
        ? maxSponsorClipSecondsForSection(sponsors, section, matchStatus)
        : holdSecondsForSponsorPhase(sponsors, section, matchStatus, raw.sponsorId);
      hangFor = raw.sponsorId;
      hangUntil = t + Math.max(1, hold);
      continue;
    }

    const nextBoundary = Math.floor(t + EPS) + 1;
    t = Math.min(nextBoundary, tEnd);
  }

  return Math.min(Math.max(0, Math.round(consumed)), 999999);
}
