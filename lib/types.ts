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
  goalIntroVideoPath: string | null;
  /** Legacy DB-kolommen; niet meer gebruikt in de display-logica. */
  firstHalfScoreboardSec: number;
  firstHalfSponsorSec: number;
  halftimeScoreboardSec: number;
  halftimeSponsorSec: number;
  secondHalfScoreboardSec: number;
  secondHalfSponsorSec: number;
  /** JSON-string; zie lib/scoreboard-theme.ts */
  scoreboardThemeJson?: string | null;
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
  status: string;
  homeScore: number;
  awayScore: number;
  /** Spelers op het veld (thuis); leeg tot API default of handmatige opstelling. */
  homeFieldPlayerIds?: string[];
  awayFieldPlayerIds?: string[];
  events?: MatchEvent[];
  createdAt: string;
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
  imageDefaultSec: number;
  createdAt: string;
  media?: MediaItem[];
};

export type SponsorSection = "prematch" | "match" | "halftime";

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
