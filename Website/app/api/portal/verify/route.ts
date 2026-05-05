import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  PORTAL_COOKIE_NAME,
  signPortalSessionToken,
  verifyPortalMagicToken,
} from "@/lib/portal-auth";
import { getSiteUrl } from "@/lib/site-url";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const email = await verifyPortalMagicToken(token ?? undefined);

  const origin = getSiteUrl().replace(/\/$/, "");
  const failUrl = `${origin}/portal?fout=link`;

  if (!email) {
    return NextResponse.redirect(failUrl, 302);
  }

  let sessionToken: string;
  try {
    sessionToken = await signPortalSessionToken(email);
  } catch {
    return NextResponse.redirect(failUrl, 302);
  }

  const jar = await cookies();
  jar.set(PORTAL_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 14 * 24 * 60 * 60,
  });

  return NextResponse.redirect(`${origin}/portal`, 302);
}
