import { NextResponse } from "next/server";
import { sendDemoRequestEmails } from "@/lib/demo-request-emails";
import { validateDemoRequest } from "@/lib/demo-request";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

  await sendDemoRequestEmails(parsed.value).catch((err) => {
    console.error("sendDemoRequestEmails unexpected error", err);
  });

  return NextResponse.json({ ok: true });
}
