import {
  adminListInstallations,
  adminListLicensesByOwnerEmail,
  type InstallationFullRow,
  type LicenseFullRow,
} from "@/lib/license-admin-data";
import { getSupabaseAdminHeaders } from "@/lib/supabase-admin";
import { toPublicLicenseSnapshot } from "@/lib/license-plans";
import { portalDownloadLabel, portalLedboardingDownloadLabel, resolvePortalDownloadUrl, sanitizePortalDownloadUrl } from "@/lib/portal-download-url";

export type PortalInstallationView = {
  deviceLabel: string;
  machinePreview: string;
  activatedAt: string;
  lastSeenAt: string;
};

export type PortalLicenseCardView = {
  licenseKey: string;
  organizationLabel: string;
  plan: string;
  planLabel: string;
  validUntil: string | null;
  features: Record<string, boolean>;
  status: "active" | "revoked" | "expired";
  maxActivations: number;
  usedActivations: number;
  downloadUrl: string | null;
  downloadLabel: string | null;
  ledboardingDownloadUrl: string | null;
  ledboardingDownloadLabel: string | null;
  installations: PortalInstallationView[];
};

function machinePreview(machineId: string): string {
  if (machineId.length <= 12) {
    return "•••";
  }
  return `${machineId.slice(0, 4)}…${machineId.slice(-4)}`;
}

function computeStatus(row: LicenseFullRow): "active" | "revoked" | "expired" {
  const now = Date.now();
  if (row.revoked_at) {
    return "revoked";
  }
  if (
    row.valid_until &&
    Number.isFinite(new Date(row.valid_until).getTime()) &&
    new Date(row.valid_until).getTime() < now
  ) {
    return "expired";
  }
  return "active";
}

function mapInstallations(rows: InstallationFullRow[]): PortalInstallationView[] {
  return rows.map((i) => ({
    deviceLabel: i.device_label || "—",
    machinePreview: machinePreview(i.machine_id),
    activatedAt: i.activated_at,
    lastSeenAt: i.last_seen_at,
  }));
}

export async function loadPortalLicenseCardsForOwnerEmail(
  email: string,
): Promise<PortalLicenseCardView[] | null> {
  if (!getSupabaseAdminHeaders()) {
    return null;
  }

  const rows = await adminListLicensesByOwnerEmail(email.trim().toLowerCase());
  if (!rows) {
    return null;
  }

  const cards: PortalLicenseCardView[] = [];

  for (const row of rows) {
    const installs = (await adminListInstallations(row.id)) ?? [];
    const status = computeStatus(row);
    const snap = toPublicLicenseSnapshot(row);
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

    cards.push({
      licenseKey: row.license_key,
      organizationLabel: snap.organizationLabel,
      plan: snap.plan,
      planLabel: snap.planLabel,
      validUntil: snap.validUntil,
      features: snap.features,
      status,
      maxActivations: row.max_activations,
      usedActivations: installs.length,
      downloadUrl,
      downloadLabel: downloadUrl ? portalDownloadLabel() : null,
      ledboardingDownloadUrl,
      ledboardingDownloadLabel: ledboardingDownloadUrl ? portalLedboardingDownloadLabel() : null,
      installations: mapInstallations(installs),
    });
  }

  return cards;
}
