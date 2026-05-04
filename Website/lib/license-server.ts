import { getSupabaseAdminHeaders } from "@/lib/supabase-admin";

export type LicenseRow = {
  id: string;
  license_key: string;
  organization_label: string;
  max_activations: number;
  valid_until: string | null;
  revoked_at: string | null;
  plan: string;
  owner_email: string | null;
};

export type LicenseInvalidReason =
  | "unknown_key"
  | "revoked"
  | "expired"
  | "not_configured";

export function evaluateLicenseRow(row: LicenseRow): { ok: true } | { ok: false; reason: LicenseInvalidReason } {
  if (row.revoked_at) {
    return { ok: false, reason: "revoked" };
  }
  if (row.valid_until) {
    const end = new Date(row.valid_until).getTime();
    if (Number.isFinite(end) && end < Date.now()) {
      return { ok: false, reason: "expired" };
    }
  }
  return { ok: true };
}

async function restGet<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; text: string }> {
  const admin = getSupabaseAdminHeaders();
  if (!admin) {
    return { ok: false, status: 503, text: "not_configured" };
  }
  const res = await fetch(`${admin.url}/rest/v1/${path}`, {
    ...init,
    headers: { ...admin.headers, ...init?.headers },
  });
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

async function restPost(path: string, body: unknown): Promise<{ ok: true } | { ok: false; status: number; text: string }> {
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

export async function fetchLicenseByKey(licenseKey: string): Promise<
  | { ok: true; row: LicenseRow }
  | { ok: false; reason: LicenseInvalidReason }
  | { ok: false; reason: "supabase_error"; status: number; text: string }
> {
  const admin = getSupabaseAdminHeaders();
  if (!admin) {
    return { ok: false, reason: "not_configured" };
  }

  const enc = encodeURIComponent(licenseKey);
  const result = await restGet<LicenseRow[]>(
    `licenses?license_key=eq.${enc}&select=id,license_key,organization_label,max_activations,valid_until,revoked_at,plan,owner_email&limit=1`,
  );

  if (!result.ok) {
    if (result.status === 503) {
      return { ok: false, reason: "not_configured" };
    }
    return { ok: false, reason: "supabase_error", status: result.status, text: result.text };
  }

  const row = result.data[0];
  if (!row) {
    return { ok: false, reason: "unknown_key" };
  }

  const ev = evaluateLicenseRow(row);
  if (!ev.ok) {
    return { ok: false, reason: ev.reason };
  }

  return { ok: true, row };
}

type InstallationRow = { id: string; license_id: string; machine_id: string };

export async function findInstallation(
  licenseId: string,
  machineId: string,
): Promise<
  | { ok: true; row: InstallationRow | null }
  | { ok: false; reason: "not_configured" | "supabase_error"; status?: number; text?: string }
> {
  const encL = encodeURIComponent(licenseId);
  const encM = encodeURIComponent(machineId);
  const result = await restGet<InstallationRow[]>(
    `license_installations?license_id=eq.${encL}&machine_id=eq.${encM}&select=id,license_id,machine_id&limit=1`,
  );

  if (!result.ok) {
    if (result.status === 503) {
      return { ok: false, reason: "not_configured" };
    }
    return { ok: false, reason: "supabase_error", status: result.status, text: result.text };
  }

  return { ok: true, row: result.data[0] ?? null };
}

export async function touchInstallationLastSeen(installationId: string): Promise<void> {
  const enc = encodeURIComponent(installationId);
  await restPatch(`license_installations?id=eq.${enc}`, { last_seen_at: new Date().toISOString() });
}

export async function countInstallations(licenseId: string): Promise<number | null> {
  const enc = encodeURIComponent(licenseId);
  const rows = await restGet<{ id: string }[]>(
    `license_installations?license_id=eq.${enc}&select=id`,
  );
  if (!rows.ok) {
    return null;
  }
  return rows.data.length;
}

export async function insertInstallation(
  licenseId: string,
  machineId: string,
  deviceLabel?: string,
): Promise<{ ok: true } | { ok: false; status: number; text: string }> {
  return restPost("license_installations", {
    license_id: licenseId,
    machine_id: machineId,
    device_label: deviceLabel?.trim() || null,
  });
}
