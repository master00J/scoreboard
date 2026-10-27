import type { DesktopCaptureSourceInfo } from "./desktop-bridge";

/**
 * Een lijst zonder miniaturen (de stille verversing om de 5 s) houdt de miniaturen die er al waren.
 * Miniaturen maken betekent een schermafdruk van elk open venster in het hoofdproces; dat legde het
 * elke 5 s ±300 ms stil, ook tijdens een livestream en een wedstrijd.
 */
export function keepCaptureThumbnails(
  fresh: DesktopCaptureSourceInfo[],
  previous: ReadonlyArray<Pick<DesktopCaptureSourceInfo, "id" | "thumbnailDataUrl">>,
): DesktopCaptureSourceInfo[] {
  const known = new Map(previous.map((source) => [source.id, source.thumbnailDataUrl]));
  return fresh.map((source) =>
    source.thumbnailDataUrl ? source : { ...source, thumbnailDataUrl: known.get(source.id) ?? null },
  );
}
