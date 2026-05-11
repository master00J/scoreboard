import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { ARENACUE_KNOWLEDGE_BASE } from "@/lib/arenacue-knowledge-base";
import { checkRateLimit, readClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.CLAUDE_MODEL?.trim() || "claude-haiku-4-5";
const MAX_INPUT_LEN = 5000;
const MAX_HISTORY = 16;
const MAX_ACTIONS = 10;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type AssistantAction = {
  type: string;
  label: string;
  payload: Record<string, unknown>;
};

const SYSTEM_PROMPT = `Je bent ArenaCue LED Setup Assistent voor stadionoperators.

Je helpt met het volledig instellen van ArenaCue LED boarding: zones, outputs, perimeter, mid-tier/luifel, segmenten, playlists, sponsoritems, timing, helderheid en veilige output-checks.

Antwoord altijd in het Nederlands, concreet en kort. Je mag configuratie-acties voorstellen, maar alleen via JSON in dit exacte formaat:
{
  "message": "korte uitleg voor de operator",
  "actions": [
    { "type": "createZone", "label": "Maak zone ...", "payload": { ... } }
  ]
}

Toegestane action types:
- createZone: { name, widthPx, heightPx, processorName?, segmentId?, outputDisplayId? }
- updateZone: { zoneId, name?, widthPx?, heightPx?, processorName?, segmentId?, outputDisplayId? }
- assignZoneSegment: { zoneId, segmentId }
- createSegment: { id?, label, playbackMode?, scrollLoopDurationSec?, useGlobalSettings? }
- renameSegment: { segmentId, label }
- createTextSponsor: { label, bgColor?, textColor?, targetMinutesPerMatch? }
- setPlaylist: { segmentId, sponsorIds?, sponsorLabels?, durationSec? }
- setPlaylistDurations: { segmentId, durationSec }
- setPlaybackSettings: { playbackMode?, scrollLoopDurationSec? }
- setBrightness: { brightnessPercent }
- setFadeTransition: { fadeTransitionMs }
- linkZones: { zoneIds }

Belangrijke regels:
- Stel nooit destructive acties voor zoals alles wissen of resetten.
- Pas media/video-import niet automatisch toe; geef daar stappen voor.
- Gebruik normale stadiondefaults: perimeter vaak brede lage resolutie, mid-tier/luifel apart, sponsoritems vaak 10-15 seconden, brightness 80-100% bij test en lager bij indoor/avond indien gevraagd.
- Als informatie ontbreekt, stel een veilige basis voor en leg uit wat nog gecontroleerd moet worden.
- Geef uitsluitend geldige JSON terug. Geen Markdown, geen code fences.

Officiele ArenaCue kennisbank:
---
${ARENACUE_KNOWLEDGE_BASE}
---`;

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(request: Request) {
  const ip = readClientIp(request);
  const limit = checkRateLimit({
    key: `ledboarding-setup-ai:${ip}`,
    limit: 12,
    windowMs: 10 * 60 * 1000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Te veel AI-verzoeken. Probeer het over enkele minuten opnieuw." },
      { status: 429, headers: { ...CORS_HEADERS, "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI setupassistent is niet geconfigureerd (ANTHROPIC_API_KEY ontbreekt)." },
      { status: 503, headers: CORS_HEADERS },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON." }, { status: 400, headers: CORS_HEADERS });
  }

  const parsed = parseBody(body);
  if (!parsed) {
    return NextResponse.json(
      { error: "Verwacht { messages, snapshot } met minstens een laatste user-bericht." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1400,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            instruction:
              "Help de operator met de LED boarding setup. Geef alleen JSON terug met message en actions.",
            snapshot: parsed.snapshot,
            messages: parsed.messages,
          }),
        },
      ],
    });

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    const answer = parseAssistantAnswer(text);
    return NextResponse.json(answer, {
      headers: { ...CORS_HEADERS, "Cache-Control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Onbekende AI-fout";
    console.error("[ledboarding-setup-ai] error:", message);
    return NextResponse.json(
      { error: "De AI setupassistent kon geen antwoord ophalen. Probeer het later opnieuw." },
      { status: 502, headers: CORS_HEADERS },
    );
  }
}

function parseBody(body: unknown): { messages: ChatMessage[]; snapshot: unknown } | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as { messages?: unknown; snapshot?: unknown };
  if (!Array.isArray(raw.messages)) return null;

  const messages: ChatMessage[] = [];
  for (const item of raw.messages) {
    if (!item || typeof item !== "object") return null;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    const trimmed = content.trim();
    if (trimmed) {
      messages.push({ role, content: trimmed.slice(0, MAX_INPUT_LEN) });
    }
  }

  if (messages.length === 0 || messages[messages.length - 1]?.role !== "user") return null;
  return {
    messages: messages.slice(-MAX_HISTORY),
    snapshot: pruneSnapshot(raw.snapshot),
  };
}

function pruneSnapshot(snapshot: unknown): unknown {
  try {
    const text = JSON.stringify(snapshot ?? {});
    return JSON.parse(text.slice(0, 18_000));
  } catch {
    return {};
  }
}

function parseAssistantAnswer(text: string): { message: string; actions: AssistantAction[] } {
  try {
    const json = extractJson(text);
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== "object") throw new Error("not object");
    const obj = raw as { message?: unknown; actions?: unknown };
    const message =
      typeof obj.message === "string" && obj.message.trim()
        ? obj.message.trim().slice(0, 1600)
        : "Ik heb een voorstel gemaakt voor je LED boarding setup.";
    const actions = Array.isArray(obj.actions) ? obj.actions.map(normalizeAction).filter(Boolean) : [];
    return { message, actions: actions.slice(0, MAX_ACTIONS) as AssistantAction[] };
  } catch {
    return {
      message:
        "Ik kon geen veilig actievoorstel maken. Beschrijf kort je gewenste zones, outputs en sponsor-timing, dan probeer ik opnieuw.",
      actions: [],
    };
  }
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("json not found");
  return match[0];
}

