import type { DisplayMediaDiagnosticPayload } from "./desktop-bridge";

const lastSent = new Map<string, number>();

/**
 * Stuurt HTML-video diagnostiek naar Electron-main (`boot.log`).
 * @param throttleMs — zelfde `mediaId`+`event` binnen dit venster wordt overgeslagen (0 = nooit).
 */
export function reportDisplayMediaDiagnostic(
  payload: DisplayMediaDiagnosticPayload,
  throttleMs = 0,
): void {
  if (typeof window === "undefined") return;
  if (throttleMs > 0) {
    const key = `${payload.mediaId ?? "—"}:${payload.event}`;
    const now = Date.now();
    const prev = lastSent.get(key) ?? 0;
    if (now - prev < throttleMs) return;
    lastSent.set(key, now);
  }
  try {
    window.electronAPI?.reportDisplayMediaDiagnostic?.(payload);
  } catch {
    /* ignore */
  }
}

export function videoElementDiagnosticFields(video: HTMLVideoElement | null): Pick<
  DisplayMediaDiagnosticPayload,
  "readyState" | "networkState" | "currentTime" | "mediaErrorCode" | "mediaErrorMessage"
> {
  if (!video) {
    return {
      readyState: -1,
      networkState: -1,
      currentTime: 0,
      mediaErrorCode: null,
      mediaErrorMessage: undefined,
    };
  }
  const err = video.error;
  return {
    readyState: video.readyState,
    networkState: video.networkState,
    currentTime: Math.round(video.currentTime * 1000) / 1000,
    mediaErrorCode: err?.code ?? null,
    mediaErrorMessage: err?.message ? String(err.message).slice(0, 200) : undefined,
  };
}
