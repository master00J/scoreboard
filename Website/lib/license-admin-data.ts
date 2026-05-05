import { getSupabaseAdminHeaders } from "@/lib/supabase-admin";

/** Marker in `licenses.notes` voor automatisch uitgegeven website-demo (`trial`). */
export const WEBSITE_DEMO_LICENSE_NOTE = "website_demo";

export function isWebsiteDemoLicense(row: { plan: string; notes: string | null | undefined }): boolean {
  const n = row.notes ?? null;
  return row.plan === "trial" && n === WEBSITE_DEMO_LICENSE_NOTE;
}

export type LicenseFullRow = {
  id: string;
  created_at: string;
  license_key: string;
  organization_label: string;
  max_activations: number;
  valid_until: string | null;
  revoked_at: string | null;
  plan: string;
  notes: string | null;
  owner_email: string | null;
  download_url: string | null;
};

export type InstallationFullRow = {
  id: string;
  license_id: string;
  machine_id: string;
  device_label: string | null;
  activated_at: string;
  last_seen_at: string;
};

function licenseRowActiveNonExpired(row: LicenseFullRow): boolean {
  if (row.revoked_at) {
    return false;
  }
  if (!row.valid_until) {
    return true;
  }
  const end = new Date(row.valid_until).getTime();
  return Number.isFinite(end) && end > Date.now();
}

/** Herbruik website_demo trial-licenties die nog niet verlopen zijn (zelfde owner-email). */
export async function adminFindActiveWebsiteDemoLicenseForOwnerEmail(
  email: string,
): Promise<LicenseFullRow | null> {
  const normalized = email.trim().toLowerCase();
  const enc = encodeURIComponent(normalized);
  const noteEnc = encodeURIComponent(WEBSITE_DEMO_LICENSE_NOTE);
  const r = await restGet<LicenseFullRow[]>(
    `licenses?owner_email=eq.${enc}&plan=eq.trial&notes=eq.${noteEnc}&revoked_at=is.null&select=*&order=created_at.desc&limit=20`,
  );
  if (!r.ok) {
    return null;
  }
  for (const row of r.data) {
    if (licenseRowActiveNonExpired(row)) {
      return row;
    }
  }
  return null;
}

async function restGet<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; status: number; text: string }> {
  const admin = getSupabaseAdminHeaders();
  if (!admin) {
    return { ok: false, status: 503, text: "not_configured" };
  }
  const res = await fetch(`${admin.url}/rest/v1/${path}`, { headers: admin.headers });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, text };
  }
  try {
    return { ok: true, data: JSON.parse(text || "[]") as T };
  } catch {
    return { ok: false, status: 502, text: "invalid_json" };
  }
}

async function restPost(
  path: string,
  body: unknown,
): Promise<{ ok: true } | { ok: false; status: number; text: string }> {
  const admin = getSupabaseAdminHeaders();
  if (!admin) {
    return { ok: false, status: 503, text: "not_configured" };
  }
  const res = await fetch(`${admin.url}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...admin.headers, Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, text };
  }
  return { ok: true };
}

async function restPatch(
  path: string,
  body: unknown,
): Promise<{ ok: true } | { ok: false; status: number; text: string }> {
  const admin = getSupabaseAdminHeaders();
  if (!admin) {
    return { ok: false, status: 503, text: "not_configured" };
  }
  const res = await fetch(`${admin.url}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { ...admin.headers, Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, text };
  }
  return { ok: true };
}

async function restDelete(path: string): Promise<{ ok: true } | { ok: false; status: number; text: string }> {
  const admin = getSupabaseAdminHeaders();
  if (!admin) {
    return { ok: false, status: 503, text: "not_configured" };
  }
  const res = await fetch(`${admin.url}/rest/v1/${path}`, {
    method: "DELETE",
    headers: admin.headers,
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, text };
  }
  return { ok: true };
}

export async function adminGetLicenseByKey(licenseKey: string): Promise<LicenseFullRow | null> {
  const enc = encodeURIComponent(licenseKey);
  const r = await restGet<LicenseFullRow[]>(`licenses?license_key=eq.${enc}&select=*&limit=1`);
  if (!r.ok) {
    return null;
  }
  return r.data[0] ?? null;
}

export async function adminListLicenses(): Promise<LicenseFullRow[] | null> {
  const r = await restGet<LicenseFullRow[]>("licenses?select=*&order=created_at.desc");
  if (!r.ok) {
    return null;
  }
  return r.data;
}

