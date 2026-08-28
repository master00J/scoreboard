import { NextResponse } from "next/server";
import { getAppReleasePayload } from "@/lib/app-release";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function GET() {
  const payload = getAppReleasePayload();
  return NextResponse.json(payload, { headers: cors });
}
