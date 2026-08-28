import { NextResponse } from "next/server";
import { z } from "zod";
import { adminGuard } from "@/lib/admin-route-guard";
import { adminListLicensePlans, adminUpsertLicensePlan } from "@/lib/license-plan-admin-data";
import { LICENSE_FEATURE_DEFINITIONS, normalizeFeatureMap } from "@/lib/license-plans";

const featureShape = Object.fromEntries(
  LICENSE_FEATURE_DEFINITIONS.map((def) => [def.key, z.boolean().optional()]),
) as Record<(typeof LICENSE_FEATURE_DEFINITIONS)[number]["key"], z.ZodOptional<z.ZodBoolean>>;

const planBody = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,40}$/),
  name: z.string().trim().min(1).max(80),
  description: z.union([z.string().trim().max(500), z.literal(""), z.null()]).optional(),
  priceLabel: z.union([z.string().trim().max(120), z.literal(""), z.null()]).optional(),
  features: z.object(featureShape).passthrough().optional(),
  maxActivationsDefault: z.coerce.number().int().min(1).max(500).optional(),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

export async function GET() {
  const denied = await adminGuard();
  if (denied) return denied;
  const plans = await adminListLicensePlans();
  if (!plans) {
    return NextResponse.json({ ok: false, message: "Database niet bereikbaar." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, plans });
}

export async function POST(request: Request) {
  const denied = await adminGuard();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Ongeldige aanvraag." }, { status: 400 });
  }

  const parsed = planBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Controleer de velden.", errors: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  const v = parsed.data;
  const result = await adminUpsertLicensePlan({
    code: v.code,
    name: v.name,
    description: v.description ? v.description : null,
    price_label: v.priceLabel ? v.priceLabel : null,
    features: normalizeFeatureMap(v.features ?? {}),
    max_activations_default: v.maxActivationsDefault ?? 1,
    active: v.active ?? true,
    sort_order: v.sortOrder ?? 100,
  });
  if (!result.ok) {
    console.error("adminUpsertLicensePlan", result.status, result.text);
    return NextResponse.json({ ok: false, message: "Plan kon niet worden opgeslagen." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
