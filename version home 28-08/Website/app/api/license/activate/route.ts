import { NextResponse } from "next/server";
import {
  countInstallations,
  fetchLicenseByKey,
  findInstallation,
  insertInstallation,
  touchInstallationLastSeen,
} from "@/lib/license-server";
import { licenseActivateBodySchema, normalizeLicenseKey } from "@/lib/license-keys";
import { operatorPairTokenForVenue } from "@/lib/control-auth";
import { adminGetLicensePlan } from "@/lib/license-plan-admin-data";
import { getFeaturesForPlan, toPublicLicenseSnapshot } from "@/lib/license-plans";

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

async function licenseBundleFor(row: { organization_label: string; plan: string; valid_until: string | null }) {
  const plan = await adminGetLicensePlan(row.plan);
  return toPublicLicenseSnapshot({
    ...row,
    plan_name: plan?.name ?? null,
    plan_features: plan?.features ?? getFeaturesForPlan(row.plan),
  });
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

  const parsed = licenseActivateBodySchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    const first =
      Object.values(msg).flat()[0] ?? "Controleer de velden.";
    return NextResponse.json({ ok: false, message: first }, { status: 422, headers: cors });
  }

  const licenseKey = normalizeLicenseKey(parsed.data.licenseKey);
  const { machineId, deviceLabel } = parsed.data;

  const lic = await fetchLicenseByKey(licenseKey);
  if (!lic.ok) {
    if (lic.reason === "not_configured") {
      return NextResponse.json(
        { ok: false, message: "Licentie-service niet geconfigureerd." },
        { status: 503, headers: cors },
      );
    }
    if (lic.reason === "supabase_error") {
      console.error("license activate supabase", lic.status, lic.text);
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
    console.error("license activate findInstallation", inst);
    return NextResponse.json(
      { ok: false, message: "Licentie-service tijdelijk niet beschikbaar." },
      { status: 502, headers: cors },
    );
  }

  if (inst.row) {
    void touchInstallationLastSeen(inst.row.id);
    const license = await licenseBundleFor(lic.row);
    return NextResponse.json(
      {
        ok: true,
        status: "already_activated",
        license,
        control: controlConfigFor(machineId, lic.row.id),
      },
      { headers: cors },
    );
  }

  const n = await countInstallations(lic.row.id);
  if (n === null) {
    return NextResponse.json(
      { ok: false, message: "Licentie-service tijdelijk niet beschikbaar." },
      { status: 502, headers: cors },
    );
  }

  if (n >= lic.row.max_activations) {
    return NextResponse.json(
      {
        ok: false,
        reason: "seats_exhausted",
        message: `Maximum aantal installaties (${lic.row.max_activations}) bereikt.`,
      },
      { status: 200, headers: cors },
    );
  }

  const inserted = await insertInstallation(lic.row.id, machineId, deviceLabel);
  if (!inserted.ok) {
    if (inserted.status === 409) {
      const again = await findInstallation(lic.row.id, machineId);
      if (again.ok && again.row) {
        void touchInstallationLastSeen(again.row.id);
        const license = await licenseBundleFor(lic.row);
        return NextResponse.json(
          {
            ok: true,
            status: "already_activated",
            license,
            control: controlConfigFor(machineId, lic.row.id),
          },
          { headers: cors },
        );
      }
    }
    console.error("license activate insert", inserted.status, inserted.text);
    return NextResponse.json(
      { ok: false, message: "Activeren mislukt. Probeer later opnieuw." },
      { status: 502, headers: cors },
    );
  }

  const license = await licenseBundleFor(lic.row);
  return NextResponse.json(
    {
      ok: true,
      status: "activated",
      license,
      control: controlConfigFor(machineId, lic.row.id),
    },
    { headers: cors },
  );
}
