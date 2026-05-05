import { NextResponse } from "next/server";
import {
  adminAnyWebsiteDemoLicenseForOwnerEmail,
  adminDemoRequestExistsForEmail,
} from "@/lib/license-admin-data";
import { getSupabaseAdminHeaders } from "@/lib/supabase-admin";
import { provisionWebsiteDemoLicense } from "@/lib/demo-license-provision";
import { sendDemoRequestEmails, type DemoRequestEmailExtras } from "@/lib/demo-request-emails";
import { validateDemoRequest } from "@/lib/demo-request";
import { getSiteUrl } from "@/lib/site-url";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const DEMO_DUPLICATE_MSG =
  "Er is al een demo-aanvraag voor dit e-mailadres. Voor verlenging of een volledige licentie: neem contact op via info@arenacue.be.";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Ongeldige aanvraag." },
      { status: 400 },
    );
  }

  const parsed = validateDemoRequest(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, message: "Controleer de velden.", errors: parsed.errors },
      { status: 422 },
    );
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      {
        ok: false,
        message: "Demo-aanvragen zijn nog niet geconfigureerd.",
      },
      { status: 503 },
    );
  }

  const emailLower = parsed.value.email.trim().toLowerCase();

  if (getSupabaseAdminHeaders()) {
    const [hasReq, hasLic] = await Promise.all([
      adminDemoRequestExistsForEmail(emailLower),
      adminAnyWebsiteDemoLicenseForOwnerEmail(emailLower),
    ]);
    if (hasReq === null || hasLic === null) {
      return NextResponse.json(
        { ok: false, message: "Kon je aanvraag niet controleren. Probeer later opnieuw." },
        { status: 503 },
      );
    }
    if (hasReq || hasLic) {
      return NextResponse.json({ ok: false, message: DEMO_DUPLICATE_MSG }, { status: 422 });
    }
  }

  const insertResponse = await fetch(`${supabaseUrl}/rest/v1/demo_requests`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      name: parsed.value.name,
      email: parsed.value.email,
      club: parsed.value.club,
      phone: parsed.value.phone || null,
      message: parsed.value.message || null,
      source: "website",
    }),
  });

  if (!insertResponse.ok) {
    if (insertResponse.status === 409) {
      return NextResponse.json({ ok: false, message: DEMO_DUPLICATE_MSG }, { status: 422 });
    }
    const details = await insertResponse.text().catch(() => "");
    console.error("Supabase demo_requests insert failed", {
      status: insertResponse.status,
      details,
    });
    return NextResponse.json(
      {
        ok: false,
        message: "Aanvraag kon niet worden opgeslagen. Probeer later opnieuw.",
      },
      { status: 502 },
    );
  }

  let emailExtras: DemoRequestEmailExtras | undefined;
  try {
    const prov = await provisionWebsiteDemoLicense({
      ownerEmail: parsed.value.email,
      organizationLabel: parsed.value.club.trim() || parsed.value.name.trim(),
    });
    if (prov) {
      emailExtras = {
        licenseKey: prov.licenseKey,
        portalUrl: `${getSiteUrl().replace(/\/$/, "")}/portal`,
      };
    }
  } catch (err) {
    console.error("provisionWebsiteDemoLicense unexpected error", err);
  }

  await sendDemoRequestEmails(parsed.value, emailExtras).catch((err) => {
    console.error("sendDemoRequestEmails unexpected error", err);
  });

  return NextResponse.json({ ok: true });
}
