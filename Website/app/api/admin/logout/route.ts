import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME } from "@/lib/admin-auth";

export async function POST() {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
