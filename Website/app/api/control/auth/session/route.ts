import { NextResponse } from "next/server";
import {
  signControlToken,
  isControlAuthConfigured,
  verifyOperatorPairToken,
  type ControlRole,
} from "@/lib/control-auth";
import { checkRateLimit, readClientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const ip = readClientIp(request);
  const limit = checkRateLimit({
    key: `control-auth:${ip}`,
    limit: 30,
    windowMs: 5 * 60 * 1000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, message: "Te veel aanvragen. Probeer het straks opnieuw." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  if (!isControlAuthConfigured()) {
    return NextResponse.json(
      { ok: false, message: "CONTROL_SESSION_SECRET niet geconfigureerd." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Ongeldige JSON body." }, { status: 400 });
  }

  const input = (body ?? {}) as {
    venueId?: string;
    role?: ControlRole;
    pin?: string;
    pairToken?: string;
  };

  const venueId = (input.venueId ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(venueId)) {
    return NextResponse.json({ ok: false, message: "Ongeldige venueId." }, { status: 422 });
  }

  const role: ControlRole = input.role === "operator" ? "operator" : "viewer";
  const hasValidPairToken = verifyOperatorPairToken(venueId, input.pairToken);

  // Viewer-sessies vereisen ook venue-scoped pair token.
  if (role === "viewer" && !hasValidPairToken) {
    return NextResponse.json(
      { ok: false, message: "Viewer-toegang vereist een geldige pair token." },
      { status: 401 },
    );
  }

  if (role === "operator") {
    if (hasValidPairToken) {
      const token = await signControlToken({ role, venueId });
      return NextResponse.json({ ok: true, token, role, venueId });
    }
    const expectedPin = process.env.CONTROL_OPERATOR_PIN?.trim();
    if (!expectedPin) {
      return NextResponse.json(
        { ok: false, message: "Operator PIN is niet geconfigureerd." },
        { status: 503 },
      );
    }
    if ((input.pin ?? "").trim() !== expectedPin) {
      return NextResponse.json({ ok: false, message: "Onjuiste PIN." }, { status: 401 });
    }
  }

  const token = await signControlToken({ role, venueId });
  return NextResponse.json({ ok: true, token, role, venueId });
}
