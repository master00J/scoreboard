import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PORTAL_COOKIE_NAME } from "@/lib/portal-auth";

export async function POST() {
  const jar = await cookies();
  jar.set(PORTAL_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return NextResponse.json({ ok: true });
}
