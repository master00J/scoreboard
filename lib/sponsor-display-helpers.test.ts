import { describe, expect, it } from "vitest";
import type { Sponsor } from "./types";
import type { SponsorLedgerPayload } from "./sponsor-telemetry";
import {
  HUD_UNCONFIRMED_GRACE_MS,
  applySponsorBudgetCapToSpreadPhase,
  hudRosterPhase,
  scheduledSlotRearms,
  spreadPhaseKeepingLiveClip,
} from "./sponsor-display-helpers";

describe("hudRosterPhase", () => {
  it("volgt de ledger als het scherm de clip meldt", () => {
    expect(
      hudRosterPhase({
        predictedPhase: "scoreboard",
        predictedStartedAtMs: null,
        ledgerConfirmed: true,
        interrupted: false,
        nowMs: 10_000,
      }),
    ).toBe("sponsor");
  });

  it("houdt een verse hang aan tijdens de start-marge", () => {
    expect(
      hudRosterPhase({
        predictedPhase: "sponsor",
        predictedStartedAtMs: 8_000,
        ledgerConfirmed: false,
        interrupted: false,
        nowMs: 8_000 + HUD_UNCONFIRMED_GRACE_MS - 1,
      }),
    ).toBe("sponsor");
  });

  it("toont het scorebord als de hang niet bevestigd wordt", () => {
    expect(
      hudRosterPhase({
        predictedPhase: "sponsor",
        predictedStartedAtMs: 1_000,
        ledgerConfirmed: false,
        interrupted: false,
        nowMs: 1_000 + HUD_UNCONFIRMED_GRACE_MS,
      }),
    ).toBe("scoreboard");
  });

  it("laat een onderbreking de voorspelling staan", () => {
    expect(
      hudRosterPhase({
        predictedPhase: "sponsor",
        predictedStartedAtMs: 1_000,
        ledgerConfirmed: false,
        interrupted: true,
        nowMs: 20_000,
      }),
    ).toBe("sponsor");
  });
});

describe("applySponsorBudgetCapToSpreadPhase", () => {
  const plenty = {
    id: "plenty",
    name: "Plenty",
    active: true,
    prematchSeconds: 0,
    halftimeSeconds: 0,
    matchSeconds: 180,
    matchFirstHalfSeconds: 90,
    matchSecondHalfSeconds: 90,
    imageDefaultSec: 10,
    media: [{ id: "clip", sponsorId: "plenty", type: "VIDEO", durationSec: 25, active: true }],
  } as unknown as Sponsor;
  const view = { phase: "sponsor" as const, sponsorFilterId: "plenty" };
  const capOpts = (ledger: SponsorLedgerPayload, nowMs: number) => ({
    cycleBudgetForever: false,
    sponsors: [plenty],
    section: "match" as const,
    matchStatus: "SECOND_HALF",
    slotMap: [] as (string | null)[],
    slotT: 0,
    sponsorLedger: ledger,
    ledgerMatchesSegment: true,
    nowMs,
  });
  const ledger = (bySec: number, clipStartedAtMs: number | null): SponsorLedgerPayload => ({
    matchId: "m",
    segmentKey: "m:SECOND_HALF",
    bySponsorSec: { plenty: bySec },
    activeClip:
      clipStartedAtMs == null
        ? null
        : { sponsorId: "plenty", mediaId: "clip", startedAtMs: clipStartedAtMs, expectedPlaySec: 25, clipSessionId: "s" },
    updatedAtMs: 0,
  });

  it("laat de laatste clip uitspelen, ook als hij over het budget gaat", () => {
    // 3 × 25 s gespeeld, budget 90: de vierde clip start en staat nu 15 s (= precies 90 s) en 24 s.
    for (const elapsedMs of [15_000, 24_000]) {
      expect(applySponsorBudgetCapToSpreadPhase(view, capOpts(ledger(75, 1_000), 1_000 + elapsedMs))).toBe(view);
    }
  });

  it("start geen nieuwe clip meer als het budget op is", () => {
    expect(applySponsorBudgetCapToSpreadPhase(view, capOpts(ledger(100, null), 50_000))).toEqual({
      phase: "scoreboard",
      sponsorFilterId: null,
    });
  });
});

describe("spreadPhaseKeepingLiveClip", () => {
  it("volgt het rooster zodra dat een sponsor aanwijst, ook als er nog een clip loopt", () => {
    const roster = {
      phase: "sponsor" as const,
      sponsorFilterId: "blaklader",
      appearanceStartedAtMs: 2_000,
      appearanceIndex: 3,
    };
    expect(spreadPhaseKeepingLiveClip(roster, "port")).toBe(roster);
  });

  it("houdt de sponsorfase vast tot een lopende clip uit is als het rooster naar het scorebord wil", () => {
    expect(
      spreadPhaseKeepingLiveClip({ phase: "scoreboard", sponsorFilterId: null }, "popup"),
    ).toEqual({
      phase: "sponsor",
      sponsorFilterId: "popup",
      appearanceStartedAtMs: null,
      appearanceIndex: null,
    });
  });

  it("laat het scorebord staan als er niets loopt", () => {
    const board = { phase: "scoreboard" as const, sponsorFilterId: null };
    expect(spreadPhaseKeepingLiveClip(board, null)).toBe(board);
  });
});

describe("scheduledSlotRearms", () => {
  const slot = (sponsorId: string | null, appearanceKey: string | null) => ({ sponsorId, appearanceKey });

  it("start opnieuw bij een andere sponsor", () => {
    expect(scheduledSlotRearms(slot("port", "1000"), slot("blaklader", "2000"))).toBe(true);
  });

  it("start opnieuw bij een nieuwe vertoning van dezelfde sponsor", () => {
    expect(scheduledSlotRearms(slot("port", "1000"), slot("port", "2000"))).toBe(true);
  });

  it("start niet opnieuw zolang dezelfde vertoning loopt", () => {
    expect(scheduledSlotRearms(slot("port", "1000"), slot("port", "1000"))).toBe(false);
  });

  it("ziet een vertoning die wegvalt niet als een nieuwe", () => {
    expect(scheduledSlotRearms(slot("popup", "1000"), slot("popup", null))).toBe(false);
  });

  /**
   * De clip van Port is klaar maar nog niet afgemeld in de ledger, en het rooster staat al op
   * Blaklader. Voorheen kreeg de speler "Port, nieuwe vertoning" en speelde hij Port nog eens.
   */
  it("speelt een net afgelopen clip niet opnieuw in het slot van de volgende sponsor", () => {
    const before = slot("port", "1000");
    const roster = {
      phase: "sponsor" as const,
      sponsorFilterId: "blaklader",
      appearanceStartedAtMs: 2_000,
      appearanceIndex: 0,
    };
    const view = spreadPhaseKeepingLiveClip(roster, "port");
    const after = slot(view.sponsorFilterId, String(view.appearanceStartedAtMs));
    expect(after.sponsorId).toBe("blaklader");
    expect(scheduledSlotRearms(before, after)).toBe(true);
  });

  it("speelt de laatste clip van een ronde niet opnieuw als het rooster naar het scorebord gaat", () => {
    const before = slot("popup", "1000");
    const view = spreadPhaseKeepingLiveClip({ phase: "scoreboard", sponsorFilterId: null }, "popup");
    const after = slot(view.sponsorFilterId, view.appearanceStartedAtMs == null ? null : String(view.appearanceStartedAtMs));
    expect(after).toEqual(slot("popup", null));
    expect(scheduledSlotRearms(before, after)).toBe(false);
  });
});
