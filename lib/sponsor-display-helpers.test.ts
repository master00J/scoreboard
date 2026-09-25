import { describe, expect, it } from "vitest";
import {
  applySponsorBudgetCapToSpreadPhase,
  scoreFrameAllowed,
  shouldShowFullScreenMatchBoard,
  liveSponsorBesideVisible,
  isExclusiveFullscreenDisplayMode,
} from "./sponsor-display-helpers";
import type { SponsorLedgerPayload } from "./sponsor-telemetry";
import type { Match, Playlist, PlaylistSlot, Sponsor } from "./types";

const emptyPlaylists = {} as Record<PlaylistSlot, Playlist | null>;
const match = { status: "FIRST_HALF" } as Match;

describe("shouldShowFullScreenMatchBoard", () => {
  it("toont fullscreen bij de scorebord-modus", () => {
    expect(shouldShowFullScreenMatchBoard(match, "MATCH", [], emptyPlaylists)).toBe(true);
  });

  it("toont fullscreen in een speelhelft zonder sponsorclips", () => {
    expect(shouldShowFullScreenMatchBoard(match, "SPONSOR_ROTATION", [], emptyPlaylists)).toBe(true);
  });

  it("toont fullscreen in de scorebord-fase, L-frame alleen als er een clip speelt", () => {
    expect(
      shouldShowFullScreenMatchBoard(match, "SPONSOR_ROTATION", [], emptyPlaylists, "scoreboard"),
    ).toBe(true);
    expect(
      shouldShowFullScreenMatchBoard(match, "SPONSOR_ROTATION", [], emptyPlaylists, "sponsor"),
    ).toBe(false);
  });
});

describe("liveSponsorBesideVisible", () => {
  it("verbergt het L-frame zonder lopende clip", () => {
    expect(
      liveSponsorBesideVisible({
        mounted: true,
        phase: "scoreboard",
        interruptOverlay: false,
        previewFollowClip: false,
        scheduledCue: false,
      }),
    ).toBe(false);
  });

  it("toont het L-frame tijdens een sponsorclip of overlay", () => {
    expect(
      liveSponsorBesideVisible({
        mounted: true,
        phase: "sponsor",
        interruptOverlay: false,
        previewFollowClip: false,
        scheduledCue: false,
      }),
    ).toBe(true);
    expect(
      liveSponsorBesideVisible({
        mounted: true,
        phase: "scoreboard",
        interruptOverlay: true,
        previewFollowClip: false,
        scheduledCue: false,
      }),
    ).toBe(true);
  });

  it("verbergt het L-frame tijdens team- of spelerintro", () => {
    expect(
      liveSponsorBesideVisible({
        mounted: true,
        phase: "sponsor",
        interruptOverlay: false,
        previewFollowClip: false,
        scheduledCue: true,
        exclusiveFullscreen: true,
      }),
    ).toBe(false);
  });

  it("blijft uit als de rotatie niet gemount is", () => {
    expect(
      liveSponsorBesideVisible({
        mounted: false,
        phase: "sponsor",
        interruptOverlay: true,
        previewFollowClip: true,
        scheduledCue: true,
      }),
    ).toBe(false);
  });
});

describe("scoreFrameAllowed", () => {
  it("zet het L-frame uit in prematch zodat het full-logo niet dubbel door de balk piept", () => {
    expect(
      scoreFrameAllowed({
        mode: "SPONSOR_ROTATION",
        matchStatus: "PREMATCH",
      }),
    ).toBe(false);
  });

  it("houdt het L-frame tijdens de helft als er een paneel naast hoort", () => {
    expect(
      scoreFrameAllowed({
        mode: "SPONSOR_ROTATION",
        matchStatus: "FIRST_HALF",
      }),
    ).toBe(true);
  });

  it("zet het L-frame altijd uit bij goal-intro en spelervideo", () => {
    expect(
      scoreFrameAllowed({
        mode: "GOAL_INTRO_VIDEO",
        matchStatus: "PREMATCH",
      }),
    ).toBe(false);
    expect(
      scoreFrameAllowed({
        mode: "GOAL_INTRO_VIDEO",
        matchStatus: "FIRST_HALF",
      }),
    ).toBe(false);
    expect(
      scoreFrameAllowed({
        mode: "GOAL_PLAYER_VIDEO",
        matchStatus: "FIRST_HALF",
      }),
    ).toBe(false);
  });

  it("houdt team-intro fullscreen, ook tijdens een speelset", () => {
    expect(isExclusiveFullscreenDisplayMode("TEAM_INTRO")).toBe(true);
    expect(isExclusiveFullscreenDisplayMode("PLAYER_INTRO")).toBe(true);
    expect(
      scoreFrameAllowed({
        mode: "TEAM_INTRO",
        matchStatus: "FIRST_HALF",
      }),
    ).toBe(false);
  });
});

