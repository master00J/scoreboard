import { NextResponse } from "next/server";
import {
  fetchLicenseByKey,
  findInstallation,
  touchInstallationLastSeen,
} from "@/lib/license-server";
import { licenseCheckBodySchema, normalizeLicenseKey } from "@/lib/license-keys";
import { operatorPairTokenForVenue } from "@/lib/control-auth";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

function controlConfigFor(machineId: string, licenseId: string) {
  const desktopKey = process.env.CONTROL_DESKTOP_KEY?.trim();
  if (!desktopKey) return null;
  const configuredBaseUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") || "https://arenacue.be";
  const baseUrl = /^https:\/\/(www\.)?arenacue\.com$/i.test(configuredBaseUrl)
    ? "https://arenacue.be"
    : configuredBaseUrl;
  const venueId = `v-${licenseId.slice(0, 8)}-${machineId.slice(0, 6)}`.toLowerCase();
  return { cloudBaseUrl: baseUrl, desktopKey, venueId, operatorPairToken: operatorPairTokenForVenue(venueId) };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Ongeldige aanvraag." },
      { status: 400, headers: cors },
    );
  }

  const parsed = licenseCheckBodySchema.safeParse(body);
  if (!parsed.success) {
    const first =
      (Object.values(parsed.error.flatten().fieldErrors).flat()[0] as string | undefined) ??
      "Controleer de velden.";
    return NextResponse.json({ ok: false, message: first }, { status: 422, headers: cors });
  }

  const licenseKey = normalizeLicenseKey(parsed.data.licenseKey);
  const { machineId } = parsed.data;

  const lic = await fetchLicenseByKey(licenseKey);
  if (!lic.ok) {
    if (lic.reason === "not_configured") {
      return NextResponse.json(
        { ok: false, message: "Licentie-service niet geconfigureerd." },
        { status: 503, headers: cors },
      );
    }
    if (lic.reason === "supabase_error") {
      console.error("license check supabase", lic.status, lic.text);
      return NextResponse.json(
        { ok: false, message: "Licentie-service tijdelijk niet beschikbaar." },
        { status: 502, headers: cors },
      );
    }
    const map: Record<string, string> = {
      unknown_key: "Onbekende licentiesleutel.",
      revoked: "Deze licentie is ingetrokken.",
      expired: "Deze licentie is verlopen.",
    };
    return NextResponse.json(
      { ok: false, reason: lic.reason, message: map[lic.reason] ?? "Licentie ongeldig." },
      { status: 200, headers: cors },
    );
  }

  const inst = await findInstallation(lic.row.id, machineId);
  if (!inst.ok) {
    return NextResponse.json(
      { ok: false, message: "Licentie-service tijdelijk niet beschikbaar." },
      { status: 502, headers: cors },
    );
  }

  if (inst.row) {
    void touchInstallationLastSeen(inst.row.id);
  }

  return NextResponse.json(
    {
      ok: true,
      activated: Boolean(inst.row),
      license: {
        organizationLabel: lic.row.organization_label,
        plan: lic.row.plan,
        validUntil: lic.row.valid_until,
      },
      control: inst.row ? controlConfigFor(machineId, lic.row.id) : null,
    },
    { headers: cors },
  );
}
