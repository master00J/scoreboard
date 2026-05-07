type Entry = {
  hits: number;
  resetAtMs: number;
};

const buckets = new Map<string, Entry>();

function nowMs(): number {
  return Date.now();
}

export function readClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const fromForwarded = forwarded
    .split(",")
    .map((v) => v.trim())
    .find((v) => v.length > 0);
  if (fromForwarded) return fromForwarded;
  const realIp = (request.headers.get("x-real-ip") ?? "").trim();
  if (realIp) return realIp;
  return "unknown";
}

/**
 * Eenvoudige in-memory limiter voor serverless/node runtime.
 * Niet distributed, maar voldoende als eerste abuse-rem op single deployment.
 */
export function checkRateLimit(opts: {
  key: string;
  limit: number;
  windowMs: number;
}): { allowed: boolean; retryAfterSec: number } {
  const t = nowMs();
  const existing = buckets.get(opts.key);
  if (!existing || existing.resetAtMs <= t) {
    buckets.set(opts.key, { hits: 1, resetAtMs: t + opts.windowMs });
    return { allowed: true, retryAfterSec: Math.ceil(opts.windowMs / 1000) };
  }
  existing.hits += 1;
  buckets.set(opts.key, existing);
  const retryAfterSec = Math.max(1, Math.ceil((existing.resetAtMs - t) / 1000));
  return { allowed: existing.hits <= opts.limit, retryAfterSec };
}