describe("applySponsorBudgetCapToSpreadPhase", () => {
  const capOpts = {
    sponsors: [],
    section: "match" as const,
    matchStatus: "FIRST_HALF",
    slotMap: [] as (string | null)[],
    slotT: 10,
    sponsorLedger: null,
    ledgerMatchesSegment: false,
    nowMs: 0,
  };

  it("stopt de sponsorfase als er geen budget meer is", () => {
    expect(
      applySponsorBudgetCapToSpreadPhase(
        { phase: "sponsor", sponsorFilterId: "sp-1" },
        { ...capOpts, cycleBudgetForever: false },
      ),
    ).toEqual({ phase: "scoreboard", sponsorFilterId: null });
  });

  it("blijft draaien als herhalen van het budget aan staat", () => {
    expect(
      applySponsorBudgetCapToSpreadPhase(
        { phase: "sponsor", sponsorFilterId: "sp-1" },
        { ...capOpts, cycleBudgetForever: true },
      ),
    ).toEqual({ phase: "sponsor", sponsorFilterId: "sp-1" });
  });

  describe("laatste clip van een sponsor (budget 8 s, twee beelden van 4 s)", () => {
    const sponsor = {
      id: "sp",
      name: "Sponsor",
      active: true,
      prematchSeconds: 0,
      halftimeSeconds: 8,
      matchSeconds: 0,
      imageDefaultSec: 4,
      media: [{ id: "sp-m1", type: "IMAGE", active: true, durationSec: 4, title: "sp", path: "/x/sp.png" }],
    } as Sponsor;
    const slotMap: (string | null)[] = Array(60).fill(null);
    for (const t of [12, 13, 14, 36, 37, 38]) slotMap[t] = "sp";
    const nowMs = 1_000_000;
    const opts = {
      cycleBudgetForever: false,
      sponsors: [sponsor],
      section: "halftime" as const,
      matchStatus: undefined,
      slotMap,
      /** Rooster: 4 + 3,62 = 7,62 s, afgerond 8 ⇒ zonder lopende clip "op". */
      slotT: 39.62,
      ledgerMatchesSegment: true,
      nowMs,
    };
    const ledger = (activeClip: SponsorLedgerPayload["activeClip"]): SponsorLedgerPayload => ({
      matchId: "m1",
      segmentKey: "m1:halftime",
      bySponsorSec: { sp: 4 },
      activeClip,
      updatedAtMs: nowMs,
    });
    const phase = { phase: "sponsor" as const, sponsorFilterId: "sp" };

    it("laat een lopende clip uitspelen, ook als het rooster al op budget staat", () => {
      const running = ledger({
        sponsorId: "sp",
        mediaId: "sp-m1",
        startedAtMs: nowMs - 3_620,
        expectedPlaySec: 4,
        clipSessionId: "s2",
      });
      expect(applySponsorBudgetCapToSpreadPhase(phase, { ...opts, sponsorLedger: running })).toEqual(phase);
    });

    it("start geen nieuwe clip meer als er niets loopt", () => {
      expect(applySponsorBudgetCapToSpreadPhase(phase, { ...opts, sponsorLedger: ledger(null) })).toEqual({
        phase: "scoreboard",
        sponsorFilterId: null,
      });
    });

    it("stopt zodra de lopende clip zelf het budget haalt", () => {
      const done = ledger({
        sponsorId: "sp",
        mediaId: "sp-m1",
        startedAtMs: nowMs - 4_100,
        expectedPlaySec: 4,
        clipSessionId: "s2",
      });
      expect(applySponsorBudgetCapToSpreadPhase(phase, { ...opts, sponsorLedger: done })).toEqual({
        phase: "scoreboard",
        sponsorFilterId: null,
      });
    });
  });
});
