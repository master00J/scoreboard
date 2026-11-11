import type { Match, Playlist, PlaylistSlot, Sponsor, SponsorSection } from "./types";
import {
  activeSponsorsForSection,
  sponsorScreenSecondsConsumed,
  sponsorSectionBudgetSeconds,
  type SponsorBudgetResolver,
} from "./sponsor-distribution";
import { mediaAllowedForSponsorPhase } from "./sponsor-media-phases";
import type { SponsorLedgerPayload } from "./sponsor-telemetry";
import {
  ledgerActiveClipStillLiveForMatchSegment,
  sponsorLedgerMatchesSegment,
  sponsorTelemetryActiveClipStillLive,
  sponsorTelemetryConsumedSec,
} from "./sponsor-telemetry";

export type SponsorSpreadPhaseView = {
  phase: "scoreboard" | "sponsor";
  sponsorFilterId: string | null;
  /** Wisselt per vertoning, ook bij dezelfde sponsor. */
  appearanceStartedAtMs?: number | null;
  /** Index van de clip in de rotatie van deze sponsor die bij deze vertoning hoort. */
  appearanceIndex?: number | null;
};

/**
 * Loopt er volgens de ledger nog een clip terwijl het rooster naar het scorebord wil, dan
 * blijft de sponsorfase staan tot die clip uit is; anders verdwijnt het mediavak onder de
 * laatste beelden vandaan.
 *
 * Wijst het rooster zelf een sponsor aan, dan volgt die. Voorheen kreeg de speler dan de
 * sponsor van de lopende clip met het startmoment van de nieuwe vertoning. Was die clip net
 * klaar maar nog niet afgemeld, dan zag de speler "nieuwe vertoning van dezelfde sponsor" en
 * speelde hij hem een tweede keer, in het slot van de volgende sponsor; de rest van de ronde
 * schoof een clip op.
 */
export function spreadPhaseKeepingLiveClip(
  base: SponsorSpreadPhaseView,
  liveClipSponsorId: string | null | undefined,
): SponsorSpreadPhaseView {
  if (base.phase === "sponsor" || !liveClipSponsorId) return base;
  return {
    phase: "sponsor",
    sponsorFilterId: liveClipSponsorId,
    appearanceStartedAtMs: null,
    appearanceIndex: null,
  };
}

/**
 * Maakt van de roosterfase de fase die het scherm toont: eerst het budgetplafond op de sponsor
 * die het rooster aanwijst, daarna het uitspelen van een clip die nog loopt. Display en
 * sponsor-HUD gebruiken dezelfde regels; de simulatie in de tests ook.
 */
export function finalizeSponsorDistPhase(
  match: { id: string; status?: string },
  section: SponsorSection,
  matchStatus: string | undefined,
  sponsorLedger: SponsorLedgerPayload | null,
  base: SponsorSpreadPhaseView,
  hangRef: { current: unknown },
  slotMap: (string | null)[],
  slotT: number,
  sponsors: Sponsor[],
  cycleBudgetForever: boolean,
  nowMs: number,
  /** Quick button / goal / cue: hang niet wissen, anders hervat de clip niet. */
  freezeBudgetCap: boolean,
  budgetOf?: SponsorBudgetResolver,
): SponsorSpreadPhaseView {
  const liveClipSponsorId = sponsorLedger
    ? (ledgerActiveClipStillLiveForMatchSegment(match, section, sponsorLedger, nowMs)?.sponsorId ?? null)
    : null;
  if (freezeBudgetCap) return spreadPhaseKeepingLiveClip(base, liveClipSponsorId);
  const capOpts = {
    cycleBudgetForever,
    sponsors,
    section,
    matchStatus,
    slotMap,
    slotT,
    sponsorLedger,
    ledgerMatchesSegment: sponsorLedgerMatchesSegment(match, section, sponsorLedger),
    nowMs,
    budgetOf,
  };
  /** Eerst de sponsor die het rooster aanwijst tegen zijn budget; die bepaalt wat er start. */
  let capped = applySponsorBudgetCapToSpreadPhase(base, capOpts);
  if (capped.phase === "scoreboard") {
    hangRef.current = null;
    /** Het rooster is door, maar een clip die nog loopt speelt uit (en telt tegen zijn eigen budget). */
    const kept = spreadPhaseKeepingLiveClip(capped, liveClipSponsorId);
    if (kept.phase === "sponsor") capped = applySponsorBudgetCapToSpreadPhase(kept, capOpts);
  }
  if (capped.phase === "sponsor") {
    const started =
      (hangRef.current as { startedAtMs?: number } | null)?.startedAtMs ??
      capped.appearanceStartedAtMs ??
      null;
    return { ...capped, appearanceStartedAtMs: started };
  }
  return capped;
}

