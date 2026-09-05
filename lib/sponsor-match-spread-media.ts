import type { MediaItem, SponsorSection } from "./types";
import { mediaAllowedForSponsorPhase } from "./sponsor-media-phases";

/**
 * Sponsorclips naast het scorebord: filter alleen op wedstrijdfase-tags.
 * (Eerdere 8s-video-filter sloeg langere clips weg zodra er korte clips waren — dan
 * draaiden niet alle sponsorvideo's mee.)
 */
export function filterMediaForSponsorSpreadSection(
  media: MediaItem[],
  section: SponsorSection,
  matchStatus?: string,
): MediaItem[] {
  const phaseOk = media.filter((m) => mediaAllowedForSponsorPhase(m, section, matchStatus));
  return phaseOk;
}
