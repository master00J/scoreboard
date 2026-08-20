export type Team = {
  id: string;
  name: string;
  shortName: string;
  logoPath: string | null;
  primaryColor: string;
  secondaryColor: string;
  players?: Player[];
};

export type AppSettings = {
  homeTeamId: string | null;
  /** Standaardmedia op het display als IDLE/PREMATCH-playlist leeg is; ontbreekt = alleen thuislogo/tekst. */
  idleFallbackMediaId?: string | null;
  /** Alleen op GET /api/settings: resolved item voor display/setup (actief). */
  idleFallbackMedia?: MediaItem | null;
  /** Alleen op GET /api/settings: naam + logo van vast thuis team. */
  homeTeamBranding?: {
    name: string;
    logoPath: string | null;
    primaryColor?: string;
    secondaryColor?: string;
  } | null;
  goalIntroVideoPath: string | null;
  /** GOAL +1 gedrag: true = score + visual, false = alleen score. */
  goalVisualHomeEnabled?: boolean;
  goalVisualAwayEnabled?: boolean;
  /** Legacy DB-kolommen; niet meer gebruikt in de display-logica. */
  firstHalfScoreboardSec: number;
  firstHalfSponsorSec: number;
  halftimeScoreboardSec: number;
  halftimeSponsorSec: number;
  secondHalfScoreboardSec: number;
  secondHalfSponsorSec: number;
  /** JSON-string; zie lib/scoreboard-theme.ts */
  scoreboardThemeJson?: string | null;
  /** JSON-string; zie lib/proof-of-play-brand.ts */
  proofOfPlayBrandJson?: string | null;
  /** Logisch canvas voor stadiondisplay (default 1920×1080). Pas aan voor exotische LED-formaten. */
  displayCanvasWidth?: number;
  displayCanvasHeight?: number;
  /** Scaling-modus: 'cover' (vult, kan croppen), 'contain' (alles zichtbaar, mogelijk rand), 'exact' (1:1, pixel-perfect). */
  displayScalingMode?: "cover" | "contain" | "exact";
  /** Toon safe-zone overlay op stadiondisplay (handig tijdens setup van LED-cabinets). */
  displaySafeZoneVisible?: boolean;
  displaySafeZoneMarginPx?: number;
  /** Interfacetaal: nl | en | fr. */
  uiLocale?: "nl" | "en" | "fr";
};

export type Player = {
  id: string;
  teamId: string;
  number: number;
  firstName: string;
  lastName: string;
  position: string | null;
  photoPath: string | null;
  isCoach: boolean;
  goalMediaId: string | null;
  goalVideoPath: string | null;
  subImagePath: string | null;
  lineupVideoPath: string | null;
};

export type Match = {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: Team;
  awayTeam: Team;
  kickoffAt: string | null;
  /** Gekoppelde media voor automatische matchsponsor vóór aftrap. */
  matchSponsorMediaId?: string | null;
  matchSponsorMedia?: MediaItem | null;
  halfDurationSec: number;
  halfBreakSec: number;
  /** Sportprofiel voor regels, periodes en klokgedrag. */
  sport: import("./sports").SportType;
  currentPeriod: number;
  periodDurationSec: number;
  homeTimeouts: number;
  awayTimeouts: number;
  homeFouls: number;
  awayFouls: number;
  homeSets: number;
  awaySets: number;
  /**
   * Prematch: lengte van het herhalende sponsor-slotrooster (seconden).
   * 0 = automatisch: ongeveer de som van geplande «voor wedstrijd»-seconden per sponsor (min. 60).
   */
  prematchSpreadWindowSec?: number;
  status: string;
  homeScore: number;
  awayScore: number;
  /** Spelers op het veld (thuis); leeg tot API default of handmatige opstelling. */
  homeFieldPlayerIds?: string[];
  awayFieldPlayerIds?: string[];
  events?: MatchEvent[];
  createdAt: string;
  /** ISO-tijdstip wanneer de wedstrijd is afgesloten; null = nog open voor live. */
  closedAt?: string | null;
};

export type MatchEvent = {
  id: string;
  matchId: string;
  type: string;
  minute: number;
  addedTime: number;
  teamId: string | null;
  playerInId: string | null;
  playerOutId: string | null;
  note: string | null;
  createdAt: string;
};

export type MediaItem = {
  id: string;
  type: "VIDEO" | "IMAGE";
  path: string;
  title: string;
  durationSec: number;
  sponsorName: string | null;
  sponsorId: string | null;
  active: boolean;
  /** Alleen voor VIDEO: geluid op het stadionscherm (display). */
  playAudio?: boolean;
  /** JSON array met sponsor-fases waarvoor dit media-item mag draaien. Null/leeg = alle fases. */
  sponsorPhaseTagsJson?: string | null;
  /** Technisch item (bv. auto voor speler goalVideoPath); verborgen in Media-bibliotheek. */
  hideFromLibrary?: boolean;
  createdAt: string;
};

export type ScheduledMediaCue = {
  id: string;
  mediaId: string;
  media: MediaItem;
  /** Wedstrijdfase waarin deze cue mag afgaan, bv. FIRST_HALF of SECOND_HALF. */
  matchStatus: string;
  /** Matchklok in seconden vanaf start van die fase. */
  triggerSec: number;
  enabled: boolean;
  createdAt: string;
};

export type Sponsor = {
  id: string;
  name: string;
  active: boolean;
  prematchSeconds: number;
  /** Som 1e+2e helft (legacy); voor verdeling worden 1e/2e apart gebruikt. */
  matchSeconds: number;
  matchFirstHalfSeconds: number;
  matchSecondHalfSeconds: number;
  halftimeSeconds: number;
  /** Schermtijd na de wedstrijd (full time / post match). */
  postmatchSeconds: number;
  imageDefaultSec: number;
  /** JSON-array van media-id's: volgorde tijdens sponsorrotatie op display; null = uploadvolgorde. */
  sponsorPlaybackOrderJson?: string | null;
  /** JSON-object mediaId → aantal keer achter elkaar per doorloop van de clip-lijst (1–20). */
  sponsorPlaybackRepeatsJson?: string | null;
  createdAt: string;
  media?: MediaItem[];
};

export type SponsorSection = "prematch" | "match" | "halftime" | "postmatch";

export type PlaylistSlot =
  | "IDLE"
  | "PREMATCH"
  | "HALFTIME"
  | "POSTMATCH"
  | "GOAL";

export type Playlist = {
  id: string;
  name: string;
  slot: PlaylistSlot;
  items: PlaylistItemFull[];
};

export type PlaylistItemFull = {
  id: string;
  playlistId: string;
  mediaId: string;
  media: MediaItem;
  order: number;
  durationOverrideSec: number | null;
};
