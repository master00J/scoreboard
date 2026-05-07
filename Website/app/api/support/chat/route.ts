import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { ARENACUE_KNOWLEDGE_BASE } from "@/lib/arenacue-knowledge-base";
import { checkRateLimit, readClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.CLAUDE_MODEL?.trim() || "claude-haiku-4-5";
const MAX_INPUT_LEN = 4000;
const MAX_HISTORY = 24;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const SYSTEM_PROMPT = `Je bent ArenaCue Support, een vriendelijke en deskundige assistent voor klanten en geinteresseerden van ArenaCue. Je helpt mensen vanuit de ArenaCue-website (arenacue.be).

Antwoord altijd:
- in het Nederlands (tenzij de gebruiker duidelijk in een andere taal schrijft);
- bondig en concreet, met praktische stappen wanneer relevant;
- in een professionele maar warme toon;
- zonder verzonnen feiten - als je iets niet zeker weet uit onderstaande kennisbank, zeg dat eerlijk en verwijs naar info@arenacue.be voor commerciele, juridische of niet-gedocumenteerde vragen;
- zonder code-voorbeelden tenzij iemand er expliciet om vraagt;
- gebruik korte alineas en eventueel bullets, geen lange muren tekst.

Je kent ArenaCue grondig - hieronder vind je de officiele kennisbank. Baseer je antwoorden hierop:

---
${ARENACUE_KNOWLEDGE_BASE}
---

Als de vraag over prijzen, contracten, demo-toegang, refunds, of iets juridisch gaat, verwijs naar info@arenacue.be of het demo-formulier op arenacue.be.
Als iemand een bug of crash rapporteert: vraag om versie en Windows-versie en verwijs door naar info@arenacue.be met logbestanden uit %APPDATA%/ArenaCue.
Niet hallucineren over features die niet in de kennisbank staan.`;

export async function POST(request: Request) {
  const ip = readClientIp(request);
  const limit = checkRateLimit({
    key: `support-chat:${ip}`,
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Te veel chatverzoeken. Probeer het over enkele minuten opnieuw." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is niet geconfigureerd voor live chat (ANTHROPIC_API_KEY ontbreekt)." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON." }, { status: 400 });
  }

  const messages = parseMessages(body);
  if (!messages) {
    return NextResponse.json(
      { error: "Verwacht { messages: [{ role, content }, ...] }." },
      { status: 400 },
    );
  }

  const trimmed = messages.slice(-MAX_HISTORY).map((m) => ({
    role: m.role,
    content: m.content.slice(0, MAX_INPUT_LEN),
  }));

  if (trimmed.length === 0 || trimmed[trimmed.length - 1].role !== "user") {
    return NextResponse.json(
      { error: "Het laatste bericht moet van de gebruiker zijn." },
      { status: 400 },
    );
  }

  const client = new Anthropic({ apiKey });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const upstream = await client.messages.stream({
          model: MODEL,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: trimmed,
        });

        for await (const event of upstream) {
          if (event.type === "content_block_delta") {
            const delta = event.delta;
            if (delta.type === "text_delta" && delta.text) {
              controller.enqueue(encoder.encode(delta.text));
            }
          }
        }
        controller.close();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Onbekende fout in support chat";
        controller.enqueue(
          encoder.encode(
            `\n\n[Er ging iets mis bij het ophalen van een antwoord. Probeer het later opnieuw of mail info@arenacue.be.]`,
          ),
        );
        console.error("[support-chat] stream error:", message);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function parseMessages(body: unknown): ChatMessage[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { messages?: unknown }).messages;
  if (!Array.isArray(raw)) return null;
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      return null;
    }
    const trimmed = content.trim();
    if (!trimmed) continue;
    out.push({ role, content: trimmed });
  }
  return out;
}
