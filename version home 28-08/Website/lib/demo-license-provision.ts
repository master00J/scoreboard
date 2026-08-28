import {
  WEBSITE_DEMO_LICENSE_NOTE,
  adminAnyWebsiteDemoLicenseForOwnerEmail,
  adminCreateLicense,
} from "@/lib/license-admin-data";
import { generateLicenseKey } from "@/lib/license-keygen";
import { getSupabaseAdminHeaders } from "@/lib/supabase-admin";

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Standaard aan als service role geconfigureerd is; zet DEMO_LICENSE_AUTO_PROVISION=false om uit te zetten. */
export function isWebsiteDemoLicenseProvisioningEnabled(): boolean {
  const explicit = process.env.DEMO_LICENSE_AUTO_PROVISION?.trim();
  if (explicit === "false" || explicit === "0") {
    return false;
  }
  return Boolean(getSupabaseAdminHeaders());
}

export type ProvisionWebsiteDemoLicenseResult = {
  licenseKey: string;
};

/**
 * Maakt éénmalig een tijdelijke trial aan voor dit e-mailadres (website_demo).
 * Geen tweede licentie zolang er al een demo-registratie voor het adres bestaat (zie API-route).
 */
export async function provisionWebsiteDemoLicense(params: {
  ownerEmail: string;
  organizationLabel: string;
}): Promise<ProvisionWebsiteDemoLicenseResult | null> {
  if (!isWebsiteDemoLicenseProvisioningEnabled()) {
    return null;
  }

  const email = params.ownerEmail.trim().toLowerCase();

  const blocked = await adminAnyWebsiteDemoLicenseForOwnerEmail(email);
  if (blocked === null) {
    console.error("provisionWebsiteDemoLicense: lookup existing demo failed");
    return null;
  }
  if (blocked) {
    return null;
  }

  const validDays = parsePositiveInt(process.env.DEMO_LICENSE_VALID_DAYS, 14);
  const maxAct = parsePositiveInt(process.env.DEMO_LICENSE_MAX_ACTIVATIONS, 2);
  const cappedActivations = Math.min(500, Math.max(1, maxAct));
  const validUntil = new Date(Date.now() + validDays * 86_400_000).toISOString();
  const label = params.organizationLabel.trim() || "Demo";

  for (let attempt = 0; attempt < 8; attempt++) {
    const license_key = generateLicenseKey();
    const result = await adminCreateLicense({
      license_key,
      organization_label: label,
      owner_email: email,
      max_activations: cappedActivations,
      valid_until: validUntil,
      plan: "trial",
      notes: WEBSITE_DEMO_LICENSE_NOTE,
      download_url: null,
    });
    if (result.ok) {
      return { licenseKey: license_key };
    }
    if (result.status !== 409) {
      console.error("provisionWebsiteDemoLicense adminCreateLicense failed", result.status, result.text);
      return null;
    }
  }

  console.error("provisionWebsiteDemoLicense exhausted unique key retries");
  return null;
}