export type ScheduledSlotIdentity = {
  sponsorId: string | null;
  /** Startmoment van de ingeroosterde vertoning; null als het rooster er geen aanwijst. */
  appearanceKey: string | null;
};

/**
 * In een ingeroosterd slot speelt de speler één clip en wacht dan. Hij mag opnieuw starten bij
 * een andere sponsor, of bij een nieuwe vertoning van dezelfde sponsor. Een vertoning die
 * wegvalt (sleutel wordt null: het rooster is door, alleen de lopende clip houdt de fase nog
 * vast) is geen nieuwe vertoning.
 */
export function scheduledSlotRearms(prev: ScheduledSlotIdentity, next: ScheduledSlotIdentity): boolean {
  if (next.sponsorId !== prev.sponsorId) return true;
  return next.appearanceKey != null && next.appearanceKey !== prev.appearanceKey;
}

/**
 * HUD mag “Bezig / Café Lawijt” alleen tonen als het stadionscherm de clip meldt.
 * Het eigen rooster loopt soms voor (hang start, LED nog scorebord) — na een korte
 * start-marge volgen we de ledger, niet de voorspelling.
 */
export const HUD_UNCONFIRMED_GRACE_MS = 2500;

export function hudRosterPhase(opts: {
  predictedPhase: "scoreboard" | "sponsor";
  predictedStartedAtMs: number | null | undefined;
  ledgerConfirmed: boolean;
  interrupted: boolean;
  nowMs: number;
}): "scoreboard" | "sponsor" {
  if (opts.interrupted) return opts.predictedPhase;
  if (opts.ledgerConfirmed) return "sponsor";
  if (opts.predictedPhase !== "sponsor") return "scoreboard";
  const started = opts.predictedStartedAtMs;
  if (
    started != null &&
    opts.nowMs - started >= 0 &&
    opts.nowMs - started < HUD_UNCONFIRMED_GRACE_MS
  ) {
    return "sponsor";
  }
  return "scoreboard";
}

/** Eerste/tweede helft / verlenging: sponsor-slides naast scorebord; rust en voor/na: fullscreen. */
export function sponsorRotationBesideScoreboard(status: string | undefined): boolean {
  return (
    status === "FIRST_HALF" ||
    status === "SECOND_HALF" ||
    status === "EXTRA_TIME"
  );
}

export function sectionForStatus(status: string | undefined): SponsorSection {
  if (!status) return "prematch";
  if (status === "HALF_TIME") return "halftime";
  if (status === "FIRST_HALF" || status === "SECOND_HALF" || status === "EXTRA_TIME") {
    return "match";
  }
  if (status === "FULL_TIME" || status === "POST_MATCH") return "postmatch";
  if (status === "PREMATCH" || status === "SETUP") return "prematch";
  return "prematch";
}

export function hasSponsorsForSection(
  sponsors: Sponsor[],
  section: SponsorSection,
  matchStatus?: string,
): boolean {
  return activeSponsorsForSection(sponsors, section, matchStatus).length > 0;
}

/**
 * Prematch-sponsors en de PREMATCH-playlist horen bij een geladen wedstrijd.
 * Op leeg IDLE (geen wedstrijd) mogen ze niet automatisch starten.
 */
export function idleMayPlayPrematchSponsors<T>(
  match: T | null | undefined,
): match is T {
  return match != null;
}

/** Tijdens speelhelft naast scorebord: is er sponsor-budget of playlist-media om te tonen? */
export function sponsorBesideShowsPanel(
  match: Match,
  sponsors: Sponsor[],
  playlists: Record<PlaylistSlot, Playlist | null>,
  hasBudgetSponsors?: boolean,
): boolean {
  if (!sponsorRotationBesideScoreboard(match.status)) return false;
  const section = sectionForStatus(match.status);
  const hasBudget =
    hasBudgetSponsors ?? hasSponsorsForSection(sponsors, section, match.status);
  if (hasBudget) return true;
  const pl = playlists.PREMATCH ?? playlists.IDLE;
  return pl?.items?.some((i) => i.media.active) ?? false;
}

/** Rust: sponsor-budget of rust-playlist om live cyclus fullscreen te tonen. */
export function sponsorHalftimeShowsPanel(
  match: Match,
  sponsors: Sponsor[],
  playlists: Record<PlaylistSlot, Playlist | null>,
  hasBudgetSponsors?: boolean,
): boolean {
  if (match.status !== "HALF_TIME") return false;
  const hasBudget = hasBudgetSponsors ?? hasSponsorsForSection(sponsors, "halftime");
  if (hasBudget) return true;
  const pl = playlists.HALFTIME ?? playlists.IDLE;
  return pl?.items?.some((i) => i.media.active) ?? false;
}

