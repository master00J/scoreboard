import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, signAdminToken } from "@/lib/admin-auth";

function sha256utf8(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

function constantTimePasswordOk(input: string, expected: string): boolean {
  const a = sha256utf8(input);
  const b = sha256utf8(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.ADMIN_LICENSE_PASSWORD?.trim();
  if (!expected || expected.length < 12) {
    return NextResponse.json(
      { ok: false, message: "Admin-wachtwoord niet geconfigureerd op de server." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Ongeldige aanvraag." }, { status: 400 });
  }

  const password =
    typeof body === "object" && body !== null && "password" in body
      ? String((body as { password: unknown }).password ?? "")
      : "";

  if (!constantTimePasswordOk(password, expected)) {
    return NextResponse.json({ ok: false, message: "Onjuist wachtwoord." }, { status: 401 });
  }

  let token: string;
  try {
    token = await signAdminToken();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Sessie niet geconfigureerd (ADMIN_SESSION_SECRET)." },
      { status: 503 },
    );
  }

  const jar = await cookies();
  jar.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60,
  });

  return NextResponse.json({ ok: true });
}
