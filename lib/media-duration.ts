/** Mediaduur voor nieuwe media-items, gedeeld door het mediapaneel en het seizoensplan. */

/** Afbeelding / afgeronde videoseconds voor opslag (1 … 600). */
export function clampMediaDurationSec(n: number): number {
  if (!Number.isFinite(n)) return 10;
  return Math.min(600, Math.max(1, Math.round(n)));
}

/**
 * Leest werkelijke mediaduur uit het videobestand (metadata). Geen fallback:
 * bij falen reject zodat we geen verkeerde duur opslaan.
 */
export function readVideoDuration(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    let settled = false;
    const cleanup = () => {
      try {
        v.removeAttribute("src");
        v.load();
      } catch {
        /* ignore */
      }
    };
    const finishErr = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const finishOk = (sec: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(sec);
    };

    const to = window.setTimeout(() => finishErr(new Error("timeout")), 15000);

    v.onloadedmetadata = () => {
      window.clearTimeout(to);
      const d = v.duration;
      if (Number.isFinite(d) && d > 0) {
        finishOk(clampMediaDurationSec(d));
      } else {
        finishErr(new Error("invalid duration"));
      }
    };
    v.onerror = () => {
      window.clearTimeout(to);
      finishErr(new Error("video error"));
    };

    v.src = src;
  });
}
