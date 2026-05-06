import { SignJWT, jwtVerify } from "jose";

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
