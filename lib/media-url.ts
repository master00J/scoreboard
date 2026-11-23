import { displayCopyFor } from "./display-copy";
import { resolveStoredMediaPath } from "./media-file-path";

/**
 * Convert a stored media/photo/logo path to a URL usable in <img> / <video>.
 *
 * Two kinds of stored paths exist:
 *  - Web-relative:  "/uploads/abc123.mp4"   → serve as-is (Next.js public dir)
 *  - Absolute:      "C:\Videos\goal.mp4"    → proxy through /api/localfile
 *
 * In Electron the absolute paths come from the native file-dialog.
 * This utility centralises the decision so every component stays clean.
 */
export function mediaUrl(storedPath: string | null | undefined): string {
  if (!storedPath) return "";
  /** Op het stadionscherm: een kleinere kopie als de club die koos (lib/display-copy.ts). */
  storedPath = displayCopyFor(storedPath);
  if (typeof window !== "undefined" && window.electronAPI) {
    if (storedPath.startsWith("/uploads/")) {
      // Zelfde vertaling als de controle en de omzetting in het hoofdproces.
      const file = resolveStoredMediaPath(storedPath, window.electronAPI.context.uploadsDir);
      return file ? toFileUrl(file) : storedPath;
    }
    return toFileUrl(storedPath);
  }
  if (storedPath.startsWith("/uploads/")) return storedPath;
  // Absolute paths (Windows drive letter or Unix root outside /uploads)
  return `/api/localfile?path=${encodeURIComponent(storedPath)}`;
}

/**
 * Absolute file path → file:// URL. Every path segment is percent-encoded on its own, so
 * characters that mean something in a URL (`#`, `?`, `%`) stay part of the file name:
 * `encodeURI` would turn `Sponsor #1.png` into a fragment and the file would not load.
 * The drive letter and the slashes are kept as they are.
 */
export function toFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const drive = /^([a-zA-Z]:)(\/.*)$/.exec(normalized);
  if (drive) return `file:///${drive[1]}${encodePathSegments(drive[2])}`;
  return `file://${encodePathSegments(normalized)}`;
}

function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
