import { NextResponse } from "next/server";
import {
  adminGetLicenseByKey,
  adminListInstallations,
} from "@/lib/license-admin-data";
import { getSupabaseAdminHeaders } from "@/lib/supabase-admin";
import { licensePortalBodySchema, normalizeLicenseKey } from "@/lib/license-keys";
import {
  portalDownloadLabel,
  portalLedboardingDownloadLabel,
  resolvePortalDownloadUrl,
  sanitizePortalDownloadUrl,
} from "@/lib/portal-download-url";

const portalBody = licensePortalBodySchema;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

function machinePreview(machineId: string): string {
  if (machineId.length <= 12) {
    return "•••";
  }
  return `${machineId.slice(0, 4)}…${machineId.slice(-4)}`;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function POST(request: Request) {
  if (!getSupabaseAdminHeaders()) {
    return NextResponse.json(
      { ok: false, message: "Licentie-service niet geconfigureerd." },
      { status: 503, headers: cors },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Ongeldige aanvraag." }, { status: 400, headers: cors });
  }

  const parsed = portalBody.safeParse(body);
  if (!parsed.success) {
    const first =
      (Object.values(parsed.error.flatten().fieldErrors).flat()[0] as string | undefined) ??
      "Controleer de velden.";
    return NextResponse.json({ ok: false, message: first }, { status: 422, headers: cors });
  }

  const licenseKey = normalizeLicenseKey(parsed.data.licenseKey);
  const ownerEmail = parsed.data.ownerEmail.trim().toLowerCase();

  const row = await adminGetLicenseByKey(licenseKey);
  if (!row) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "We vinden geen licentie met deze combinatie van sleutel en e-mail. Controleer je gegevens of neem contact op met ArenaCue.",
      },
      { status: 200, headers: cors },
    );
  }

  if (!row.owner_email || row.owner_email.trim().toLowerCase() !== ownerEmail) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "We vinden geen licentie met deze combinatie van sleutel en e-mail. Controleer je gegevens of neem contact op met ArenaCue.",
      },
      { status: 200, headers: cors },
    );
  }

  const now = Date.now();
  const revoked = Boolean(row.revoked_at);
  const expired = Boolean(
    row.valid_until &&
      Number.isFinite(new Date(row.valid_until).getTime()) &&
      new Date(row.valid_until).getTime() < now,
  );

  let status: "active" | "revoked" | "expired";
  if (revoked) {
    status = "revoked";
  } else if (expired) {
    status = "expired";
  } else {
    status = "active";
  }

  const installs = await adminListInstallations(row.id);
  if (!installs) {
    return NextResponse.json(
      { ok: false, message: "Kon installaties niet ophalen. Probeer later opnieuw." },
      { status: 502, headers: cors },
    );
  }

  const downloadUrl =
    status === "active"
      ? resolvePortalDownloadUrl(
          row.download_url ?? null,
          process.env.NEXT_PUBLIC_PORTAL_DOWNLOAD_URL,
        )
      : null;

  const ledboardingDownloadUrl =
    status === "active"
      ? sanitizePortalDownloadUrl(process.env.NEXT_PUBLIC_PORTAL_LEDBOARDING_DOWNLOAD_URL)
      : null;

  return NextResponse.json(
    {
      ok: true,
      license: {
        organizationLabel: row.organization_label,
        plan: row.plan,
        validUntil: row.valid_until,
        status,
        maxActivations: row.max_activations,
        usedActivations: installs.length,
        downloadUrl,
        downloadLabel: downloadUrl ? portalDownloadLabel() : null,
        ledboardingDownloadUrl,
        ledboardingDownloadLabel: ledboardingDownloadUrl ? portalLedboardingDownloadLabel() : null,
        installations: installs.map((i) => ({
          deviceLabel: i.device_label || "—",
          machinePreview: machinePreview(i.machine_id),
          activatedAt: i.activated_at,
          lastSeenAt: i.last_seen_at,
        })),
      },
    },
    { headers: cors },
  );
}
