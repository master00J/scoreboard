import type { AppReleasePayload } from "@/lib/app-release";
import { getSupabaseAdminHeaders } from "@/lib/supabase-admin";

export type AppReleaseNotificationRow = {
  id: string;
  created_at: string;
  started_at: string;
  sent_at: string | null;
  version: string;
  status: "sending" | "sent" | "failed";
  release_payload: AppReleasePayload | null;
  recipient_count: number;
  sent: number;
  failed: number;
  errors: string[] | null;
};

type SupabaseError = {
  ok: false;
  status: number;
  text: string;
};

function normalizeVersion(version: string): string {
  return version.trim();
}

async function restGet<T>(path: string): Promise<{ ok: true; data: T } | SupabaseError> {
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

async function restPost<T>(
  path: string,
  body: unknown,
): Promise<{ ok: true; data: T } | SupabaseError> {
  const admin = getSupabaseAdminHeaders();
  if (!admin) {
    return { ok: false, status: 503, text: "not_configured" };
  }
  const res = await fetch(`${admin.url}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...admin.headers, Prefer: "return=representation" },
    body: JSON.stringify(body),
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

async function restPatch(
  path: string,
  body: unknown,
): Promise<{ ok: true } | SupabaseError> {
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

export async function getAppReleaseNotification(
  version: string,
): Promise<{ ok: true; row: AppReleaseNotificationRow | null } | SupabaseError> {
  const encoded = encodeURIComponent(normalizeVersion(version));
  const r = await restGet<AppReleaseNotificationRow[]>(
    `app_release_notifications?version=eq.${encoded}&select=*&limit=1`,
  );
  if (!r.ok) {
    return r;
  }
  return { ok: true, row: r.data[0] ?? null };
}

export async function reserveAppReleaseNotification(opts: {
  version: string;
  release: AppReleasePayload;
}): Promise<
  | { ok: true; reserved: true; row: AppReleaseNotificationRow }
  | { ok: true; reserved: false; row: AppReleaseNotificationRow | null }
  | SupabaseError
> {
  const version = normalizeVersion(opts.version);
  const created = await restPost<AppReleaseNotificationRow[]>("app_release_notifications", {
    version,
    status: "sending",
    release_payload: opts.release,
  });

  if (created.ok) {
    return { ok: true, reserved: true, row: created.data[0] };
  }

  if (created.status !== 409) {
    return created;
  }

  const existing = await getAppReleaseNotification(version);
  if (!existing.ok) {
    return existing;
  }
  return { ok: true, reserved: false, row: existing.row };
}

export async function completeAppReleaseNotification(opts: {
  version: string;
  status: "sent" | "failed";
  recipientCount: number;
  sent: number;
  failed: number;
  errors: string[];
}): Promise<{ ok: true } | SupabaseError> {
  const encoded = encodeURIComponent(normalizeVersion(opts.version));
  return restPatch(`app_release_notifications?version=eq.${encoded}`, {
    status: opts.status,
    sent_at: new Date().toISOString(),
    recipient_count: opts.recipientCount,
    sent: opts.sent,
    failed: opts.failed,
    errors: opts.errors.length > 0 ? opts.errors : null,
  });
}
