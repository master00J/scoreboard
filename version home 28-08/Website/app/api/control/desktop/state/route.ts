import { NextResponse } from "next/server";
import { upsertControlState } from "@/lib/control-store";
import { checkRateLimit, readClientIp } from "@/lib/rate-limit";

function authorized(request: Request): boolean {
  const expected = process.env.CONTROL_DESKTOP_KEY?.trim();
  if (!expected) return false;
  const got = request.headers.get("x-desktop-key")?.trim();
  return got === expected;
}

export async function POST(request: Request) {
  const ip = readClientIp(request);
  const limit = checkRateLimit({
    key: `desktop-state:${ip}`,
    limit: 240,
    windowMs: 60 * 1000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, message: "Te veel state-updates. Probeer later opnieuw." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  if (!authorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Ongeldige JSON body." }, { status: 400 });
  }
  const input = (body ?? {}) as { venueId?: string; state?: unknown };
  const venueId = (input.venueId ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(venueId)) {
    return NextResponse.json({ ok: false, message: "Ongeldige venueId." }, { status: 422 });
  }
  try {
    await upsertControlState(venueId, input.state ?? null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
