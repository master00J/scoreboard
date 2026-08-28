import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME, verifyAdminToken } from "@/lib/admin-auth";
import { getAdminPathPrefix, getAdminPathSegment, isAdminLoginPath, isAdminUiPath } from "@/lib/admin-url";

function withSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "connect-src 'self' https:",
    ].join("; "),
  );
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /** Als de portable niet in `public/` zit (Vercel), doorverwijzen naar een vaste HTTPS-URL (bv. Supabase Storage). */
  if (pathname === "/downloads/Stadium-Scoreboard.exe") {
    const redirect = process.env.DOWNLOAD_STADIUM_EXE_REDIRECT_URL?.trim();
    if (redirect && /^https:\/\//i.test(redirect)) {
      return withSecurityHeaders(NextResponse.redirect(redirect, 307));
    }
  }
  if (pathname === "/downloads/ArenaCue-Ledboarding.exe") {
    const redirect = process.env.DOWNLOAD_LEDBOARDING_EXE_REDIRECT_URL?.trim();
    if (redirect && /^https:\/\//i.test(redirect)) {
      return withSecurityHeaders(NextResponse.redirect(redirect, 307));
    }
  }

  if (pathname === "/licentie" || pathname.startsWith("/licentie/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/portal";
    url.hash = "";
    return withSecurityHeaders(NextResponse.redirect(url, 308));
  }

  if (pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  const prefix = getAdminPathPrefix();
  const custom = getAdminPathSegment() !== "admin";

  if (custom && pathname.startsWith("/admin")) {
    return withSecurityHeaders(new NextResponse(null, { status: 404 }));
  }

  if (!isAdminUiPath(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  if (isAdminLoginPath(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!(await verifyAdminToken(token))) {
    const url = request.nextUrl.clone();
    url.pathname = `${prefix}/login`;
    url.searchParams.set("next", pathname);
    return withSecurityHeaders(NextResponse.redirect(url));
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
