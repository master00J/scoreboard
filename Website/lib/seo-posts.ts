import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdminHeaders } from "@/lib/supabase-admin";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

export type SeoPostSection = {
  heading: string;
  body: string;
};

export type SeoPostContent = {
  intro: string;
  sections: SeoPostSection[];
  conclusion: string;
};

export type SeoPost = {
  id: string;
  created_at: string;
  published_at: string;
  week_key: string;
  slug: string;
  title: string;
  excerpt: string;
  meta_description: string;
  keywords: string[];
  content_json: SeoPostContent;
  status: "draft" | "published" | "archived";
};

type GeneratedSeoPost = {
  title: string;
  slug: string;
  excerpt: string;
  metaDescription: string;
  keywords: string[];
  intro: string;
  sections: SeoPostSection[];
  conclusion: string;
};

const SEO_TOPICS = [
  {
    title: "Scoreboard software voor kleine voetbalclubs",
    audience: "kleine en middelgrote voetbalclubs met vrijwilligers aan de wedstrijdtafel",
    angle: "hoe je met beperkte bezetting toch een professionele wedstrijddag neerzet",
  },
  {
    title: "Sponsors beter zichtbaar maken op een stadionscherm",
    audience: "clubs die lokale sponsors meer waarde willen geven",
    angle: "praktische sponsorrotatie rond prematch, rust en live wedstrijdmomenten",
  },
  {
    title: "LED boarding voor sportclubs zonder grote stadionregie",
    audience: "clubs met perimeter-, lint- of tribuneschermen",
    angle: "zones, playlists en eenvoudige playout voor lokale partners",
  },
  {
    title: "Mobiele bediening voor scorebord en wedstrijdmomenten",
    audience: "operators die sneller goals, wissels en kaarten willen bedienen",
    angle: "LAN/cloud bediening als aanvulling op de lokale wedstrijd-PC",
  },
  {
    title: "Wedstrijddag voorbereiden met digitale sponsorplanning",
    audience: "clubbestuurders en commerciële verantwoordelijken",
    angle: "hoe je sponsorafspraken omzet naar concrete schermtijd",
  },
  {
    title: "Van losse media naar een herkenbare matchday show",
    audience: "clubs die beelden, logo's en video in een vaste flow willen gebruiken",
    angle: "teams, spelers, sponsorclips en scorebord in één regieflow",
  },
];

function publicHeaders(): Record<string, string> | null {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
  };
}

