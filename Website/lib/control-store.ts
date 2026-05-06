import { getSupabaseAdminHeaders } from "./supabase-admin";

export type ControlCommandRow = {
  id: string;
  venue_id: string;
  command: unknown;
  status: "pending" | "done" | "failed";
  created_at: string;
};

function requireAdmin() {
  const admin = getSupabaseAdminHeaders();
  if (!admin) throw new Error("Supabase admin niet geconfigureerd.");
  return admin;
}

export async function enqueueControlCommand(venueId: string, command: unknown) {
  const { url, headers } = requireAdmin();
  const res = await fetch(`${url}/rest/v1/control_commands`, {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "return=representation",
    },
    body: JSON.stringify([{ venue_id: venueId, command, status: "pending" }]),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Command queue insert mislukt (${res.status}).`);
  const rows = (await res.json()) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

export async function listPendingCommands(venueId: string, limit = 30): Promise<ControlCommandRow[]> {
  const { url, headers } = requireAdmin();
  const capped = Math.max(1, Math.min(limit, 100));
  const endpoint =
    `${url}/rest/v1/control_commands?` +
    `select=id,venue_id,command,status,created_at&venue_id=eq.${encodeURIComponent(venueId)}` +
    `&status=eq.pending&order=created_at.asc&limit=${capped}`;
  const res = await fetch(endpoint, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`Pending commands lezen mislukt (${res.status}).`);
  return (await res.json()) as ControlCommandRow[];
}

export async function ackControlCommand(
  id: string,
  result: { ok: boolean; error?: string; result?: unknown },
) {
  const { url, headers } = requireAdmin();
  const status = result.ok ? "done" : "failed";
  const res = await fetch(`${url}/rest/v1/control_commands?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      status,
      processed_at: new Date().toISOString(),
      error_message: result.error ?? null,
      result_json: result.result ?? null,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Command ack mislukt (${res.status}).`);
}

export async function upsertControlState(venueId: string, state: unknown) {
  const { url, headers } = requireAdmin();
  const res = await fetch(`${url}/rest/v1/control_state?on_conflict=venue_id`, {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([
      { venue_id: venueId, state_json: state, updated_at: new Date().toISOString() },
    ]),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`State upsert mislukt (${res.status}).`);
}

export async function getControlState(venueId: string): Promise<unknown | null> {
  const { url, headers } = requireAdmin();
  const endpoint =
    `${url}/rest/v1/control_state?select=state_json,updated_at&venue_id=eq.${encodeURIComponent(venueId)}&limit=1`;
  const res = await fetch(endpoint, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`State ophalen mislukt (${res.status}).`);
  const rows = (await res.json()) as Array<{ state_json: unknown }>;
  return rows[0]?.state_json ?? null;
}
