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
  if (typeof window !== "undefined" && window.electronAPI) {
    if (storedPath.startsWith("/uploads/")) {
      const uploadsDir = window.electronAPI.context.uploadsDir;
      if (!uploadsDir) return storedPath;
      const fileName = storedPath.replace(/^\/uploads\//, "");
      return toFileUrl(`${uploadsDir}\\${fileName}`);
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
