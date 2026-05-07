import { NextResponse } from "next/server";
import { z } from "zod";
import { adminListLicensesByOwnerEmail } from "@/lib/license-admin-data";
import { getSupabaseAdminHeaders } from "@/lib/supabase-admin";
import { isPortalAuthConfigured, signPortalMagicToken } from "@/lib/portal-auth";
import { sendPortalMagicLinkEmail } from "@/lib/portal-magic-email";
import { checkRateLimit, readClientIp } from "@/lib/rate-limit";
import { getSiteUrl } from "@/lib/site-url";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email("Geef een geldig e-mailadres op."),
});

const GENERIC_OK =
  "Als dit adres bij ons bekend is, ontvang je zo een e-mail met een loginlink. Controleer ook je spamfolder.";

export async function POST(request: Request) {
  const ip = readClientIp(request);
  const ipLimit = checkRateLimit({
    key: `portal-link-ip:${ip}`,
    limit: 12,
    windowMs: 10 * 60 * 1000,
  });
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { ok: false, message: "Te veel aanvragen. Probeer later opnieuw." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSec) } },
    );
  }

  if (!getSupabaseAdminHeaders() || !isPortalAuthConfigured()) {
    return NextResponse.json(
      { ok: false, message: "Klantportaal-login is nog niet geconfigureerd op de server." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Ongeldige aanvraag." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.flatten().fieldErrors.email?.[0] ?? "Controleer het e-mailadres.";
    return NextResponse.json({ ok: false, message: first }, { status: 422 });
  }

  const email = parsed.data.email;
  const emailLimit = checkRateLimit({
    key: `portal-link-email:${email}`,
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });
  if (!emailLimit.allowed) {
    return NextResponse.json(
      { ok: true, message: GENERIC_OK },
      { status: 200, headers: { "Retry-After": String(emailLimit.retryAfterSec) } },
    );
  }

  const rows = await adminListLicensesByOwnerEmail(email);

  if (rows && rows.length > 0) {
    try {
      const token = await signPortalMagicToken(email);
      const verifyUrl = `${getSiteUrl().replace(/\/$/, "")}/api/portal/verify?token=${encodeURIComponent(token)}`;
      const sent = await sendPortalMagicLinkEmail({ email, verifyUrl });
      if (!sent.ok) {
        console.error("sendPortalMagicLinkEmail failed", sent.error);
      }
    } catch (e) {
      console.error("portal request-link error", e);
    }
  }

  return NextResponse.json({ ok: true, message: GENERIC_OK });
}
