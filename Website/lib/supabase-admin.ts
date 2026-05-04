/**
 * Headers voor Supabase PostgREST met service role (alleen server-side).
 */
export function getSupabaseAdminHeaders():
  | { url: string; headers: Record<string, string> }
  | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    return null;
  }
  return {
    url,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
}