const SCORE_FRAME_EXCLUSIVE_FULLSCREEN = new Set([
  "TEAM_INTRO",
  "PLAYER_INTRO",
  "HALFTIME",
  "FULLTIME",
  "SUBSTITUTION",
  "BLACKOUT",
  "IDLE",
  "GOAL_INTRO_VIDEO",
  "GOAL_PLAYER_VIDEO",
]);

/** Team-/spelerintro en andere fullscreen-modi mogen niet onder de live L-balk verdwijnen. */
export function isExclusiveFullscreenDisplayMode(mode: string): boolean {
  return SCORE_FRAME_EXCLUSIVE_FULLSCREEN.has(mode);
}

/**
 * L-balk / strip / custom-frame alleen als er écht een paneel naast hoort.
 * Anders ligt een leeg zwart gat over fullscreen sponsors of goal-video,
 * en piept het full-scorebord-logo door de L-kolom (dubbel logo).
 */
export function scoreFrameAllowed(opts: {
  mode: string;
  matchStatus?: string;
  previewForcesSponsorBeside?: boolean;
}): boolean {
  if (SCORE_FRAME_EXCLUSIVE_FULLSCREEN.has(opts.mode)) return false;
  if (
    opts.mode === "SPONSOR_ROTATION" &&
    !sponsorRotationBesideScoreboard(opts.matchStatus) &&
    !opts.previewForcesSponsorBeside
  ) {
    return false;
  }
  if (opts.mode === "SPONSOR" && !sponsorRotationBesideScoreboard(opts.matchStatus)) {
    return false;
  }
  return true;
}

export function shouldShowFullScreenMatchBoard(
  match: Match,
  mode: string,
  sponsors: Sponsor[],
  playlists: Record<PlaylistSlot, Playlist | null>,
  sponsorPhase?: "sponsor" | "scoreboard",
): boolean {
  if (mode === "MATCH") return true;
  if (mode === "SPONSOR_ROTATION" && sponsorRotationBesideScoreboard(match.status)) {
    if (sponsorPhase === "scoreboard") return true;
    if (sponsorPhase === "sponsor") return false;
    if (!sponsorBesideShowsPanel(match, sponsors, playlists)) return true;
  }
  return false;
}

/**
 * L-frame met sponsor/media alleen zichtbaar als er nu een clip of overlay is.
 * Anders het volledige scorebord — niet een leeg mediavak naast de L-kolom.
 */
export function liveSponsorBesideVisible(opts: {
  mounted: boolean;
  phase: "scoreboard" | "sponsor";
  interruptOverlay: boolean;
  previewFollowClip: boolean;
  scheduledCue: boolean;
  exclusiveFullscreen?: boolean;
}): boolean {
  if (!opts.mounted) return false;
  if (opts.exclusiveFullscreen) return false;
  if (opts.interruptOverlay || opts.previewFollowClip || opts.scheduledCue) return true;
  return opts.phase === "sponsor";
}

export function pickSponsorPlaylist(
  playlists: Record<PlaylistSlot, Playlist | null>,
  status: string | undefined,
): Playlist | null {
  if (status === "HALF_TIME") return playlists.HALFTIME ?? playlists.IDLE;
  if (status === "FULL_TIME" || status === "POST_MATCH") {
    return playlists.POSTMATCH ?? playlists.IDLE;
  }
  if (status === "PREMATCH" || status === "SETUP") {
    return playlists.PREMATCH ?? playlists.IDLE;
  }
  return playlists.IDLE;
}

/** Seconden tot het eerstvolgende niet-null slot na `t` (helft-/rust-tijdlijn). */
export function secondsUntilNextSponsorSlot(map: (string | null)[], t: number): number | null {
  if (map.length === 0) return null;
  let j = Math.floor(t) + 1;
  while (j < map.length) {
    if (map[j] != null) return Math.max(0, j - t);
    j++;
  }
  return null;
}

/**
 * True wanneer elke actieve sponsor in deze sectie zijn volledige schermbudget heeft
 * verbruikt (max van slot-rooster en telemetry, gelijk aan Sponsors live). De virtuele
 * slotmap kan dan nog slots tonen, maar er is geen echte volgende sponsor meer op basis
 * van budget — dan moet de HUD geen misleidende “volgende sponsor over X s” aftellen.
 */
