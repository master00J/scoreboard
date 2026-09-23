import type { Match, Playlist, PlaylistSlot, Sponsor, SponsorSection } from "./types";
import {
  activeSponsorsForSection,
  sponsorScreenSecondsConsumed,
  sponsorSectionBudgetSeconds,
  type SponsorBudgetResolver,
} from "./sponsor-distribution";
import { mediaAllowedForSponsorPhase } from "./sponsor-media-phases";
import type { SponsorLedgerPayload } from "./sponsor-telemetry";
import { sponsorTelemetryConsumedSec } from "./sponsor-telemetry";

export type SponsorSpreadPhaseView = {
  phase: "scoreboard" | "sponsor";
  sponsorFilterId: string | null;
};

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
    const consumedSlot = sponsorScreenSecondsConsumed(
      slotMap,
      sponsors,
      section,
      matchStatus,
      slotT,
      sponsor.id,
    );
    const consumedTelem =
      ledgerMatchesSegment && sponsorLedger
        ? sponsorTelemetryConsumedSec(sponsorLedger, sponsor.id, nowMs)
        : consumedSlot;
    const consumed = Math.max(consumedSlot, consumedTelem);
    if (consumed < budget) return false;
  }
  return true;
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
  const consumedSlot = sponsorScreenSecondsConsumed(
    opts.slotMap,
    opts.sponsors,
    opts.section,
    opts.matchStatus,
    opts.slotT,
    sponsor.id,
  );
  const consumedTelem =
    opts.ledgerMatchesSegment && opts.sponsorLedger
      ? sponsorTelemetryConsumedSec(opts.sponsorLedger, sponsor.id, opts.nowMs)
      : consumedSlot;
  if (budget > 0 && Math.max(consumedSlot, consumedTelem) >= budget) {
    return { phase: "scoreboard", sponsorFilterId: null };
  }
  return base;
}
