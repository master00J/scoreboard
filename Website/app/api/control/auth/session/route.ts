import { NextResponse } from "next/server";
import {
  signControlToken,
  isControlAuthConfigured,
  verifyOperatorPairToken,
  type ControlRole,
} from "@/lib/control-auth";

export async function POST(request: Request) {
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
  if (role === "operator") {
    if (verifyOperatorPairToken(venueId, input.pairToken)) {
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
