import { mediaUrl } from "./media-url";
import type { MediaItem } from "./types";

export type StreamOverlayClip = {
  id: string;
  src: string;
  title: string;
  type: MediaItem["type"];
  durationSec: number;
};

/** Display-modi die een losse clip tonen i.p.v. de sponsorrotatie. */
export function streamShowsDisplayClip(mode: string | undefined): boolean {
  return mode === "GOAL_INTRO_VIDEO" || mode === "GOAL_PLAYER_VIDEO" || mode === "SPONSOR";
}

function toClip(media: MediaItem): StreamOverlayClip | null {
  if (!media.path) return null;
  return {
    id: media.id,
    src: mediaUrl(media.path),
    title: media.title,
    type: media.type,
    durationSec: Math.max(1, media.durationSec || (media.type === "VIDEO" ? 30 : 8)),
  };
}

/** Geplande cue wint van een LED-clip (goal/speler/losse media). */
export function resolveStreamOverlayClip(opts: {
  scheduled: MediaItem | null | undefined;
  displayMode: string | undefined;
  displayMedia: MediaItem | null | undefined;
}): StreamOverlayClip | null {
  const fromCue = opts.scheduled ? toClip(opts.scheduled) : null;
  if (fromCue) return fromCue;
  if (streamShowsDisplayClip(opts.displayMode) && opts.displayMedia) {
    return toClip(opts.displayMedia);
  }
  return null;
}

/**
 * Auto tijdens speeltijd: camera eerst — geen reclameclips over de wedstrijd.
 * Goal-video's en handmatige layout mogen wel. Pauze: alle clips.
 */
export function streamOverlayClipAllowed(opts: {
  phase: "play" | "break";
  layoutMode: "auto" | "manual";
  displayMode: string | undefined;
  fromScheduledCue: boolean;
}): boolean {
  if (opts.phase === "break") return true;
  if (opts.layoutMode === "manual") return true;
  if (opts.fromScheduledCue) return false;
  return opts.displayMode === "GOAL_INTRO_VIDEO" || opts.displayMode === "GOAL_PLAYER_VIDEO";
}
