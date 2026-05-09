import type { Sponsor, SponsorSection } from "./types";
import { mediaAllowedForSponsorPhase } from "./sponsor-media-phases";

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
      (s.media?.some((m) => m.active && mediaAllowedForSponsorPhase(m, section, matchStatus)) ?? false),
  );
}

/**
 * Lengte van het prematch-sponsorrooster (seconden): herhalende tijdlijn voor spread/«naast scorebord».
 * Bij `prematchSpreadWindowSec` > 0 op de wedstrijd: die waarde (60s … 24u), anders automatisch ≈ som prematch-budgetten.
 */
export function prematchSpreadTimelineSeconds(
  match: { prematchSpreadWindowSec?: number | null } | null | undefined,
  sponsors: Sponsor[],
): number {
  const active = activeSponsorsForSection(sponsors, "prematch");
  const budgetTotal = active.reduce((a, s) => a + Math.max(0, s.prematchSeconds), 0);
  const configured = match?.prematchSpreadWindowSec ?? 0;
  if (typeof configured === "number" && configured > 0) {
    return Math.min(86400, Math.max(60, Math.floor(configured)));
  }
  return Math.max(60, budgetTotal);
}

/**
 * Langste actieve clip voor één sponsor (video = duur uit bestand; afbeelding = item of sponsor-default).
 */
export function maxClipSecondsForSponsor(
  s: Sponsor,
  section?: SponsorSection,
  matchStatus?: string,
): number {
  let m = Math.max(1, s.imageDefaultSec ?? 10);
  for (const media of s.media ?? []) {
    if (!media.active) continue;
    if (section && !mediaAllowedForSponsorPhase(media, section, matchStatus)) continue;
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
    if (s) return maxClipSecondsForSponsor(s, section, matchStatus);
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
    m = Math.max(m, maxClipSecondsForSponsor(s, section, matchStatus));
  }
  return Math.min(Math.max(m, 1), 600);
}

/**
 * Seconden tot de slotmap vanaf `tSec` een andere waarde kiest (andere sponsor-id of scorebord).
 * Niet meer gebruikt om hang in te korten — clips moeten volledig spelen — maar handig voor
 * roster/voorspelling.
 */
export function secondsUntilSponsorRunEnds(map: (string | null)[], tSec: number): number {
  if (map.length === 0) return 1;
  const i0 = Math.min(map.length - 1, Math.max(0, Math.floor(tSec)));
  const cur = map[i0];
  let j = i0 + 1;
  while (j < map.length) {
    if (map[j] !== cur) break;
    j++;
  }
  return Math.max(0.01, j - tSec);
}

/**
 * Hang-duur = volledige langste clip van deze sponsor (clip mag nooit afgekapt worden door
 * de slotmap-tikken). Slotmap-info wordt genegeerd; signature blijft compatibel.
 */
