import type { DisplayPlaybackLogPayload } from "./desktop-bridge";

/** Stuurt afspeelcontext naar het Electron-mainproces (boot.log bij crash). */
export function reportDisplayPlaybackToMain(payload: DisplayPlaybackLogPayload): void {
  if (typeof window === "undefined") return;
  try {
    window.electronAPI?.reportDisplayPlaybackContext?.(payload);
  } catch {
    /* ignore */
  }
}
