import { NextResponse } from "next/server";
import { enqueueControlCommand } from "@/lib/control-store";
import { readBearerToken, verifyControlToken } from "@/lib/control-auth";

export async function POST(request: Request) {
  const claims = await verifyControlToken(readBearerToken(request));
  if (!claims) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }
  if (claims.role !== "operator") {
    return NextResponse.json({ ok: false, message: "Operator rechten vereist." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Ongeldige JSON body." }, { status: 400 });
  }

  const input = (body ?? {}) as { command?: unknown };
  if (!input.command) {
    return NextResponse.json({ ok: false, message: "Command ontbreekt." }, { status: 422 });
  }

  try {
    const commandId = await enqueueControlCommand(claims.venueId, input.command);
    return NextResponse.json({ ok: true, commandId });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
