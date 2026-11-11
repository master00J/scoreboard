import { describe, expect, it } from "vitest";
import type { MediaItem, Sponsor } from "./types";
import {
  activeSponsorsForSection,
  buildSponsorSlotMap,
  catchUpSponsorSchedule,
  lookupSponsorAtSecond,
  resolveSponsorSpreadPhase,
  sponsorRotationClipSeconds,
  sponsorSectionBudgetSeconds,
  type SponsorPhaseHangRef,
} from "./sponsor-distribution";
import {
  finalizeSponsorDistPhase,
  scheduledSlotRearms,
  type ScheduledSlotIdentity,
} from "./sponsor-display-helpers";
import { createSponsorScheduleClock, sponsorScheduleTime } from "./sponsor-schedule-clock";
import { ledgerActiveClipStillLiveForMatchSegment, type SponsorLedgerPayload } from "./sponsor-telemetry";

/**
 * De belofte aan de sponsor: minstens de geboekte schermtijd, meer mag. Deze simulatie laat een
 * hele helft lopen met dezelfde functies als het stadionscherm (roosterklok, vertoningen,
 * budgetplafond) en een speler die doet wat de echte speler doet: één clip per ingeroosterde
 * vertoning, een onderbroken clip daarna opnieuw vanaf het begin, een lopende clip nooit afkappen.
 */

const STATUS = "FIRST_HALF";
const SECTION = "match" as const;
const MATCH = { id: "m", status: STATUS };

function sponsorWith(id: string, budgetSec: number, clipSecs: number[]): Sponsor {
  return {
    id,
    name: id,
    active: true,
    prematchSeconds: 0,
    halftimeSeconds: 0,
    postmatchSeconds: 0,
    matchSeconds: budgetSec * 2,
    matchFirstHalfSeconds: budgetSec,
    matchSecondHalfSeconds: budgetSec,
    imageDefaultSec: 10,
    createdAt: "2026-01-01T00:00:00.000Z",
    media: clipSecs.map(
      (sec, i) =>
        ({
          id: `${id}-${i}`,
          sponsorId: id,
          type: "VIDEO",
          path: `/${id}-${i}.mp4`,
          title: `${id}-${i}`,
          durationSec: sec,
          active: true,
          createdAt: `2026-01-01T00:00:0${i}.000Z`,
        }) as unknown as MediaItem,
    ),
    sponsorPlaybackOrderJson: null,
    sponsorPlaybackRepeatsJson: null,
  } as unknown as Sponsor;
}

/** Zelfde verhoudingen als een echte speeldag, op een helft van 10 minuten. */
const H = 600;
const SPONSORS: Sponsor[] = [
  sponsorWith("circus", 40, [15]),
  sponsorWith("cristal", 40, [15]),
  sponsorWith("munro", 40, [10, 30]),
  sponsorWith("port", 20, [10]),
  sponsorWith("stanno", 40, [15]),
  sponsorWith("blaklader", 20, [15]),
  sponsorWith("plenty", 20, [25]),
  sponsorWith("vanmossel", 40, [14]),
  sponsorWith("zimmer", 20, [15, 15, 10, 15]),
  sponsorWith("popup", 70, [15]),
];

type Interruption = { fromSec: number; toSec: number };

