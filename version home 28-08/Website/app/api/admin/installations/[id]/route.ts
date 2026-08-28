import { NextResponse } from "next/server";
import { z } from "zod";
import { adminGuard } from "@/lib/admin-route-guard";
import { adminDeleteInstallation } from "@/lib/license-admin-data";

const uuid = z.string().uuid();

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await adminGuard();
  if (denied) {
    return denied;
  }
  const { id } = await ctx.params;
  if (!uuid.safeParse(id).success) {
    return NextResponse.json({ ok: false, message: "Ongeldig id." }, { status: 400 });
  }

  const result = await adminDeleteInstallation(id);
  if (!result.ok) {
    console.error("adminDeleteInstallation", result.status, result.text);
    return NextResponse.json({ ok: false, message: "Verwijderen mislukt." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
