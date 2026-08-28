import { getSupabaseAdminHeaders } from "@/lib/supabase-admin";
import {
  DEFAULT_LICENSE_PLAN_CODES,
  normalizeFeatureMap,
  getFeaturesForPlan,
  planDisplayNameNl,
  type LicenseFeatures,
} from "@/lib/license-plans";

export type LicensePlanRow = {
  code: string;
  created_at: string;
  updated_at: string;
  name: string;
  description: string | null;
  price_label: string | null;
  features: LicenseFeatures;
  max_activations_default: number;
  active: boolean;
  sort_order: number;
};

type SupabaseError = { ok: false; status: number; text: string };

async function restGet<T>(path: string): Promise<{ ok: true; data: T } | SupabaseError> {
  const admin = getSupabaseAdminHeaders();
  if (!admin) return { ok: false, status: 503, text: "not_configured" };
  const res = await fetch(`${admin.url}/rest/v1/${path}`, { headers: admin.headers });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, text };
  try {
    return { ok: true, data: JSON.parse(text || "[]") as T };
  } catch {
    return { ok: false, status: 502, text: "invalid_json" };
  }
}

async function restWrite(
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
): Promise<{ ok: true } | SupabaseError> {
  const admin = getSupabaseAdminHeaders();
  if (!admin) return { ok: false, status: 503, text: "not_configured" };
  const res = await fetch(`${admin.url}/rest/v1/${path}`, {
    method,
    headers: { ...admin.headers, Prefer: "return=minimal,resolution=merge-duplicates" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, text };
  return { ok: true };
}

function normalizePlanRow(row: LicensePlanRow): LicensePlanRow {
  return {
    ...row,
    features: normalizeFeatureMap(row.features),
  };
}

export function fallbackLicensePlans(): LicensePlanRow[] {
  return DEFAULT_LICENSE_PLAN_CODES.map((code, index) => ({
    code,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    name: planDisplayNameNl(code),
    description: null,
    price_label: null,
    features: getFeaturesForPlan(code),
    max_activations_default: code === "enterprise" ? 5 : code === "club" || code === "trial" ? 2 : 1,
    active: true,
    sort_order: (index + 1) * 10,
  }));
}

export async function adminListLicensePlans(): Promise<LicensePlanRow[] | null> {
  const r = await restGet<LicensePlanRow[]>(
    "license_plans?select=*&order=sort_order.asc,code.asc",
  );
  if (!r.ok) return null;
  return r.data.map(normalizePlanRow);
}

export async function adminListActiveLicensePlans(): Promise<LicensePlanRow[]> {
  const rows = await adminListLicensePlans();
  const active = (rows ?? []).filter((row) => row.active);
  return active.length > 0 ? active : fallbackLicensePlans();
}

export async function adminGetLicensePlan(code: string): Promise<LicensePlanRow | null> {
  const enc = encodeURIComponent(code.trim().toLowerCase());
  const r = await restGet<LicensePlanRow[]>(`license_plans?code=eq.${enc}&select=*&limit=1`);
  if (!r.ok) return null;
  return r.data[0] ? normalizePlanRow(r.data[0]) : null;
}

export async function adminUpsertLicensePlan(row: {
  code: string;
  name: string;
  description: string | null;
  price_label: string | null;
  features: LicenseFeatures;
  max_activations_default: number;
  active: boolean;
  sort_order: number;
}): Promise<{ ok: true } | SupabaseError> {
  return restWrite("POST", "license_plans?on_conflict=code", {
    code: row.code,
    name: row.name,
    description: row.description,
    price_label: row.price_label,
    features: normalizeFeatureMap(row.features),
    max_activations_default: row.max_activations_default,
    active: row.active,
    sort_order: row.sort_order,
    updated_at: new Date().toISOString(),
  });
}

export async function adminUpdateLicensePlan(
  code: string,
  patch: Partial<{
    name: string;
    description: string | null;
    price_label: string | null;
    features: LicenseFeatures;
    max_activations_default: number;
    active: boolean;
    sort_order: number;
  }>,
): Promise<{ ok: true } | SupabaseError> {
  const enc = encodeURIComponent(code.trim().toLowerCase());
  return restWrite("PATCH", `license_plans?code=eq.${enc}`, {
    ...patch,
    ...(patch.features ? { features: normalizeFeatureMap(patch.features) } : {}),
    updated_at: new Date().toISOString(),
  });
}