/** Alle licenties gekoppeld aan een klant-e-mail (klantportaal). */
export async function adminListLicensesByOwnerEmail(
  ownerEmailLower: string,
): Promise<LicenseFullRow[] | null> {
  const enc = encodeURIComponent(ownerEmailLower.trim().toLowerCase());
  const r = await restGet<LicenseFullRow[]>(
    `licenses?owner_email=eq.${enc}&select=*&order=created_at.desc`,
  );
  if (!r.ok) {
    return null;
  }
  return r.data;
}

export async function adminGetLicense(id: string): Promise<LicenseFullRow | null> {
  const enc = encodeURIComponent(id);
  const r = await restGet<LicenseFullRow[]>(`licenses?id=eq.${enc}&select=*&limit=1`);
  if (!r.ok) {
    return null;
  }
  return r.data[0] ?? null;
}

export async function adminListInstallations(licenseId: string): Promise<InstallationFullRow[] | null> {
  const enc = encodeURIComponent(licenseId);
  const r = await restGet<InstallationFullRow[]>(
    `license_installations?license_id=eq.${enc}&select=*&order=activated_at.desc`,
  );
  if (!r.ok) {
    return null;
  }
  return r.data;
}

export async function adminCreateLicense(row: {
  license_key: string;
  organization_label: string;
  owner_email: string | null;
  max_activations: number;
  valid_until: string | null;
  plan: string;
  notes: string | null;
  download_url: string | null;
}): Promise<{ ok: true } | { ok: false; status: number; text: string }> {
  return restPost("licenses", row);
}

export async function adminUpdateLicense(
  id: string,
  patch: Partial<{
    organization_label: string;
    owner_email: string | null;
    max_activations: number;
    valid_until: string | null;
    revoked_at: string | null;
    plan: string;
    notes: string | null;
    download_url: string | null;
  }>,
): Promise<{ ok: true } | { ok: false; status: number; text: string }> {
  const enc = encodeURIComponent(id);
  return restPatch(`licenses?id=eq.${enc}`, patch);
}

export async function adminDeleteInstallation(
  installationId: string,
): Promise<{ ok: true } | { ok: false; status: number; text: string }> {
  const enc = encodeURIComponent(installationId);
  return restDelete(`license_installations?id=eq.${enc}`);
}

/** True als er ooit een website-demo-licentie voor dit adres bestaat (ook verlopen). */
export async function adminAnyWebsiteDemoLicenseForOwnerEmail(email: string): Promise<boolean | null> {
  const enc = encodeURIComponent(email.trim().toLowerCase());
  const noteEnc = encodeURIComponent(WEBSITE_DEMO_LICENSE_NOTE);
  const r = await restGet<{ id: string }[]>(
    `licenses?owner_email=eq.${enc}&plan=eq.trial&notes=eq.${noteEnc}&select=id&limit=1`,
  );
  if (!r.ok) {
    return null;
  }
  return r.data.length > 0;
}

/** True als er al een demo-aanvraag met dit e-mailadres is opgeslagen. */
export async function adminDemoRequestExistsForEmail(email: string): Promise<boolean | null> {
  const enc = encodeURIComponent(email.trim().toLowerCase());
  const r = await restGet<{ id: string }[]>(`demo_requests?email=eq.${enc}&select=id&limit=1`);
  if (!r.ok) {
    return null;
  }
  return r.data.length > 0;
}

/**
 * True als dit apparaat al aan een ánder trial gekoppeld was dan `currentLicenseId`,
 * en dat een website-demo was — dan geen tweede demo op hetzelfde toestel.
 */
export async function adminMachineHasOtherWebsiteDemoInstallation(
  machineId: string,
  currentLicenseId: string,
): Promise<boolean | null> {
  const encM = encodeURIComponent(machineId.trim());
  const r = await restGet<{ license_id: string }[]>(
    `license_installations?machine_id=eq.${encM}&select=license_id`,
  );
  if (!r.ok) {
    return null;
  }
  const otherIds = [
    ...new Set(r.data.map((x) => x.license_id).filter((id) => id && id !== currentLicenseId)),
  ];
  if (otherIds.length === 0) {
    return false;
  }
  const inList = otherIds.map((id) => encodeURIComponent(id)).join(",");
  const lic = await restGet<Pick<LicenseFullRow, "id" | "plan" | "notes">[]>(
    `licenses?id=in.(${inList})&select=id,plan,notes`,
  );
  if (!lic.ok) {
    return null;
  }
  return lic.data.some((row) => isWebsiteDemoLicense(row));
}
