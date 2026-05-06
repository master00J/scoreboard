import { NextResponse } from "next/server";
import { getControlState } from "@/lib/control-store";
import { readBearerToken, verifyControlToken } from "@/lib/control-auth";

export async function GET(request: Request) {
  const claims = await verifyControlToken(readBearerToken(request));
  if (!claims) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }
  try {
    const state = await getControlState(claims.venueId);
    return NextResponse.json({ ok: true, venueId: claims.venueId, state });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
