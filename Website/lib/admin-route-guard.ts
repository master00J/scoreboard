import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, verifyAdminToken } from "@/lib/admin-auth";

export async function adminGuard(): Promise<null | NextResponse> {
  const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  if (!(await verifyAdminToken(token))) {
    return NextResponse.json({ ok: false, message: "Niet ingelogd." }, { status: 401 });
  }
  return null;
}
