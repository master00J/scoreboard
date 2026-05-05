import fs from "fs";
import path from "path";

export type CustomerChangelogEntry = {
  /** ISO-datum `YYYY-MM-DD` */
  date: string;
  /** Optioneel softwareversienummer indien van toepassing */
  version?: string | null;
  title: string;
  bullets: string[];
};

export type CustomerChangelogPayload = {
  entries: CustomerChangelogEntry[];
};

function normalizeEntry(raw: unknown): CustomerChangelogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const date = typeof o.date === "string" ? o.date.trim() : "";
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!date || !title) return null;
  const version =
    o.version == null
      ? undefined
      : typeof o.version === "string"
        ? o.version.trim() || null
        : String(o.version).trim() || null;
  const bulletsRaw = o.bullets;
  const bullets: string[] = [];
  if (Array.isArray(bulletsRaw)) {
    for (const b of bulletsRaw) {
      if (typeof b === "string" && b.trim()) bullets.push(b.trim());
    }
  }
  return { date, title, ...(version !== undefined ? { version } : {}), bullets };
}

/** Leest klant-changelog uit `data/customer-changelog.json` (nieuwste eerst aanbevolen in het bestand). */
export function getCustomerChangelog(): CustomerChangelogEntry[] {
  try {
    const p = path.join(process.cwd(), "data", "customer-changelog.json");
    const raw = fs.readFileSync(p, "utf8");
    const data = JSON.parse(raw) as CustomerChangelogPayload;
    if (!data || !Array.isArray(data.entries)) return [];
    const out: CustomerChangelogEntry[] = [];
    for (const e of data.entries) {
      const n = normalizeEntry(e);
      if (n) out.push(n);
    }
    out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return out;
  } catch {
    return [];
  }
}
