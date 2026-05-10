import { NextResponse } from "next/server";
import { z } from "zod";
import { adminGuard } from "@/lib/admin-route-guard";
import { adminGetLicensePlan, adminUpdateLicensePlan } from "@/lib/license-plan-admin-data";
import { LICENSE_FEATURE_DEFINITIONS, normalizeFeatureMap } from "@/lib/license-plans";

const featureShape = Object.fromEntries(
  LICENSE_FEATURE_DEFINITIONS.map((def) => [def.key, z.boolean().optional()]),
) as Record<(typeof LICENSE_FEATURE_DEFINITIONS)[number]["key"], z.ZodOptional<z.ZodBoolean>>;

const patchBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.union([z.string().trim().max(500), z.literal(""), z.null()]).optional(),
  priceLabel: z.union([z.string().trim().max(120), z.literal(""), z.null()]).optional(),
  features: z.object(featureShape).passthrough().optional(),
  maxActivationsDefault: z.coerce.number().int().min(1).max(500).optional(),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

function validCode(code: string) {
  return /^[a-z0-9_-]{2,40}$/.test(code);
}

export async function GET(_request: Request, ctx: { params: Promise<{ code: string }> }) {
  const denied = await adminGuard();
  if (denied) return denied;
  const { code } = await ctx.params;
  if (!validCode(code)) {
    return NextResponse.json({ ok: false, message: "Ongeldige plan-code." }, { status: 400 });
  }
  const plan = await adminGetLicensePlan(code);
  if (!plan) {
    return NextResponse.json({ ok: false, message: "Niet gevonden." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, plan });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ code: string }> }) {
  const denied = await adminGuard();
  if (denied) return denied;
  const { code } = await ctx.params;
  if (!validCode(code)) {
    return NextResponse.json({ ok: false, message: "Ongeldige plan-code." }, { status: 400 });
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

  const v = parsed.data;
  const result = await adminUpdateLicensePlan(code, {
    ...(v.name !== undefined ? { name: v.name } : {}),
    ...(v.description !== undefined ? { description: v.description ? v.description : null } : {}),
    ...(v.priceLabel !== undefined ? { price_label: v.priceLabel ? v.priceLabel : null } : {}),
    ...(v.features !== undefined ? { features: normalizeFeatureMap(v.features) } : {}),
    ...(v.maxActivationsDefault !== undefined
      ? { max_activations_default: v.maxActivationsDefault }
      : {}),
    ...(v.active !== undefined ? { active: v.active } : {}),
    ...(v.sortOrder !== undefined ? { sort_order: v.sortOrder } : {}),
  });
  if (!result.ok) {
    console.error("adminUpdateLicensePlan", result.status, result.text);
    return NextResponse.json({ ok: false, message: "Plan kon niet worden opgeslagen." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