function normalizeAction(raw: unknown): AssistantAction | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { type?: unknown; label?: unknown; payload?: unknown };
  if (typeof obj.type !== "string" || !ALLOWED_TYPES.has(obj.type)) return null;
  const payload = obj.payload && typeof obj.payload === "object" ? obj.payload as Record<string, unknown> : {};
  const clean = normalizePayload(obj.type, payload);
  if (!clean) return null;
  return {
    type: obj.type,
    label:
      typeof obj.label === "string" && obj.label.trim()
        ? obj.label.trim().slice(0, 180)
        : defaultActionLabel(obj.type),
    payload: clean,
  };
}

const ALLOWED_TYPES = new Set([
  "createZone",
  "updateZone",
  "assignZoneSegment",
  "createSegment",
  "renameSegment",
  "createTextSponsor",
  "setPlaylist",
  "setPlaylistDurations",
  "setPlaybackSettings",
  "setBrightness",
  "setFadeTransition",
  "linkZones",
]);

function normalizePayload(type: string, payload: Record<string, unknown>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const text = (key: string, max = 160) => {
    const value = payload[key];
    return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
  };
  const num = (key: string, min: number, max: number) => clampNumber(payload[key], min, max);
  const maybeBool = (key: string) => (typeof payload[key] === "boolean" ? payload[key] : undefined);

  if (type === "createZone" || type === "updateZone") {
    if (type === "updateZone") {
      const zoneId = text("zoneId", 128);
      if (!zoneId) return null;
      out.zoneId = zoneId;
    }
    const name = text("name");
    if (type === "createZone" && !name) return null;
    if (name) out.name = name;
    const widthPx = num("widthPx", 64, 32768);
    const heightPx = num("heightPx", 32, 8192);
    if (widthPx !== undefined) out.widthPx = widthPx;
    if (heightPx !== undefined) out.heightPx = heightPx;
    const processorName = text("processorName");
    const segmentId = text("segmentId", 128);
    const outputDisplayId = num("outputDisplayId", 0, 100);
    if (processorName) out.processorName = processorName;
    if (segmentId) out.segmentId = segmentId;
    if (outputDisplayId !== undefined) out.outputDisplayId = outputDisplayId;
    return out;
  }

  if (type === "assignZoneSegment") {
    const zoneId = text("zoneId", 128);
    const segmentId = text("segmentId", 128);
    if (!zoneId || !segmentId) return null;
    return { zoneId, segmentId };
  }

  if (type === "createSegment") {
    const label = text("label");
    if (!label) return null;
    out.label = label;
    const id = text("id", 80);
    if (id) out.id = id;
    if (payload.playbackMode === "hold" || payload.playbackMode === "scroll") out.playbackMode = payload.playbackMode;
    const scrollLoopDurationSec = num("scrollLoopDurationSec", 12, 240);
    if (scrollLoopDurationSec !== undefined) out.scrollLoopDurationSec = scrollLoopDurationSec;
    const useGlobalSettings = maybeBool("useGlobalSettings");
    if (useGlobalSettings !== undefined) out.useGlobalSettings = useGlobalSettings;
    return out;
  }

  if (type === "renameSegment") {
    const segmentId = text("segmentId", 128);
    const label = text("label");
    if (!segmentId || !label) return null;
    return { segmentId, label };
  }

  if (type === "createTextSponsor") {
    const label = text("label");
    if (!label) return null;
    out.label = label;
    const bgColor = hex(payload.bgColor);
    const textColor = hex(payload.textColor);
    const targetMinutesPerMatch = num("targetMinutesPerMatch", 0, 999);
    if (bgColor) out.bgColor = bgColor;
    if (textColor) out.textColor = textColor;
    if (targetMinutesPerMatch !== undefined) out.targetMinutesPerMatch = targetMinutesPerMatch;
    return out;
  }

  if (type === "setPlaylist") {
    const segmentId = text("segmentId", 128);
    if (!segmentId) return null;
    out.segmentId = segmentId;
    const sponsorIds = stringArray(payload.sponsorIds, 80, 80);
    const sponsorLabels = stringArray(payload.sponsorLabels, 80, 160);
    if (sponsorIds.length > 0) out.sponsorIds = sponsorIds;
    if (sponsorLabels.length > 0) out.sponsorLabels = sponsorLabels;
    const durationSec = num("durationSec", 2, 600);
    if (durationSec !== undefined) out.durationSec = durationSec;
    return sponsorIds.length > 0 || sponsorLabels.length > 0 ? out : null;
  }

  if (type === "setPlaylistDurations") {
    const segmentId = text("segmentId", 128);
    const durationSec = num("durationSec", 2, 600);
    if (!segmentId || durationSec === undefined) return null;
    return { segmentId, durationSec };
  }

  if (type === "setPlaybackSettings") {
    if (payload.playbackMode === "hold" || payload.playbackMode === "scroll") out.playbackMode = payload.playbackMode;
    const scrollLoopDurationSec = num("scrollLoopDurationSec", 12, 240);
    if (scrollLoopDurationSec !== undefined) out.scrollLoopDurationSec = scrollLoopDurationSec;
    return Object.keys(out).length > 0 ? out : null;
  }

  if (type === "setBrightness") {
    const brightnessPercent = num("brightnessPercent", 1, 100);
    return brightnessPercent === undefined ? null : { brightnessPercent };
  }

  if (type === "setFadeTransition") {
    const fadeTransitionMs = num("fadeTransitionMs", 0, 2000);
    return fadeTransitionMs === undefined ? null : { fadeTransitionMs };
  }

  if (type === "linkZones") {
    const zoneIds = stringArray(payload.zoneIds, 50, 128);
    return zoneIds.length > 0 ? { zoneIds } : null;
  }

  return null;
}

function defaultActionLabel(type: string): string {
  return `Voer ${type} uit`;
}

function clampNumber(value: unknown, min: number, max: number): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function hex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : undefined;
}

function stringArray(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, maxLen))
        .filter(Boolean),
    ),
  ).slice(0, maxItems);
}
