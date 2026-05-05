import { SignJWT, jwtVerify } from "jose";

export const PORTAL_COOKIE_NAME = "arenacue_portal";

/** Minimaal 24 tekens; zo niet ingesteld: fallback op ADMIN_SESSION_SECRET. */
function readSecret(): Uint8Array | null {
  const s =
    process.env.PORTAL_SESSION_SECRET?.trim() || process.env.ADMIN_SESSION_SECRET?.trim();
  if (!s || s.length < 24) {
    return null;
  }
  return new TextEncoder().encode(s);
}

export function isPortalAuthConfigured(): boolean {
  return readSecret() !== null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function signPortalMagicToken(email: string): Promise<string> {
  const raw = readSecret();
  if (!raw) {
    throw new Error("PORTAL_SESSION_SECRET of ADMIN_SESSION_SECRET ontbreekt of is te kort (min. 24 tekens).");
  }
  const em = normalizeEmail(email);
  return new SignJWT({ purpose: "portal_magic", email: em })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(raw);
}

export async function verifyPortalMagicToken(token: string | undefined): Promise<string | null> {
  if (!token?.trim()) return null;
  const raw = readSecret();
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(token.trim(), raw);
    if (payload.purpose !== "portal_magic" || typeof payload.email !== "string") {
      return null;
    }
    return normalizeEmail(payload.email);
  } catch {
    return null;
  }
}

export async function signPortalSessionToken(email: string): Promise<string> {
  const raw = readSecret();
  if (!raw) {
    throw new Error("PORTAL_SESSION_SECRET of ADMIN_SESSION_SECRET ontbreekt of is te kort (min. 24 tekens).");
  }
  const em = normalizeEmail(email);
  return new SignJWT({ purpose: "portal_session", email: em })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(raw);
}

export async function verifyPortalSessionToken(token: string | undefined): Promise<string | null> {
  if (!token?.trim()) return null;
  const raw = readSecret();
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(token.trim(), raw);
    if (payload.purpose !== "portal_session" || typeof payload.email !== "string") {
      return null;
    }
    return normalizeEmail(payload.email);
  } catch {
    return null;
  }
}
