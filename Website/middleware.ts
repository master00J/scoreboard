import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME, verifyAdminToken } from "@/lib/admin-auth";
import { getAdminPathPrefix, getAdminPathSegment, isAdminLoginPath, isAdminUiPath } from "@/lib/admin-url";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /** Als de portable niet in `public/` zit (Vercel), doorverwijzen naar een vaste HTTPS-URL (bv. Supabase Storage). */
  if (pathname === "/downloads/Stadium-Scoreboard.exe") {
    const redirect = process.env.DOWNLOAD_STADIUM_EXE_REDIRECT_URL?.trim();
    if (redirect && /^https:\/\//i.test(redirect)) {
      return NextResponse.redirect(redirect, 307);
    }
  }
  if (pathname === "/downloads/ArenaCue-Ledboarding.exe") {
    const redirect = process.env.DOWNLOAD_LEDBOARDING_EXE_REDIRECT_URL?.trim();
    if (redirect && /^https:\/\//i.test(redirect)) {
      return NextResponse.redirect(redirect, 307);
    }
  }

  if (pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  const prefix = getAdminPathPrefix();
  const custom = getAdminPathSegment() !== "admin";

  if (custom && pathname.startsWith("/admin")) {
    return new NextResponse(null, { status: 404 });
  }

  if (!isAdminUiPath(pathname)) {
    return NextResponse.next();
  }

  if (isAdminLoginPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!(await verifyAdminToken(token))) {
    const url = request.nextUrl.clone();
    url.pathname = `${prefix}/login`;
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
