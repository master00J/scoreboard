import { NextResponse } from "next/server";
import { z } from "zod";
import { adminGuard } from "@/lib/admin-route-guard";
import { adminGetLicense, adminListInstallations, adminUpdateLicense } from "@/lib/license-admin-data";
import { sanitizePortalDownloadUrl } from "@/lib/portal-download-url";

const uuid = z.string().uuid();

const patchBody = z.object({
  organizationLabel: z.string().trim().min(1).max(200).optional(),
  ownerEmail: z.union([z.string().trim().email(), z.literal("")]).optional(),
  maxActivations: z.coerce.number().int().min(1).max(500).optional(),
  validUntil: z.union([z.string(), z.literal(""), z.null()]).optional(),
  plan: z.enum(["trial", "standard", "club", "enterprise"]).optional(),
  notes: z.union([z.string().trim().max(2000), z.literal(""), z.null()]).optional(),
  revoked: z.boolean().optional(),
  downloadUrl: z.union([z.string(), z.literal(""), z.null()]).optional(),
});

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await adminGuard();
  if (denied) {
    return denied;
  }
  const { id } = await ctx.params;
  if (!uuid.safeParse(id).success) {
    return NextResponse.json({ ok: false, message: "Ongeldig id." }, { status: 400 });
  }
  const row = await adminGetLicense(id);
  if (!row) {
    return NextResponse.json({ ok: false, message: "Niet gevonden." }, { status: 404 });
  }
  const installations = (await adminListInstallations(id)) ?? [];
  return NextResponse.json({ ok: true, license: row, installations });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await adminGuard();
  if (denied) {
    return denied;
  }
  const { id } = await ctx.params;
  if (!uuid.safeParse(id).success) {
    return NextResponse.json({ ok: false, message: "Ongeldig id." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Ongeldige aanvraag." }, { status: 400 });
  }

  const parsed = patchBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Controleer de velden.", errors: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  const p = parsed.data;
  const patch: Parameters<typeof adminUpdateLicense>[1] = {};

  if (p.organizationLabel !== undefined) {
    patch.organization_label = p.organizationLabel;
  }
  if (p.ownerEmail !== undefined) {
    patch.owner_email = p.ownerEmail === "" ? null : p.ownerEmail.trim().toLowerCase();
  }
  if (p.maxActivations !== undefined) {
    patch.max_activations = p.maxActivations;
  }
  if (p.validUntil !== undefined) {
    if (p.validUntil === "" || p.validUntil === null) {
      patch.valid_until = null;
    } else {
      const s = String(p.validUntil).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        patch.valid_until = `${s}T23:59:59.999Z`;
      } else {
        const t = Date.parse(s);
        patch.valid_until = Number.isFinite(t) ? new Date(t).toISOString() : null;
      }
    }
  }
  if (p.plan !== undefined) {
    patch.plan = p.plan;
  }
  if (p.notes !== undefined) {
    patch.notes = p.notes === "" || p.notes === null ? null : p.notes;
  }
  if (p.downloadUrl !== undefined) {
    patch.download_url =
      p.downloadUrl === "" || p.downloadUrl === null
        ? null
        : sanitizePortalDownloadUrl(String(p.downloadUrl));
  }
  if (p.revoked === true) {
    patch.revoked_at = new Date().toISOString();
  }
  if (p.revoked === false) {
    patch.revoked_at = null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, message: "Geen wijzigingen." }, { status: 400 });
  }

  const result = await adminUpdateLicense(id, patch);
  if (!result.ok) {
    console.error("adminUpdateLicense", result.status, result.text);
    return NextResponse.json({ ok: false, message: "Opslaan mislukt." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
