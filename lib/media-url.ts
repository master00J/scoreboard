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
      const fileName = storedPath.replace(/^\/uploads\//, "");
      return toFileUrl(`${window.electronAPI.context.uploadsDir}\\${fileName}`);
    }
    return toFileUrl(storedPath);
  }
  if (storedPath.startsWith("/uploads/")) return storedPath;
  // Absolute paths (Windows drive letter or Unix root outside /uploads)
  return `/api/localfile?path=${encodeURIComponent(storedPath)}`;
}

function toFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const prefixed = /^[a-zA-Z]:\//.test(normalized)
    ? `file:///${normalized}`
    : `file://${normalized}`;
  return encodeURI(prefixed);
}
