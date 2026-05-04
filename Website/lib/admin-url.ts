const RESERVED = new Set(
  [
    "api",
    "_next",
    "static",
    "licentie",
    "privacy",
    "terms",
    "manifest.webmanifest",
    "robots.txt",
    "sitemap.xml",
    "favicon.ico",
  ].map((s) => s.toLowerCase()),
);

function normalizeSegment(raw: string | undefined): string {
  const s = (raw ?? "admin").trim().replace(/^\/+|\/+$/g, "").replace(/\/+/g, "");
  if (!s) {
    return "admin";
  }
  if (!/^[a-zA-Z0-9_-]{2,80}$/.test(s)) {
    return "admin";
  }
  if (RESERVED.has(s.toLowerCase())) {
    return "admin";
  }
  return s;
}

/** Segment voor URL (zonder slashes), bv. "j9k-m4nt-7xq". Standaard "admin". */
export function getAdminPathSegment(): string {
  return normalizeSegment(process.env.NEXT_PUBLIC_ADMIN_PATH);
}

/** Publiek prefix, bv. "/j9k-m4nt-7xq" */
export function getAdminPathPrefix(): string {
  return `/${getAdminPathSegment()}`;
}

export function isAdminUiPath(pathname: string): boolean {
  const p = getAdminPathPrefix();
  return pathname === p || pathname.startsWith(`${p}/`);
}

export function isAdminLoginPath(pathname: string): boolean {
  const p = `${getAdminPathPrefix()}/login`;
  return pathname === p || pathname.startsWith(`${p}/`);
}
