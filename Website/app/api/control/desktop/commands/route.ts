import { NextResponse } from "next/server";
import { ackControlCommand, listPendingCommands } from "@/lib/control-store";

function authorized(request: Request): boolean {
  const expected = process.env.CONTROL_DESKTOP_KEY?.trim();
  if (!expected) return false;
  const got = request.headers.get("x-desktop-key")?.trim();
  return got === expected;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }
  const url = new URL(request.url);
  const venueId = (url.searchParams.get("venueId") ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(venueId)) {
    return NextResponse.json({ ok: false, message: "Ongeldige venueId." }, { status: 422 });
  }
  try {
    const commands = await listPendingCommands(venueId);
    return NextResponse.json({ ok: true, commands });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Ongeldige JSON body." }, { status: 400 });
  }
  const input = (body ?? {}) as {
    commandId?: string;
    ok?: boolean;
    error?: string;
    result?: unknown;
  };
  if (!input.commandId) {
    return NextResponse.json({ ok: false, message: "commandId ontbreekt." }, { status: 422 });
  }
  try {
    await ackControlCommand(input.commandId, {
      ok: !!input.ok,
      error: input.error,
      result: input.result,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
