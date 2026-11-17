/** Een lokaal bestand als media van een sponsor registreren (Electron: het pad wordt bewaard, niets gekopieerd). */

import { clampMediaDurationSec, readVideoDuration } from "@/lib/media-duration";
import { isDisplayPlaybackRisk } from "@/lib/media-playback-compat";
import { mediaUrl } from "@/lib/media-url";

export const SPONSOR_MEDIA_EXTENSIONS = ["mp4", "webm", "mov", "avi", "jpg", "jpeg", "png", "gif", "webp"];

export type RegisterSponsorFileResult =
  | { ok: true; mediaId: string; playbackRisk: boolean }
  | { ok: false; reason: "duration" | "failed" };

export function isVideoFile(filePath: string): boolean {
  return /\.(mp4|webm|mov|avi)$/i.test(filePath);
}

export function fileNameOf(filePath: string): string {
  return filePath.replace(/.*[/\\]/, "");
}

/**
 * Zelfde stappen als "Bestanden toevoegen" op de sponsorkaart: duur lezen en media aanmaken.
 * Een clip die niet in de afspeelvolgorde staat, speelt achteraan (applySponsorPlaybackOrder).
 */
export async function registerSponsorFile(
  filePath: string,
  sponsor: { id: string; name: string; imageDefaultSec?: number | null },
): Promise<RegisterSponsorFileResult> {
  const fileName = fileNameOf(filePath);
  const video = isVideoFile(fileName);
  let durationSec = clampMediaDurationSec(sponsor.imageDefaultSec ?? 10);
  if (video) {
    try {
      durationSec = await readVideoDuration(mediaUrl(filePath));
    } catch {
      return { ok: false, reason: "duration" };
    }
  }
  const res = await fetch("/api/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: video ? "VIDEO" : "IMAGE",
      path: filePath,
      title: fileName,
      durationSec: Math.round(durationSec),
      sponsorId: sponsor.id,
      sponsorName: sponsor.name,
    }),
  });
  if (!res.ok) return { ok: false, reason: "failed" };
  const created = (await res.json()) as { id?: string; playbackInspect?: { reason?: string } };
  if (!created.id) return { ok: false, reason: "failed" };
  return {
    ok: true,
    mediaId: created.id,
    playbackRisk: Boolean(created.playbackInspect?.reason && isDisplayPlaybackRisk(created.playbackInspect.reason)),
  };
}

