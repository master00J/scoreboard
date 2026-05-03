import type { Match, Playlist, PlaylistSlot, Sponsor, SponsorSection } from "./types";
import { activeSponsorsForSection } from "./sponsor-distribution";

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

/** Tijdens speelhelft naast scorebord: is er sponsor-budget of playlist-media om te tonen? */
export function sponsorBesideShowsPanel(
  match: Match,
  sponsors: Sponsor[],
  playlists: Record<PlaylistSlot, Playlist | null>,
): boolean {
  if (!sponsorRotationBesideScoreboard(match.status)) return false;
  const section = sectionForStatus(match.status);
  if (hasSponsorsForSection(sponsors, section, match.status)) return true;
  const pl = playlists.PREMATCH ?? playlists.IDLE;
  return pl?.items?.some((i) => i.media.active) ?? false;
}

/** Rust: sponsor-budget of rust-playlist om live cyclus fullscreen te tonen. */
export function sponsorHalftimeShowsPanel(
  match: Match,
  sponsors: Sponsor[],
  playlists: Record<PlaylistSlot, Playlist | null>,
): boolean {
  if (match.status !== "HALF_TIME") return false;
  if (hasSponsorsForSection(sponsors, "halftime")) return true;
  const pl = playlists.HALFTIME ?? playlists.IDLE;
  return pl?.items?.some((i) => i.media.active) ?? false;
}

export function shouldShowFullScreenMatchBoard(
  match: Match,
  mode: string,
  sponsors: Sponsor[],
  playlists: Record<PlaylistSlot, Playlist | null>,
): boolean {
  if (mode === "MATCH") return true;
  if (
    mode === "SPONSOR_ROTATION" &&
    sponsorRotationBesideScoreboard(match.status) &&
    !sponsorBesideShowsPanel(match, sponsors, playlists)
  ) {
    return true;
  }
  return false;
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
