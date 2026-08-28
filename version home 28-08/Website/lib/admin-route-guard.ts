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

/**
 * Admin-cookie óf `Authorization: Bearer <NOTIFY_LICENSE_UPDATE_TOKEN>` (Vercel/CI),
 * zodat je na een release geautomatiseerd kunt mailen zonder browser-sessie.
 */
export async function adminGuardOrNotifyToken(request: Request): Promise<null | NextResponse> {
  const denied = await adminGuard();
  if (!denied) {
    return null;
  }
  const secret = process.env.NOTIFY_LICENSE_UPDATE_TOKEN?.trim();
  const auth = request.headers.get("authorization")?.trim();
  if (secret && auth === `Bearer ${secret}`) {
    return null;
  }
  return denied;
}
