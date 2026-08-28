import { NextResponse } from "next/server";
import { validateReview } from "@/lib/review";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

export async function GET() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ ok: true, reviews: [] });
  }

  const endpoint =
    `${supabaseUrl}/rest/v1/reviews?` +
    "select=id,created_at,name,club,role,rating,quote&status=in.(published,approved)&order=created_at.desc&limit=12";

  const response = await fetch(endpoint, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return NextResponse.json({ ok: false, message: "Reviews ophalen mislukt." }, { status: 502 });
  }

  const rows = await response.json();
  return NextResponse.json({ ok: true, reviews: rows });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Ongeldige aanvraag." }, { status: 400 });
  }

  const parsed = validateReview(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, message: "Controleer de velden.", errors: parsed.errors },
      { status: 422 },
    );
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ ok: false, message: "Reviews zijn nog niet geconfigureerd." }, { status: 503 });
  }

  const insertResponse = await fetch(`${supabaseUrl}/rest/v1/reviews`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      name: parsed.value.name,
      club: parsed.value.club,
      role: parsed.value.role || null,
      rating: parsed.value.rating,
      quote: parsed.value.quote,
      status: "new",
      source: "website",
    }),
  });

  if (!insertResponse.ok) {
    return NextResponse.json(
      { ok: false, message: "Review kon niet worden opgeslagen. Probeer later opnieuw." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