function simulateHalf(opts: { interruptions: Interruption[]; endSec: number }) {
  const sponsors = SPONSORS;
  const active = activeSponsorsForSection(sponsors, SECTION, STATUS);
  const slotMap = buildSponsorSlotMap(active, SECTION, H, STATUS);
  const clockRef = { current: createSponsorScheduleClock() };
  const hangRef: SponsorPhaseHangRef = { current: null };
  const ledger: SponsorLedgerPayload = {
    matchId: MATCH.id,
    segmentKey: `${MATCH.id}:${STATUS}`,
    bySponsorSec: {},
    activeClip: null,
    updatedAtMs: 0,
  };
  const fullShowings: Record<string, number> = {};
  const cutShort: string[] = [];
  const order: string[] = [];

  type Clip = { sponsorId: string; startMs: number; durSec: number; restartPending: boolean };
  const player: { clip: Clip | null; completed: string | null; slot: ScheduledSlotIdentity } = {
    clip: null,
    completed: null,
    slot: { sponsorId: null, appearanceKey: null },
  };
  const TICK = 250;
  /** Een clip staat iets later op het scherm dan het rooster hem start, en loopt dus ook iets uit. */
  const CLIP_START_LATENCY_MS = 500;

  const bill = (sponsorId: string, sec: number) => {
    ledger.bySponsorSec[sponsorId] = (ledger.bySponsorSec[sponsorId] ?? 0) + Math.max(0, sec);
  };
  const startClip = (sponsorId: string, durSec: number, ms: number) => {
    player.clip = { sponsorId, startMs: ms, durSec, restartPending: false };
    ledger.activeClip = {
      sponsorId,
      mediaId: `${sponsorId}-clip`,
      startedAtMs: ms,
      expectedPlaySec: durSec,
      clipSessionId: `${sponsorId}-${ms}`,
    };
  };

  for (let ms = 0; ms <= opts.endSec * 1000; ms += TICK) {
    const sec = ms / 1000;
    const interrupted = opts.interruptions.some((i) => sec >= i.fromSec && sec < i.toSec);

    // Het rooster, tick voor tick zoals op het scherm.
    sponsorScheduleTime(clockRef, "half", sec, interrupted, H);
    const t = catchUpSponsorSchedule({
      clock: clockRef.current,
      rawT: sec,
      frozen: interrupted,
      hang: hangRef.current,
      nowMs: ms,
      slotMap,
      maxT: H,
    });
    const base = resolveSponsorSpreadPhase(lookupSponsorAtSecond(slotMap, t), sponsors, SECTION, STATUS, ms, hangRef, {
      slotMap,
      slotT: t,
      interrupted,
      restartsClip: interrupted,
      scheduleClock: clockRef.current,
      liveClipSponsorId: ledgerActiveClipStillLiveForMatchSegment(MATCH, SECTION, ledger, ms)?.sponsorId ?? null,
    });
    const view = finalizeSponsorDistPhase(
      MATCH,
      SECTION,
      STATUS,
      ledger,
      base,
      hangRef,
      slotMap,
      t,
      sponsors,
      false,
      ms,
      interrupted,
    );

    // De speler.
    const filter = view.phase === "sponsor" ? view.sponsorFilterId : null;
    const key = view.appearanceStartedAtMs != null ? String(view.appearanceStartedAtMs) : null;
    const nextSlot = { sponsorId: filter, appearanceKey: key };
    if (scheduledSlotRearms(player.slot, nextSlot)) player.completed = null;
    player.slot = nextSlot;

    if (interrupted) {
      // Het beeld is vervangen: het getoonde deel wordt geboekt, de clip start straks opnieuw.
      const clip = player.clip;
      if (clip && !clip.restartPending) {
        bill(clip.sponsorId, Math.min(clip.durSec, (ms - clip.startMs) / 1000));
        ledger.activeClip = null;
        clip.restartPending = true;
      }
      continue;
    }
    if (player.clip?.restartPending) {
      if (view.phase === "sponsor") {
        startClip(player.clip.sponsorId, player.clip.durSec, ms);
      } else {
        // Het getoonde deel bracht de sponsor al op zijn budget: de clip komt niet terug.
        player.clip = null;
      }
    }

    if (player.clip && view.phase !== "sponsor") {
      // De sponsorlaag verdwijnt terwijl er nog een clip loopt: afgekapt.
      cutShort.push(`${player.clip.sponsorId}@${sec}`);
      bill(player.clip.sponsorId, Math.min(player.clip.durSec, (ms - player.clip.startMs) / 1000));
      ledger.activeClip = null;
      player.clip = null;
    }
    if (player.clip && ms >= player.clip.startMs + player.clip.durSec * 1000 + CLIP_START_LATENCY_MS) {
      const done = player.clip;
      bill(done.sponsorId, done.durSec);
      fullShowings[done.sponsorId] = (fullShowings[done.sponsorId] ?? 0) + 1;
      order.push(done.sponsorId);
      ledger.activeClip = null;
      if (filter === done.sponsorId) player.completed = done.sponsorId;
      player.clip = null;
    }
    if (!player.clip && filter && player.completed !== filter) {
      const s = sponsors.find((x) => x.id === filter)!;
      const clips = sponsorRotationClipSeconds(s, SECTION, STATUS);
      const idx = view.appearanceIndex ?? 0;
      startClip(filter, clips[idx % clips.length]!, ms);
    }
  }

  const perSponsor = active.map((s) => ({
    id: s.id,
    budget: sponsorSectionBudgetSeconds(s, SECTION, STATUS),
    shown: Math.round(ledger.bySponsorSec[s.id] ?? 0),
    full: fullShowings[s.id] ?? 0,
  }));
  return { perSponsor, cutShort, order, slotMap };
}

function plannedOrder(slotMap: (string | null)[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < slotMap.length; i++) {
    const id = slotMap[i];
    if (id != null && (i === 0 || slotMap[i - 1] !== id)) out.push(id);
  }
  return out;
}

function expectEveryoneGetsTheirBudget(result: ReturnType<typeof simulateHalf>) {
  expect(result.cutShort).toEqual([]);
  for (const s of result.perSponsor) {
    expect(s.shown, `${s.id}: ${s.shown}s getoond, ${s.budget}s geboekt`).toBeGreaterThanOrEqual(s.budget);
  }
}