export function holdSecondsCappedBySlotRun(
  sponsors: Sponsor[],
  section: SponsorSection,
  matchStatus: string | undefined,
  sponsorId: string | null | undefined,
  _slotMap?: (string | null)[],
  _slotT?: number,
): number {
  void _slotMap;
  void _slotT;
  return holdSecondsForSponsorPhase(sponsors, section, matchStatus, sponsorId);
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

export type SponsorAppearancePlan = {
  id: string;
  clipSec: number;
  appearances: number;
};

/**
 * Slotmap-starts zijn vertoningen, geen losse budgetseconden. Een sponsor met 60s budget
 * en een clip van 30s krijgt dus ongeveer 2 starts over de fase, niet 60 starts.
 */
export function buildSponsorAppearancePlan(
  active: Sponsor[],
  section: SponsorSection,
  matchStatus?: string,
): SponsorAppearancePlan[] {
  return active
    .map((s) => {
      const budget = sponsorSectionBudgetSeconds(s, section, matchStatus);
      const clipSec = Math.max(1, Math.ceil(maxClipSecondsForSponsor(s, section, matchStatus)));
      return {
        id: s.id,
        clipSec,
        appearances: Math.max(0, Math.ceil(budget / clipSec)),
      };
    })
    .filter((p) => p.appearances > 0);
}

/**
 * Bouw sponsorblokken/rondes. Sponsors met meer geboekte tijd verschijnen in meer rondes;
 * binnen één ronde mogen verschillende sponsors gewoon direct na elkaar spelen.
 */
export function buildSponsorBlockRounds(plan: SponsorAppearancePlan[]): string[][] {
  const maxRounds = Math.max(0, ...plan.map((p) => p.appearances));
  if (maxRounds <= 0) return [];
  const rounds: string[][] = Array.from({ length: maxRounds }, () => []);
  for (const p of plan) {
    const roundIndices = spreadSponsorBinIndices(p.appearances, maxRounds);
    for (const roundIdx of roundIndices) {
      rounds[roundIdx]?.push(p.id);
    }
  }
  const order = new Map(plan.map((p, idx) => [p.id, idx]));
  return rounds
    .map((round) =>
      round
        .slice()
        .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
    )
    .filter((round) => round.length > 0);
}

/** Per seconde-index in de helft: welke sponsor-id of null (= scorebord). */
export function buildSponsorSlotMap(
  active: Sponsor[],
  section: SponsorSection,
  H: number,
  matchStatus?: string,
): (string | null)[] {
  const Hc = Math.max(1, Math.floor(H));
  const map: (string | null)[] = Array(Hc).fill(null);
  const plan = buildSponsorAppearancePlan(active, section, matchStatus);
  if (plan.length === 0) return map;

  const clipSecById = new Map(plan.map((p) => [p.id, p.clipSec]));
  const rounds = buildSponsorBlockRounds(plan);
  if (rounds.length === 0) return map;

  const roundDurations = rounds.map((round) =>
    round.reduce((sum, sponsorId) => sum + (clipSecById.get(sponsorId) ?? 1), 0),
  );
  const totalSponsorSec = roundDurations.reduce((sum, dur) => sum + dur, 0);
  const gapSec = totalSponsorSec < Hc ? (Hc - totalSponsorSec) / (rounds.length + 1) : 0;

  let cursor = gapSec;
  for (let r = 0; r < rounds.length; r++) {
    let t = Math.round(cursor);
    for (const sponsorId of rounds[r]!) {
      if (t >= Hc) return map;
      const clipSec = clipSecById.get(sponsorId) ?? 1;
      if (t >= 0) {
        const triggerWindowSec = Math.min(3, Math.max(1, clipSec));
        for (let w = 0; w < triggerWindowSec && t + w < Hc && w < clipSec; w++) {
          if (map[t + w] == null) map[t + w] = sponsorId;
        }
      }
      t += clipSec;
    }
    cursor += roundDurations[r]! + gapSec;
  }

  return map;
}

/** Ref voor vol te houden sponsor-slide terwijl de slotmap al naar scorebord zou gaan. */
export type SponsorPhaseHangRef = {
  current: {
    sponsorId: string;
    untilMs: number;
    startedAtMs: number;
    /** Slot-index op de slotmap waar deze hang oorspronkelijk gestart is (voor pauze-detectie). */
    startedAtSlotIdx?: number;
    /** Laatste tick-tijd waarop deze hang is geëvalueerd (voor interrupt-vriesklok). */
    lastSeenAtMs?: number;
  } | null;
};

export type ResolveSponsorSpreadOptions = {
  /** Slotmap + huidige tijd `t` (zelfde eenheid als `lookupSponsorAtSecond`): cap hang per segment. */
  slotMap?: (string | null)[];
  slotT?: number;
  /**
   * Onderbreking actief (bv. doelpunt-, speler- of kaart-overlay): de hang-klok vriest in.
   * Resterende hangtijd schuift mee zodat de sponsor zijn volle clip krijgt na de overlay.
   */
  interrupted?: boolean;
  /** Optionele scorebordperiode na een sponsorclip; standaard uit, blokplanning bepaalt de pauzes. */
  minScoreboardMsAfterHang?: number;
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
  const slotIdx =
    options?.slotMap && options.slotT !== undefined && options.slotMap.length > 0
      ? Math.min(options.slotMap.length - 1, Math.max(0, Math.floor(options.slotT)))
      : undefined;
  const interrupted = options?.interrupted === true;

  const hang = hangRef.current;

  /**
   * Onderbreking (goal-overlay, spelervideo, kaart, wissel): hang-klok bevriezen door
   * `untilMs` per tick met de werkelijke deltatijd op te schuiven. Zo speelt de sponsor
   * zijn volledige clip uit nadat de overlay weer weg is.
   */
  if (interrupted && hang) {
    const lastSeen = hang.lastSeenAtMs ?? nowMs;
    const dt = Math.max(0, nowMs - lastSeen);
    if (dt > 0) {
      hang.untilMs += dt;
      hang.startedAtMs += dt;
    }
    hang.lastSeenAtMs = nowMs;
    return { phase: "sponsor", sponsorFilterId: hang.sponsorId };
  }

  if (hang && nowMs < hang.untilMs) {
    hang.lastSeenAtMs = nowMs;
    return {
      phase: "sponsor",
      sponsorFilterId: hang.sponsorId,
    };
  }

  const minScoreboardMsAfterHang = Math.max(0, options?.minScoreboardMsAfterHang ?? 0);
  if (
    hang &&
    raw.phase === "sponsor" &&
    nowMs >= hang.untilMs &&
    nowMs - hang.untilMs < minScoreboardMsAfterHang
  ) {
    hang.lastSeenAtMs = nowMs;
    return { phase: "scoreboard", sponsorFilterId: null };
  }

  /**
   * Pauze-bescherming: als de wedstrijdklok niet beweegt blijft de slotmap dezelfde sponsor
   * teruggeven. Net-gestopt-hang + zelfde slot-index + zelfde sponsor-id ⇒ geen nieuwe hang
   * starten (anders flitst de progressbar naar 0). Pas her-trigger toelaten als de slot-index
   * effectief verandert (klok loopt weer).
   */
  if (
    hang &&
    raw.phase === "sponsor" &&
    raw.sponsorId === hang.sponsorId &&
    slotIdx !== undefined &&
    hang.startedAtSlotIdx === slotIdx
  ) {
    hangRef.current = null;
    return { phase: "scoreboard", sponsorFilterId: null };
  }

  hangRef.current = null;
  if (raw.phase === "sponsor" && raw.sponsorId) {
    const holdSec = holdSecondsCappedBySlotRun(
      sponsors,
      section,
      matchStatus,
      raw.sponsorId,
      options?.slotMap,
      options?.slotT,
    );
    hangRef.current = {
      sponsorId: raw.sponsorId,
      untilMs: nowMs + holdSec * 1000,
      startedAtMs: nowMs,
      startedAtSlotIdx: slotIdx,
      lastSeenAtMs: nowMs,
    };
  }
  const filterOut = raw.phase === "sponsor" ? raw.sponsorId : null;
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

/**
 * Cumulatieve schermtijd (seconden) voor één sponsor tot wedstrijdtijd `tEnd` op de tijdlijn,
 * met hang-regels als het display (per-sponsor clip, begrensd tot slotmap-run).
 */
export function sponsorScreenSecondsConsumed(
  map: (string | null)[],
  sponsors: Sponsor[],
  section: SponsorSection,
  matchStatus: string | undefined,
  tEnd: number,
  sponsorId: string,
): number {
  if (map.length === 0 || tEnd <= 0) return 0;
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
      const hold = holdSecondsCappedBySlotRun(
        sponsors,
        section,
        matchStatus,
        raw.sponsorId,
        map,
        t,
      );
      hangFor = raw.sponsorId;
      hangUntil = t + hold;
      continue;
    }

    const nextBoundary = Math.floor(t + EPS) + 1;
    t = Math.min(nextBoundary, tEnd);
  }

  return Math.min(Math.max(0, Math.round(consumed)), 999999);
}
