import type { Sponsor, SponsorSection } from "./types";
import { mediaAllowedForSponsorPhase } from "./sponsor-media-phases";
import { buildSponsorRotationMediaList } from "./sponsor-playback-order";

/** Optionele budgetbron voor venster-engines (volleybal `sportBudgetsJson.play`, …). */
export type SponsorBudgetResolver = (sponsor: Sponsor) => number;

function resolveSectionBudget(
  sponsor: Sponsor,
  section: SponsorSection,
  matchStatus: string | undefined,
  budgetOf?: SponsorBudgetResolver,
): number {
  return budgetOf ? budgetOf(sponsor) : sponsorSectionBudgetSeconds(sponsor, section, matchStatus);
}

/** Hard plafond: voorkomt een oneindige round-robin bij absurde budgetten. */
export const MAX_SPONSOR_SECOND_QUEUE = 24 * 60 * 60;

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
  if (section === "postmatch") return Math.max(0, s.postmatchSeconds ?? 0);
  return matchPlayBudgetSeconds(s, matchStatus);
}

export function sponsorBudgetSectionFromMatchStatus(
  status: string | undefined,
): SponsorSection {
  if (status === "HALF_TIME") return "halftime";
  if (status === "FIRST_HALF" || status === "SECOND_HALF" || status === "EXTRA_TIME") {
    return "match";
  }
  if (status === "FULL_TIME" || status === "POST_MATCH") return "postmatch";
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
 * Lengte van het prematch-sponsorrooster (seconden): spread-tijdlijn voor «voor wedstrijd».
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
 * Prematch-spread loopt één keer over H seconden (geen modulo): na het budget/rooster → scorebord.
 */
export function prematchSpreadClock(
  elapsedSec: number,
  timelineLenSec: number,
): { t: number; timelineComplete: boolean } {
  const H = Math.max(1, Math.floor(timelineLenSec));
  const elapsed = Math.max(0, elapsedSec);
  if (elapsed >= H) {
    return { t: H - 1, timelineComplete: true };
  }
  return { t: Math.min(H - 1, Math.floor(elapsed)), timelineComplete: false };
}

/**
 * Lengte van het na-wedstrijd-rooster: som van de postmatch-budgetten (min. 60s).
 * Anders dan prematch is er geen vast eindpunt (zoals de aftrap), dus de tijdlijn
 * is precies zo lang als de geboekte schermtijd.
 */
export function postmatchSpreadTimelineSeconds(sponsors: Sponsor[]): number {
  const active = activeSponsorsForSection(sponsors, "postmatch");
  const budgetTotal = active.reduce((a, s) => a + Math.max(0, s.postmatchSeconds ?? 0), 0);
  return Math.max(60, budgetTotal);
}

/**
 * Rust- en na-wedstrijd-rooster: net als prematch één keer over H seconden.
 *
 * Voorheen liep de rustklok met `% H` en begon het rooster dus eindeloos opnieuw zodra
 * de pauze-tijdlijn om was — sponsors bleven spelen nadat hun geboekte rusttijd op was.
 * De budgetten zijn binnen H ingepland, dus als H voorbij is, is het rooster klaar.
 *
 * `loopForever` (instelling «budget-cycli herhalen») houdt het oude, doorlopende gedrag.
 */
export function sectionSpreadClock(
  elapsedSec: number,
  timelineLenSec: number,
  loopForever = false,
): { t: number; timelineComplete: boolean } {
  const H = Math.max(1, Math.floor(timelineLenSec));
  const elapsed = Math.max(0, elapsedSec);
  if (loopForever) return { t: elapsed % H, timelineComplete: false };
  if (elapsed >= H) return { t: H - 1, timelineComplete: true };
  return { t: elapsed, timelineComplete: false };
}

/** Rust/postmatch: speelkop (na freeze) heeft de geboekte tijdlijn opgebruikt. */
export function sectionPlayheadExhausted(
  playT: number,
  timelineLenSec: number,
  loopForever = false,
): boolean {
  if (loopForever) return false;
  return playT >= Math.max(1, Math.floor(timelineLenSec));
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
 * Duur (s) van elke vertoning in de rotatie van deze sponsor, in afspeelvolgorde
 * (inclusief per-clip herhalingen). Eén vertoning = één clip.
 */
export function sponsorRotationClipSeconds(
  s: Sponsor,
  section?: SponsorSection,
  matchStatus?: string,
): number[] {
  const media = buildSponsorRotationMediaList(
    (s.media ?? []).filter(
      (m) => m.active && (!section || mediaAllowedForSponsorPhase(m, section, matchStatus)),
    ),
    s.sponsorPlaybackOrderJson,
    s.sponsorPlaybackRepeatsJson,
  );
  return media.map((item) =>
    item.type === "VIDEO"
      ? Math.max(1, item.durationSec > 0 ? item.durationSec : 10)
      : Math.max(1, item.durationSec > 0 ? item.durationSec : s.imageDefaultSec || 10),
  );
}

/**
 * Duur van een volledige sponsor-pass (alle clips één keer) in deze fase.
 * Niet meer de hang-duur — een slot toont één clip — maar wel handig om te
 * weten hoe lang het duurt voor een sponsor al zijn bestanden gehad heeft.
 */
export function sponsorPassSecondsForSponsor(
  s: Sponsor,
  section?: SponsorSection,
  matchStatus?: string,
): number {
  const clips = sponsorRotationClipSeconds(s, section, matchStatus);
  if (clips.length === 0) return maxClipSecondsForSponsor(s, section, matchStatus);
  const total = clips.reduce((sum, sec) => sum + sec, 0);
  return Math.min(Math.max(total, 1), 600);
}

/**
 * Index (0-based) van de vertoning die op seconde `t` van de slotmap loopt:
 * hoeveel keer deze sponsor daarvóór al aan de beurt is geweest. Elke aaneengesloten
 * run in de slotmap is één vertoning.
 */
export function sponsorAppearanceIndexAt(
  map: (string | null)[],
  sponsorId: string,
  tSec: number,
): number {
  if (map.length === 0) return 0;
  const end = Math.min(map.length - 1, Math.max(0, Math.floor(tSec)));
  let count = 0;
  let prev: string | null = null;
  for (let i = 0; i <= end; i++) {
    const cur = map[i] ?? null;
    if (cur === sponsorId && prev !== sponsorId) count++;
    prev = cur;
  }
  return Math.max(0, count - 1);
}

/**
 * Duur van de sponsor-fase na een slot: **één clip** uit de rotatie van deze sponsor —
 * de clip die bij deze vertoning aan de beurt is (clip 1 → 2 → 3 → 1 …).
 *
 * Voorheen was dit een volledige pass, terwijl het rooster met de langste losse clip
 * rekende: een sponsor met drie clips kreeg dan 3× zijn geboekte schermtijd.
 *
 * Fallback = sectie-max (alle sponsors), bv. bij een onbekend id.
 */
export function holdSecondsForSponsorPhase(
  sponsors: Sponsor[],
  section: SponsorSection,
  matchStatus: string | undefined,
  sponsorId: string | null | undefined,
  slotMap?: (string | null)[],
  slotT?: number,
): number {
  if (sponsorId) {
    const s = sponsors.find((x) => x.id === sponsorId);
    if (s) {
      const clips = sponsorRotationClipSeconds(s, section, matchStatus);
      if (clips.length > 0) {
        const idx =
          slotMap && slotMap.length > 0 && slotT !== undefined
            ? sponsorAppearanceIndexAt(slotMap, sponsorId, slotT)
            : 0;
        return Math.min(600, Math.max(1, Math.ceil(clips[idx % clips.length]!)));
      }
      return maxClipSecondsForSponsor(s, section, matchStatus);
    }
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
 * Hang-duur = de clip die bij deze vertoning speelt (nooit afgekapt door slotmap-tikken).
 * Slotmap + tijd bepalen wélke clip uit de rotatie aan de beurt is.
 */
export function holdSecondsCappedBySlotRun(
  sponsors: Sponsor[],
  section: SponsorSection,
  matchStatus: string | undefined,
  sponsorId: string | null | undefined,
  slotMap?: (string | null)[],
  slotT?: number,
): number {
  return holdSecondsForSponsorPhase(sponsors, section, matchStatus, sponsorId, slotMap, slotT);
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
  budgetOf?: SponsorBudgetResolver,
): string[] {
  const pool = active.map((s) => ({
    id: s.id,
    left: resolveSectionBudget(s, section, matchStatus, budgetOf),
  }));
  const q: string[] = [];
  let k = 0;
  for (;;) {
    if (q.length >= MAX_SPONSOR_SECOND_QUEUE) break;
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
  /** Duur van elke vertoning, in rotatievolgorde: clip 1 → 2 → 3 → 1 … */
  appearanceSecs: number[];
  /** Gemiddelde clipduur; alleen voor spreiding/fallback. */
  clipSec: number;
  appearances: number;
};

/** Veiligheidsrem: nooit meer vertoningen plannen dan dit, ook niet bij minieme clips. */
const MAX_APPEARANCES_PER_SPONSOR = 500;

/**
 * Slotmap-starts zijn vertoningen, geen losse budgetseconden — en één vertoning is
 * één clip. Het budget wordt gevuld door de rotatie af te lopen (clip 1 → 2 → 3 → 1 …).
 *
 * Een clip wordt **nooit afgekapt**: zolang er nog budget over is start de volgende clip,
 * en die speelt helemaal uit — ook als hij daarmee net over het budget gaat. Dat is
 * dezelfde regel als de speler zelf hanteert (`pickNext` laat een sponsor toe zolang
 * `spent < budget`, de lopende clip mag uitlopen).
 *
 * Zo krijgt een sponsor met drie clips van 20s en 120s budget zes vertoningen die samen
 * precies zijn budget vullen, in plaats van zes volledige passes van 60s (3× te veel).
 */
export function buildSponsorAppearancePlan(
  active: Sponsor[],
  section: SponsorSection,
  matchStatus?: string,
  budgetOf?: SponsorBudgetResolver,
): SponsorAppearancePlan[] {
  return active
    .map((s) => {
      const budget = resolveSectionBudget(s, section, matchStatus, budgetOf);
      const fallbackSec = Math.max(1, Math.ceil(maxClipSecondsForSponsor(s, section, matchStatus)));
      const rotation = sponsorRotationClipSeconds(s, section, matchStatus).map((sec) =>
        Math.max(1, Math.ceil(sec)),
      );
      const cycle = rotation.length > 0 ? rotation : [fallbackSec];

      const appearanceSecs: number[] = [];
      let used = 0;
      while (appearanceSecs.length < MAX_APPEARANCES_PER_SPONSOR) {
        /** Op = op: geen nieuwe clip meer starten zodra het budget verbruikt is. */
        if (used >= budget) break;
        /** Wel starten? Dan speelt hij volledig uit, ook over het budget heen. */
        const sec = cycle[appearanceSecs.length % cycle.length]!;
        appearanceSecs.push(sec);
        used += sec;
      }

      const total = appearanceSecs.reduce((sum, sec) => sum + sec, 0);
      return {
        id: s.id,
        appearanceSecs,
        clipSec:
          appearanceSecs.length > 0
            ? Math.max(1, Math.round(total / appearanceSecs.length))
            : fallbackSec,
        appearances: appearanceSecs.length,
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
  budgetOf?: SponsorBudgetResolver,
): (string | null)[] {
  const Hc = Math.max(1, Math.floor(H));
  const map: (string | null)[] = Array(Hc).fill(null);
  const plan = buildSponsorAppearancePlan(active, section, matchStatus, budgetOf);
  if (plan.length === 0) return map;

  const planById = new Map(plan.map((p) => [p.id, p]));
  const rounds = buildSponsorBlockRounds(plan);
  if (rounds.length === 0) return map;

  /**
   * Elke vertoning is de volgende clip uit de rotatie van die sponsor, dus slots van
   * dezelfde sponsor kunnen verschillende lengtes hebben. Wijs ze toe in rondevolgorde.
   */
  const cursorById = new Map<string, number>();
  const roundItems = rounds.map((round) =>
    round.map((sponsorId) => {
      const p = planById.get(sponsorId);
      const i = cursorById.get(sponsorId) ?? 0;
      cursorById.set(sponsorId, i + 1);
      const sec = p?.appearanceSecs[i] ?? p?.clipSec ?? 1;
      return { id: sponsorId, sec: Math.max(1, Math.ceil(sec)) };
    }),
  );

  const roundDurations = roundItems.map((items) =>
    items.reduce((sum, item) => sum + item.sec, 0),
  );
  const totalSponsorSec = roundDurations.reduce((sum, dur) => sum + dur, 0);
  const leftover = Math.max(0, Hc - totalSponsorSec);
  const gapCount = roundItems.length + 1;
  const rawGap = leftover / gapCount;
  /**
   * Resttijd in spleten van 1–2 s tussen clips oogt als een flits. Alleen spreiden
   * als elke spleet lang genoeg is om het scorebord te lezen; anders clips aaneen
   * en de rest achteraan.
   */
  const gapSec = rawGap >= MIN_VISIBLE_SCOREBOARD_SEC ? leftover / gapCount : 0;

  let cursor = gapSec;
  for (let r = 0; r < roundItems.length; r++) {
    let t = Math.round(cursor);
    for (const item of roundItems[r]!) {
      if (t >= Hc) return map;
      if (t >= 0) {
        const triggerWindowSec = Math.min(3, Math.max(1, item.sec));
        for (let w = 0; w < triggerWindowSec && t + w < Hc && w < item.sec; w++) {
          if (map[t + w] == null) map[t + w] = item.id;
        }
      }
      t += item.sec;
    }
    cursor += roundDurations[r]! + gapSec;
  }

  return map;
}

/**
 * Kortste scorebord tussen clips dat nog als rust leesbaar is.
 * Korter (typisch 1 s na elke clip) oogt als een flits — die spleet overslaan.
 */
export const MIN_VISIBLE_SCOREBOARD_SEC = 5;

/** Eerste sponsor-trigger vanaf `fromSec` op de slotmap, of null. */
export function nextSponsorTriggerFrom(
  map: (string | null)[],
  fromSec: number,
): { id: string; atSec: number } | null {
  if (map.length === 0) return null;
  const start = Math.min(Math.max(0, Math.floor(fromSec)), map.length - 1);
  for (let i = start; i < map.length; i++) {
    const id = map[i];
    if (id != null) return { id, atSec: i };
  }
  return null;
}

/**
 * Seconden in de lopende helft zonder plafond op de helftduur. De roosterklok krijgt deze
 * tijd: liep het rooster achter door onderbrekingen, dan loopt het in de blessuretijd door tot
 * alle geplande vertoningen geweest zijn. De klok zelf stopt het rooster op de helftduur.
 */
export function halfWindowElapsedOpenEnded(
  elapsed: number,
  status: string | undefined,
  halfDurationSec: number,
): number {
  const H = Math.max(60, halfDurationSec);
  if (status === "FIRST_HALF") return Math.max(0, elapsed);
  if (status === "SECOND_HALF") return Math.max(0, elapsed - H);
  return halfWindowElapsed(elapsed, status, halfDurationSec);
}

/**
 * Haalt achterstand van het rooster in met scorebordtijd.
 *
 * Een goal, kaart of cue zet het rooster stil en laat de onderbroken clip daarna opnieuw
 * spelen: het rooster loopt dan achter op de klok. Zonder inhalen schuift alles op en vallen
 * de laatste vertoningen van de fase weg, zodat een sponsor minder krijgt dan hij boekte.
 * Daarom springt het rooster, zolang het achterloopt en er geen clip speelt, door de
 * scorebordpauze heen tot kort voor de volgende vertoning. Er blijft altijd
 * `MIN_VISIBLE_SCOREBOARD_SEC` scorebord staan en het rooster loopt nooit vóór op de klok.
 *
 * Geeft de roostertijd terug die deze tick geldt.
 */
export function catchUpSponsorSchedule(opts: {
  clock: { adjustedT: number };
  /** Actuele kloktijd, dezelfde waarde die `sponsorScheduleTime` kreeg. */
  rawT: number;
  /** Rooster staat stil (onderbreking of klok stil): dan niets inhalen. */
  frozen: boolean;
  hang: SponsorPhaseHangRef["current"];
  nowMs: number;
  slotMap: (string | null)[];
  /** Lengte van de tijdlijn; het rooster loopt nooit verder. */
  maxT: number;
}): number {
  const t = opts.clock.adjustedT;
  if (opts.frozen || opts.slotMap.length === 0) return t;
  /** Zolang een vertoning loopt (of net afloopt en de volgende aansluit) niets overslaan. */
  if (opts.hang) return t;
  const liveT = Math.min(opts.rawT, opts.maxT);
  if (liveT - t <= 0) return t;
  const here = Math.min(opts.slotMap.length - 1, Math.max(0, Math.floor(t)));
  if (opts.slotMap[here] != null) return t;
  const next = nextSponsorTriggerFrom(opts.slotMap, t);
  const target = next ? next.atSec - MIN_VISIBLE_SCOREBOARD_SEC : opts.maxT;
  const caughtUp = Math.min(liveT, target);
  if (caughtUp > t) opts.clock.adjustedT = caughtUp;
  return opts.clock.adjustedT;
}

function beginSponsorSpreadHang(
  hangRef: SponsorPhaseHangRef,
  sponsorId: string,
  holdSec: number,
  nowMs: number,
  slotIdx: number | undefined,
  appearanceIndex: number | null,
): void {
  hangRef.current = {
    sponsorId,
    untilMs: nowMs + holdSec * 1000,
    startedAtMs: nowMs,
    startedAtSlotIdx: slotIdx,
    lastSeenAtMs: nowMs,
    appearanceIndex,
  };
}

/**
 * De hoeveelste vertoning van deze sponsor het rooster hier start (0-based), of null zonder
 * slotmap. Hiermee kiest de speler dezelfde clip als waarmee het rooster de duur berekende.
 */
function scheduledAppearanceIndex(
  slotMap: (string | null)[] | undefined,
  sponsorId: string,
  slotT: number | undefined,
): number | null {
  if (!slotMap || slotMap.length === 0 || slotT === undefined) return null;
  return sponsorAppearanceIndexAt(slotMap, sponsorId, slotT);
}

export type ResolvedSponsorSpreadPhase = {
  phase: "scoreboard" | "sponsor";
  sponsorFilterId: string | null;
  appearanceStartedAtMs?: number | null;
  /** Index van de clip in de rotatie van deze sponsor die bij deze vertoning hoort. */
  appearanceIndex?: number | null;
};

function spreadPhaseView(
  phase: "scoreboard" | "sponsor",
  sponsorFilterId: string | null,
  appearanceStartedAtMs: number | null = null,
  appearanceIndex: number | null = null,
): ResolvedSponsorSpreadPhase {
  if (phase !== "sponsor") return { phase: "scoreboard", sponsorFilterId: null };
  return { phase: "sponsor", sponsorFilterId, appearanceStartedAtMs, appearanceIndex };
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
    /** De hoeveelste vertoning van deze sponsor dit is; bepaalt welke clip er speelt. */
    appearanceIndex?: number | null;
    /** Laatste tick waarop de duur om was maar de clip nog op het scherm stond. */
    overrunSeenAtMs?: number;
  } | null;
};

/** Hoe ver het startvenster van een vertoning voorbij mag zijn om haar toch nog te starten. */
const LATE_SPONSOR_TRIGGER_TOLERANCE_SEC = 2;

export type ResolveSponsorSpreadOptions = {
  /** Slotmap + huidige tijd `t` (zelfde eenheid als `lookupSponsorAtSecond`): cap hang per segment. */
  slotMap?: (string | null)[];
  slotT?: number;
  /**
   * Onderbreking actief (bv. doelpunt-, speler- of kaart-overlay): de hang-klok vriest in.
   * Resterende hangtijd schuift mee zodat de sponsor zijn volle clip krijgt na de overlay.
   */
  interrupted?: boolean;
  /**
   * De onderbreking vervangt het beeld (goal, kaart, wissel, cue): de speler start de
   * onderbroken clip daarna opnieuw vanaf 0:00. De vertoning begint dan ook opnieuw, met haar
   * volle duur. Staat alleen de wedstrijdklok stil, dan loopt de clip gewoon verder en schuift
   * de resterende tijd mee (uit laten).
   */
  restartsClip?: boolean;
  /**
   * Roosterklok van deze sectie. Bij `restartsClip` gaat hij terug naar het begin van de
   * onderbroken vertoning; anders is het rooster na de herhaalde clip het slot van de volgende
   * sponsor al voorbij en valt die weg.
   */
  scheduleClock?: { adjustedT: number } | null;
  /**
   * Sponsor van de clip die volgens de ledger nu op het scherm staat. Is dat de sponsor van de
   * lopende vertoning, dan eindigt die pas als de clip klaar is.
   */
  liveClipSponsorId?: string | null;
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
): ResolvedSponsorSpreadPhase {
  const slotIdx =
    options?.slotMap && options.slotT !== undefined && options.slotMap.length > 0
      ? Math.min(options.slotMap.length - 1, Math.max(0, Math.floor(options.slotT)))
      : undefined;
  const interrupted = options?.interrupted === true;

  const hang = hangRef.current;

  /**
   * Onderbreking (goal-overlay, spelervideo, kaart, wissel): de hang-klok staat stil.
   *
   * Start de clip daarna opnieuw (`restartsClip`), dan begint de vertoning ook opnieuw: volle
   * duur vanaf het einde van de onderbreking, en de roosterklok terug naar het begin van deze
   * vertoning. Zo lopen clip en rooster daarna weer gelijk. Was de vertoning al voorbij toen de
   * onderbreking begon, dan blijft ze voorbij.
   *
   * Loopt de clip gewoon verder (klok stil), dan schuift `untilMs` per tick mee met de
   * werkelijke deltatijd en blijft de resterende tijd gelijk.
   */
  if (interrupted && hang) {
    const lastSeen = hang.lastSeenAtMs ?? nowMs;
    const dt = Math.max(0, nowMs - lastSeen);
    /** Ook "duur om, clip stond nog op het scherm" telt als lopend: die clip start straks opnieuw. */
    const stillRunning = hang.untilMs > lastSeen || hang.overrunSeenAtMs === lastSeen;
    if (options?.restartsClip && stillRunning) {
      const holdMs = hang.untilMs - hang.startedAtMs;
      hang.startedAtMs = nowMs;
      hang.untilMs = nowMs + holdMs;
      if (options.scheduleClock && hang.startedAtSlotIdx !== undefined) {
        options.scheduleClock.adjustedT = Math.min(
          options.scheduleClock.adjustedT,
          hang.startedAtSlotIdx,
        );
      }
    } else if (dt > 0) {
      hang.untilMs += dt;
      hang.startedAtMs += dt;
    }
    hang.lastSeenAtMs = nowMs;
    return spreadPhaseView("sponsor", hang.sponsorId, hang.startedAtMs, hang.appearanceIndex ?? null);
  }

  if (hang && nowMs < hang.untilMs) {
    hang.lastSeenAtMs = nowMs;
    return spreadPhaseView("sponsor", hang.sponsorId, hang.startedAtMs, hang.appearanceIndex ?? null);
  }

  /**
   * De duur is om, maar de clip van deze vertoning staat nog op het scherm: hij startte een
   * fractie later dan het rooster, of het bestand is iets langer dan opgegeven. De vertoning
   * loopt tot de clip klaar is en pas dan komt de volgende. Zo loopt de speler nooit achter het
   * rooster aan: een clip die nog speelde toen het rooster al verder was, kreeg na een goal het
   * slot van de volgende sponsor, of werd opnieuw gestart.
   */
  if (hang && options?.liveClipSponsorId != null && options.liveClipSponsorId === hang.sponsorId) {
    hang.lastSeenAtMs = nowMs;
    hang.overrunSeenAtMs = nowMs;
    return spreadPhaseView("sponsor", hang.sponsorId, hang.startedAtMs, hang.appearanceIndex ?? null);
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
   * Hang net verlopen. Stond er een verplichte scorebord-tick tussen elke clip, dan
   * zag het publiek ~1 s bord — dat oogt als een flits. Start de volgende clip meteen
   * als die nu (of binnen `MIN_VISIBLE_SCOREBOARD_SEC`) gepland is.
   *
   * Zelfde slot-index + dezelfde sponsor: de klok is niet verder getikt, dus geen
   * nieuwe hang (anders herhaalt dezelfde vertoning zich).
   */
  if (hang && nowMs >= hang.untilMs) {
    const expired = hang;
    hangRef.current = null;
    const frozenSameSlot =
      slotIdx !== undefined &&
      expired.startedAtSlotIdx === slotIdx &&
      raw.sponsorId === expired.sponsorId;
    if (!frozenSameSlot) {
      let nextId: string | null = raw.phase === "sponsor" ? raw.sponsorId : null;
      let nextSlotT = options?.slotT;
      if (!nextId && options?.slotMap && options.slotT !== undefined) {
        const upcoming = nextSponsorTriggerFrom(options.slotMap, options.slotT);
        if (upcoming && upcoming.atSec - options.slotT < MIN_VISIBLE_SCOREBOARD_SEC) {
          nextId = upcoming.id;
          nextSlotT = upcoming.atSec;
        } else {
          /**
           * Liep de vorige clip uit, dan kan het startvenster van de volgende sponsor net
           * voorbij zijn. Die vertoning hoort er nog te komen: start haar nu en zet de
           * roosterklok terug naar haar slot, zodat de rest van de ronde aansluit.
           */
          const late = nextSponsorTriggerFrom(
            options.slotMap,
            Math.max(0, options.slotT - LATE_SPONSOR_TRIGGER_TOLERANCE_SEC),
          );
          if (late && late.atSec < options.slotT && late.id !== expired.sponsorId) {
            nextId = late.id;
            nextSlotT = late.atSec;
            if (options.scheduleClock) {
              options.scheduleClock.adjustedT = Math.min(options.scheduleClock.adjustedT, late.atSec);
            }
          }
        }
      }
      if (nextId) {
        const holdSec = holdSecondsCappedBySlotRun(
          sponsors,
          section,
          matchStatus,
          nextId,
          options?.slotMap,
          nextSlotT,
        );
        const appearanceIndex = scheduledAppearanceIndex(options?.slotMap, nextId, nextSlotT);
        beginSponsorSpreadHang(hangRef, nextId, holdSec, nowMs, slotIdx, appearanceIndex);
        return spreadPhaseView("sponsor", nextId, nowMs, appearanceIndex);
      }
    }
    return { phase: "scoreboard", sponsorFilterId: null };
  }

  hangRef.current = null;
  let appearanceStartedAtMs: number | null = null;
  let appearanceIndex: number | null = null;
  if (raw.phase === "sponsor" && raw.sponsorId) {
    const holdSec = holdSecondsCappedBySlotRun(
      sponsors,
      section,
      matchStatus,
      raw.sponsorId,
      options?.slotMap,
      options?.slotT,
    );
    appearanceIndex = scheduledAppearanceIndex(options?.slotMap, raw.sponsorId, options?.slotT);
    beginSponsorSpreadHang(hangRef, raw.sponsorId, holdSec, nowMs, slotIdx, appearanceIndex);
    appearanceStartedAtMs = nowMs;
  }
  const filterOut = raw.phase === "sponsor" ? raw.sponsorId : null;
  return spreadPhaseView(raw.phase, filterOut, appearanceStartedAtMs, appearanceIndex);
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