/**
 * Elke geplande vertoning is er, in roostervolgorde. Eén uitzondering: een sponsor die door een
 * onderbroken (en dus dubbel getoonde) clip al op zijn budget zit, krijgt geen nieuwe clip meer.
 */
function expectPlannedOrder(result: ReturnType<typeof simulateHalf>) {
  const planned = plannedOrder(result.slotMap);
  const reachedBudget = new Set(result.perSponsor.filter((s) => s.shown >= s.budget).map((s) => s.id));
  let j = 0;
  for (let i = 0; i < planned.length; i++) {
    if (result.order[j] === planned[i]) {
      j++;
      continue;
    }
    expect(
      reachedBudget.has(planned[i]!),
      `vertoning ${i + 1} van ${planned.length}: rooster [${planned.slice(Math.max(0, i - 1), i + 3).join(", ")}], scherm [${result.order
        .slice(Math.max(0, j - 1), j + 3)
        .join(", ")}]`,
    ).toBe(true);
  }
  expect(result.order.slice(j), "clips buiten het rooster").toEqual([]);
}

describe("sponsor krijgt minstens zijn geboekte schermtijd", { timeout: 120_000 }, () => {
  it("zonder onderbrekingen: iedereen zijn budget, in roostervolgorde, geen clip afgekapt", () => {
    const result = simulateHalf({ interruptions: [], endSec: H + 5 });
    expectEveryoneGetsTheirBudget(result);
    expectPlannedOrder(result);
    // Een clip die over het budget gaat speelt helemaal uit: Plenty boekt 20 s en krijgt 25 s.
    expect(result.perSponsor.find((s) => s.id === "plenty")).toMatchObject({ shown: 25, full: 1 });
  });

  it("met goals midden in een clip, in een scorebordpauze en vlak voor het einde", () => {
    const quiet = simulateHalf({ interruptions: [], endSec: H + 5 });
    const firstStart = quiet.slotMap.findIndex((id) => id != null);
    const result = simulateHalf({
      interruptions: [
        { fromSec: firstStart + 9.5, toSec: firstStart + 29.5 }, // midden in de eerste clip
        { fromSec: firstStart + 20 + 62, toSec: firstStart + 20 + 71 }, // kort daarna nog een
        { fromSec: 300, toSec: 322 },
        { fromSec: 455, toSec: 480 },
      ],
      endSec: H + 5,
    });
    expectEveryoneGetsTheirBudget(result);
    // Niemand valt weg: elke geplande vertoning is er, in dezelfde volgorde.
    expectPlannedOrder(result);
  });

  it("haalt achterstand in met scorebordtijd, ook als de helft op de seconde eindigt", () => {
    // Drie goals van 20 s vroeg in de helft: een minuut achterstand plus de herhaalde clips.
    // Zonder inhalen vallen de laatste vertoningen buiten de helft.
    const result = simulateHalf({
      interruptions: [
        { fromSec: 40, toSec: 60 },
        { fromSec: 110, toSec: 130 },
        { fromSec: 180, toSec: 200 },
      ],
      endSec: H,
    });
    expectEveryoneGetsTheirBudget(result);
    expectPlannedOrder(result);
  });

  it("verliest niemand als de goal valt terwijl een clip net uitloopt", () => {
    // De clip staat een fractie later op het scherm dan het rooster hem start en loopt dus even
    // door nadat zijn roostertijd om is. Valt de goal precies dan, dan hoort die clip opnieuw
    // te spelen en de volgende sponsor daarna gewoon zijn slot te krijgen.
    const quiet = simulateHalf({ interruptions: [], endSec: H + 5 });
    const firstStart = quiet.slotMap.findIndex((id) => id != null);
    const result = simulateHalf({
      interruptions: [{ fromSec: firstStart + 15.25, toSec: firstStart + 35 }],
      endSec: H + 5,
    });
    expectEveryoneGetsTheirBudget(result);
    expectPlannedOrder(result);
  });

  it("haalt een goal vlak voor het einde van de helft in tijdens de blessuretijd", () => {
    const result = simulateHalf({
      interruptions: [{ fromSec: H - 40, toSec: H - 15 }],
      endSec: H + 90,
    });
    expectEveryoneGetsTheirBudget(result);
  });

  it("blijft overeind bij willekeurige onderbrekingen", () => {
    // Vaste reeks, zodat een fout altijd dezelfde is.
    let seed = 20261111;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let run = 0; run < 6; run++) {
      const interruptions: Interruption[] = [];
      let at = 20 + rnd() * 60;
      while (at < H - 60 && interruptions.length < 4) {
        const len = 6 + rnd() * 20;
        interruptions.push({ fromSec: at, toSec: at + len });
        at += len + 50 + rnd() * 120;
      }
      const result = simulateHalf({ interruptions, endSec: H + 60 });
      expectEveryoneGetsTheirBudget(result);
    }
  });
});
