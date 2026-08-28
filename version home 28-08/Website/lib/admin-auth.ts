import { SignJWT, jwtVerify } from "jose";

export const ADMIN_COOKIE_NAME = "arenacue_admin";

function readSecret(): Uint8Array | null {
  const s = process.env.ADMIN_SESSION_SECRET?.trim();
  if (!s || s.length < 24) {
    return null;
  }
  return new TextEncoder().encode(s);
}

export async function signAdminToken(): Promise<string> {
  const raw = readSecret();
  if (!raw) {
    throw new Error("ADMIN_SESSION_SECRET ontbreekt of is te kort (min. 24 tekens).");
  }
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(raw);
}

export async function verifyAdminToken(token: string | undefined): Promise<boolean> {
  if (!token) {
    return false;
  }
  const raw = readSecret();
  if (!raw) {
    return false;
  }
  try {
    await jwtVerify(token, raw);
    return true;
  } catch {
    return false;
  }
}

export function isAdminSessionConfigured(): boolean {
  return readSecret() !== null;
}
