const MAX_LEN = 2000;

/** Alleen http(s) of een site-relatief pad (bv. /downloads/setup.exe). */
export function sanitizePortalDownloadUrl(raw: string | null | undefined): string | null {
  if (raw == null) {
    return null;
  }
  const u = raw.trim();
  if (!u || u.length > MAX_LEN) {
    return null;
  }
  if (u.startsWith("/")) {
    const pathOnly = u.split("?")[0] ?? "";
    if (!pathOnly.startsWith("/") || pathOnly.length < 2) {
      return null;
    }
    if (!/^\/[-A-Za-z0-9/._~%]+$/.test(pathOnly)) {
      return null;
    }
    return u;
  }
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return u;
  } catch {
    return null;
  }
}

export function resolvePortalDownloadUrl(
  licenseRowUrl: string | null | undefined,
  envUrl: string | undefined,
): string | null {
  const fromRow = sanitizePortalDownloadUrl(licenseRowUrl);
  if (fromRow) {
    return fromRow;
  }
  return sanitizePortalDownloadUrl(envUrl);
}

export function portalDownloadLabel(): string {
  const raw = process.env.NEXT_PUBLIC_PORTAL_DOWNLOAD_LABEL?.trim();
  const s = raw && raw.length > 0 ? raw : "ArenaCue voor Windows";
  return s.length > 80 ? s.slice(0, 80) : s;
}
