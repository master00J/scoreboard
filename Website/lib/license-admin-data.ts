import { getSupabaseAdminHeaders } from "@/lib/supabase-admin";

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