export function allActiveSponsorSectionBudgetsExhausted(
  sponsors: Sponsor[],
  section: SponsorSection,
  matchStatus: string | undefined,
  slotMap: (string | null)[],
  slotT: number,
  sponsorLedger: SponsorLedgerPayload | null | undefined,
  ledgerMatchesSegment: boolean,
  nowMs: number,
  budgetOf?: SponsorBudgetResolver,
): boolean {
  const budgetFn =
    budgetOf ?? ((s: Sponsor) => sponsorSectionBudgetSeconds(s, section, matchStatus));
  const active = sponsors.filter(
    (s) =>
      s.active &&
      budgetFn(s) > 0 &&
      (s.media?.some((m) => m.active && mediaAllowedForSponsorPhase(m, section, matchStatus)) ?? false),
  );
  if (active.length === 0) return true;

  for (const sponsor of active) {
    const budget = budgetFn(sponsor);
    const consumed = sponsorConsumedForBudgetCap(sponsor.id, {
      sponsors,
      section,
      matchStatus,
      slotMap,
      slotT,
      sponsorLedger,
      ledgerMatchesSegment,
      nowMs,
    });
    if (consumed < budget) return false;
  }
  return true;
}

/**
 * Verbruik waarop het budgetplafond beslist: max van slotrooster en telemetry. Loopt er
 * volgens de ledger nog een clip van deze sponsor, dan telt alleen de telemetry. Het
 * slotrooster is een projectie die vóórloopt op het scherm (slots starten op hele
 * seconden, het display pas bij de volgende tick) en op hele seconden afrondt; zo kapte
 * het plafond de laatste clip van een sponsor tot ~0,5 s te vroeg af. In de rust bleef
 * die clip daarna gepauzeerd als "bezig" in de ledger staan en blokkeerde hij de
 * volgende slots. Een lopende clip speelt dus altijd uit; nieuwe clips stoppen wel.
 */
function sponsorConsumedForBudgetCap(
  sponsorId: string,
  opts: {
    sponsors: Sponsor[];
    section: SponsorSection;
    matchStatus: string | undefined;
    slotMap: (string | null)[];
    slotT: number;
    sponsorLedger: SponsorLedgerPayload | null | undefined;
    ledgerMatchesSegment: boolean;
    nowMs: number;
  },
): number {
  const consumedSlot = sponsorScreenSecondsConsumed(
    opts.slotMap,
    opts.sponsors,
    opts.section,
    opts.matchStatus,
    opts.slotT,
    sponsorId,
  );
  const ledger = opts.ledgerMatchesSegment ? opts.sponsorLedger : null;
  if (!ledger) return consumedSlot;
  const ac = ledger.activeClip;
  if (ac && ac.sponsorId === sponsorId && sponsorTelemetryActiveClipStillLive(ac, opts.nowMs)) {
    /**
     * De lopende clip telt pas mee als hij klaar is. Het rooster start een clip zolang er
     * budget over is en laat die helemaal uitspelen, ook over het budget heen. Telde het
     * lopende deel hier al mee, dan haalde het plafond een clip van 25 s met nog 15 s budget
     * na 15 s van het scherm.
     */
    return ledger.bySponsorSec[sponsorId] ?? 0;
  }
  return Math.max(consumedSlot, sponsorTelemetryConsumedSec(ledger, sponsorId, opts.nowMs));
}

/**
 * HUD én LED: als het geplande schermbudget op is (en we niet oneindig herhalen),
 * geen nieuwe sponsorclips meer — ook niet als de slotmap of ledger nog een hang toont.
 */
export function applySponsorBudgetCapToSpreadPhase(
  base: SponsorSpreadPhaseView,
  opts: {
    cycleBudgetForever: boolean;
    sponsors: Sponsor[];
    section: SponsorSection;
    matchStatus: string | undefined;
    slotMap: (string | null)[];
    slotT: number;
    sponsorLedger: SponsorLedgerPayload | null | undefined;
    ledgerMatchesSegment: boolean;
    nowMs: number;
    budgetOf?: SponsorBudgetResolver;
  },
): SponsorSpreadPhaseView {
  if (opts.cycleBudgetForever) return base;
  if (
    allActiveSponsorSectionBudgetsExhausted(
      opts.sponsors,
      opts.section,
      opts.matchStatus,
      opts.slotMap,
      opts.slotT,
      opts.sponsorLedger,
      opts.ledgerMatchesSegment,
      opts.nowMs,
      opts.budgetOf,
    )
  ) {
    return { phase: "scoreboard", sponsorFilterId: null };
  }
  if (base.phase !== "sponsor" || !base.sponsorFilterId) return base;
  const sponsor = opts.sponsors.find((s) => s.id === base.sponsorFilterId);
  if (!sponsor) return base;
  const budget = opts.budgetOf
    ? opts.budgetOf(sponsor)
    : sponsorSectionBudgetSeconds(sponsor, opts.section, opts.matchStatus);
  if (budget > 0 && sponsorConsumedForBudgetCap(sponsor.id, opts) >= budget) {
    return { phase: "scoreboard", sponsorFilterId: null };
  }
  return base;
}