function isoDateInBrussels(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function getWeeklySeoKey(date = new Date()): string {
  return isoDateInBrussels(date).slice(0, 10);
}

function topicForWeek(weekKey: string) {
  const digits = weekKey.replace(/\D/g, "");
  const n = Number(digits.slice(-6));
  return SEO_TOPICS[n % SEO_TOPICS.length];
}

function normalizeSlug(raw: string, fallback: string): string {
  const slug = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug || fallback;
}

function parseGeneratedPost(raw: string, weekKey: string): GeneratedSeoPost {
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<GeneratedSeoPost>;
  const topic = topicForWeek(weekKey);
  const title = String(parsed.title ?? topic.title).trim().slice(0, 110);
  const fallbackSlug = `arenacue-seo-${weekKey}`;
  const sections = Array.isArray(parsed.sections)
    ? parsed.sections
        .map((section) => ({
          heading: String(section?.heading ?? "").trim(),
          body: String(section?.body ?? "").trim(),
        }))
        .filter((section) => section.heading && section.body)
        .slice(0, 6)
    : [];

  return {
    title,
    slug: normalizeSlug(String(parsed.slug ?? title), fallbackSlug),
    excerpt: String(parsed.excerpt ?? "").trim().slice(0, 240),
    metaDescription: String(parsed.metaDescription ?? parsed.excerpt ?? "").trim().slice(0, 170),
    keywords: Array.isArray(parsed.keywords)
      ? parsed.keywords.map((keyword) => String(keyword).trim()).filter(Boolean).slice(0, 12)
      : [],
    intro: String(parsed.intro ?? "").trim(),
    sections,
    conclusion: String(parsed.conclusion ?? "").trim(),
  };
}

function isValidGeneratedPost(post: GeneratedSeoPost): boolean {
  return (
    post.title.length >= 12 &&
    post.excerpt.length >= 50 &&
    post.metaDescription.length >= 50 &&
    post.intro.length >= 120 &&
    post.sections.length >= 3 &&
    post.conclusion.length >= 80
  );
}

async function fetchPosts(endpoint: string, headers: Record<string, string>): Promise<SeoPost[]> {
  if (!supabaseUrl) return [];
  const response = await fetch(`${supabaseUrl}/rest/v1/seo_posts?${endpoint}`, {
    headers,
    cache: "no-store",
  });
  if (!response.ok) return [];
  return (await response.json()) as SeoPost[];
}

export async function getPublishedSeoPosts(limit = 24): Promise<SeoPost[]> {
  const headers = publicHeaders();
  if (!headers) return [];
  const endpoint =
    "select=id,created_at,published_at,week_key,slug,title,excerpt,meta_description,keywords,content_json,status" +
    "&status=eq.published&published_at=lte.now()&order=published_at.desc" +
    `&limit=${Math.max(1, Math.min(limit, 100))}`;
  return fetchPosts(endpoint, headers);
}

export async function getPublishedSeoPostBySlug(slug: string): Promise<SeoPost | null> {
  const headers = publicHeaders();
  const safeSlug = slug.trim();
  if (!headers || !safeSlug) return null;
  const endpoint =
    "select=id,created_at,published_at,week_key,slug,title,excerpt,meta_description,keywords,content_json,status" +
    `&slug=eq.${encodeURIComponent(safeSlug)}&status=eq.published&published_at=lte.now()&limit=1`;
  return (await fetchPosts(endpoint, headers))[0] ?? null;
}

export async function getSeoSitemapEntries(): Promise<Array<{ slug: string; published_at: string }>> {
  const posts = await getPublishedSeoPosts(100);
  return posts.map((post) => ({ slug: post.slug, published_at: post.published_at }));
}

async function findPostByWeekKey(weekKey: string): Promise<SeoPost | null> {
  const admin = getSupabaseAdminHeaders();
  if (!admin) return null;
  const endpoint =
    "select=id,created_at,published_at,week_key,slug,title,excerpt,meta_description,keywords,content_json,status" +
    `&week_key=eq.${encodeURIComponent(weekKey)}&limit=1`;
  return (await fetchPosts(endpoint, admin.headers))[0] ?? null;
}

export async function generateWeeklySeoPost(opts?: { force?: boolean; now?: Date }) {
  const now = opts?.now ?? new Date();
  const weekKey = getWeeklySeoKey(now);
  const existing = await findPostByWeekKey(weekKey);
  if (existing && !opts?.force) {
    return { ok: true as const, skipped: true, reason: "Deze week heeft al een SEO-artikel.", post: existing };
  }

  const admin = getSupabaseAdminHeaders();
  if (!admin) {
    return { ok: false as const, status: 503, message: "Supabase admin is niet geconfigureerd." };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false as const, status: 503, message: "ANTHROPIC_API_KEY ontbreekt." };
  }

  const topic = topicForWeek(weekKey);
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: process.env.SEO_CLAUDE_MODEL?.trim() || process.env.CLAUDE_MODEL?.trim() || "claude-haiku-4-5",
    max_tokens: 2200,
    system:
      "Je bent een Nederlandstalige SEO-copywriter voor ArenaCue. Schrijf concreet, eerlijk en commercieel bruikbaar voor Belgische/Nederlandse sportclubs. Vermijd verzonnen prijzen, klantnamen, garanties of juridische claims.",
    messages: [
      {
        role: "user",
        content: `Maak een SEO-artikel voor arenacue.be.

Onderwerp: ${topic.title}
Doelgroep: ${topic.audience}
Invalshoek: ${topic.angle}

Productcontext:
- ArenaCue is Windows-software voor scorebord, stadiondisplay, sponsorrotatie, media en optionele LED boarding.
- De live wedstrijdregie draait lokaal op de wedstrijd-PC.
- Mobiele bediening kan via LAN of cloud als extra bediening.
- Gebruik Nederlands voor Belgische sportclubs.

Geef uitsluitend geldige JSON terug met exact deze vorm:
{
  "title": "...",
  "slug": "...",
  "excerpt": "...",
  "metaDescription": "...",
  "keywords": ["...", "..."],
  "intro": "...",
  "sections": [
    { "heading": "...", "body": "..." }
  ],
  "conclusion": "..."
}

Eisen:
- title max 90 tekens
- slug lowercase met koppeltekens
- excerpt 120-200 tekens
- metaDescription 130-160 tekens
- 4 tot 5 sections
- elke body 90-180 woorden
- geen markdown, geen HTML, geen code fences`,
      },
    ],
  });

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
  const generated = parseGeneratedPost(text, weekKey);
  if (!isValidGeneratedPost(generated)) {
    return { ok: false as const, status: 502, message: "AI-output was onvolledig of ongeldig." };
  }

  const insertBody = {
    week_key: opts?.force ? `${weekKey}-${Date.now()}` : weekKey,
    slug: generated.slug,
    title: generated.title,
    excerpt: generated.excerpt,
    meta_description: generated.metaDescription,
    keywords: generated.keywords,
    content_json: {
      intro: generated.intro,
      sections: generated.sections,
      conclusion: generated.conclusion,
    },
    status: "published",
    model: response.model,
    source: "ai-cron",
    published_at: now.toISOString(),
  };

  const insert = await fetch(`${admin.url}/rest/v1/seo_posts`, {
    method: "POST",
    headers: {
      ...admin.headers,
      Prefer: "return=representation",
    },
    body: JSON.stringify(insertBody),
    cache: "no-store",
  });
  const payloadText = await insert.text();
  if (!insert.ok) {
    return {
      ok: false as const,
      status: 502,
      message: "SEO-artikel kon niet worden opgeslagen.",
      error: payloadText,
    };
  }
  const rows = JSON.parse(payloadText) as SeoPost[];
  return { ok: true as const, skipped: false, post: rows[0] };
}
