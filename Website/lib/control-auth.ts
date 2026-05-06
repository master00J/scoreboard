import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";

export type ControlRole = "viewer" | "operator";

type ControlClaims = {
  role: ControlRole;
  venueId: string;
};

function readSecret(): Uint8Array | null {
  const s = process.env.CONTROL_SESSION_SECRET?.trim();
  if (!s || s.length < 24) return null;
  return new TextEncoder().encode(s);
}

function readSecretText(): string | null {
  const s = process.env.CONTROL_SESSION_SECRET?.trim();
  return s && s.length >= 24 ? s : null;
}

export function isControlAuthConfigured(): boolean {
  return readSecret() !== null;
}

export async function signControlToken(claims: ControlClaims): Promise<string> {
  const secret = readSecret();
  if (!secret) {
    throw new Error("CONTROL_SESSION_SECRET ontbreekt of is te kort (min. 24 tekens).");
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret);
}

export async function verifyControlToken(token: string | undefined): Promise<ControlClaims | null> {
  if (!token) return null;
  const secret = readSecret();
  if (!secret) return null;
  try {
    const verified = await jwtVerify(token, secret);
    const role = verified.payload.role;
    const venueId = verified.payload.venueId;
    if ((role !== "viewer" && role !== "operator") || typeof venueId !== "string" || !venueId.trim()) {
      return null;
    }
    return { role, venueId: venueId.trim() };
  } catch {
    return null;
  }
}

export function readBearerToken(request: Request): string | undefined {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return undefined;
  const token = auth.slice(7).trim();
  return token || undefined;
}

export function operatorPairTokenForVenue(venueId: string): string | null {
  const secret = readSecretText();
  if (!secret || !venueId.trim()) return null;
  return crypto
    .createHmac("sha256", secret)
    .update(`operator-pair:${venueId.trim()}`)
    .digest("base64url");
}

export function verifyOperatorPairToken(venueId: string, token: string | undefined): boolean {
  const expected = operatorPairTokenForVenue(venueId);
  if (!expected || !token) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token.trim());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
