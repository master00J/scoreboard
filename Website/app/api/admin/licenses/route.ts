import { NextResponse } from "next/server";
import { z } from "zod";
import { adminGuard } from "@/lib/admin-route-guard";
import { adminCreateLicense, adminListLicenses } from "@/lib/license-admin-data";
import { generateLicenseKey } from "@/lib/license-keygen";
import { sanitizePortalDownloadUrl } from "@/lib/portal-download-url";

const createBody = z.object({
  organizationLabel: z.string().trim().min(1).max(200),
  ownerEmail: z.union([z.string().trim().email(), z.literal("")]).optional(),
  maxActivations: z.coerce.number().int().min(1).max(500),
  validUntil: z.union([z.string(), z.literal(""), z.null()]).optional(),
  plan: z.string().trim().regex(/^[a-z0-9_-]{2,40}$/),
  notes: z.string().trim().max(2000).optional().nullable(),
  licenseKey: z.string().trim().min(8).max(64).optional(),
  downloadUrl: z.union([z.string(), z.literal(""), z.null()]).optional(),
});

function toIsoEndOfDayOrNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) {
    return null;
  }
  const s = String(v).trim();
  if (s === "") {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return `${s}T23:59:59.999Z`;
  }
  const t = Date.parse(s);
  if (!Number.isFinite(t)) {
    return null;
  }
  return new Date(t).toISOString();
}

export async function GET() {
  const denied = await adminGuard();
  if (denied) {
    return denied;
  }
  const rows = await adminListLicenses();
  if (!rows) {
    return NextResponse.json({ ok: false, message: "Database niet bereikbaar." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, licenses: rows });
}

export async function POST(request: Request) {
  const denied = await adminGuard();
  if (denied) {
    return denied;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Ongeldige aanvraag." }, { status: 400 });
  }

  const parsed = createBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Controleer de velden.", errors: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  const v = parsed.data;
  const key = (v.licenseKey?.trim() && v.licenseKey.trim().length >= 8
    ? v.licenseKey.trim().toUpperCase()
    : generateLicenseKey()) as string;

  const owner =
    v.ownerEmail && v.ownerEmail.length > 0 ? v.ownerEmail.trim().toLowerCase() : null;

  const result = await adminCreateLicense({
    license_key: key,
    organization_label: v.organizationLabel.trim(),
    owner_email: owner,
    max_activations: v.maxActivations,
    valid_until: toIsoEndOfDayOrNull(v.validUntil ?? null),
    plan: v.plan,
    notes: v.notes?.trim() || null,
    download_url: sanitizePortalDownloadUrl(
      v.downloadUrl === "" || v.downloadUrl === null || v.downloadUrl === undefined
        ? null
        : String(v.downloadUrl),
    ),
  });

  if (!result.ok) {
    console.error("adminCreateLicense", result.status, result.text);
    return NextResponse.json(
      { ok: false, message: "Licentie kon niet worden aangemaakt (dubbele sleutel?)." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, licenseKey: key });
}
