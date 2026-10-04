/**
 * Extra's die los van de indeling op het stadionscherm komen: de aftelklok naar de start van de
 * wedstrijd en een mededeling van de operator. Bewaard als JSON in `AppSettings.displayExtrasJson`.
 */

export const COUNTDOWN_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right", "center"] as const;
export type CountdownPosition = (typeof COUNTDOWN_POSITIONS)[number];

export const COUNTDOWN_LEAD_MINUTES = [15, 30, 60, 120] as const;
export const COUNTDOWN_LEAD_MIN = 1;
export const COUNTDOWN_LEAD_MAX = 24 * 60;

export type KickoffCountdownSettings = {
  enabled: boolean;
  /** Zoveel minuten vóór het geplande uur verschijnt de klok. */
  leadMinutes: number;
  position: CountdownPosition;
};

export const ANNOUNCEMENT_TEXT_MAX = 200;
export const ANNOUNCEMENT_PRESET_LIMIT = 8;
/** Keuzes in seconden; 0 = tot de operator stopt. */
export const ANNOUNCEMENT_DURATIONS_SEC = [0, 30, 60, 120, 300] as const;

export type AnnouncementPosition = "top" | "bottom";
/** `alert` = rode band voor iets dat meteen aandacht vraagt. */
export type AnnouncementTone = "neutral" | "alert";

export type Announcement = {
  active: boolean;
  text: string;
  position: AnnouncementPosition;
  tone: AnnouncementTone;
  /** Tijdstip (ms sinds 1970) waarop de mededeling vanzelf verdwijnt; null = tot de operator stopt. */
  until: number | null;
  /** Bewaarde zinnen om snel opnieuw te tonen. */
  presets: string[];
};

export type DisplayExtras = {
  kickoffCountdown: KickoffCountdownSettings;
  announcement: Announcement;
};

export const DEFAULT_DISPLAY_EXTRAS: DisplayExtras = {
  kickoffCountdown: { enabled: false, leadMinutes: 60, position: "top-right" },
  announcement: { active: false, text: "", position: "bottom", tone: "neutral", until: null, presets: [] },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Eén regel tekst: geen regeleinden of dubbele spaties, niet langer dan het maximum. */
export function cleanAnnouncementText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, ANNOUNCEMENT_TEXT_MAX);
}

export function normalizeDisplayExtras(raw: unknown): DisplayExtras {
  const rec = asRecord(raw);
  const countdown = asRecord(rec.kickoffCountdown);
  const announcement = asRecord(rec.announcement);

  const lead = Number(countdown.leadMinutes);
  const position = COUNTDOWN_POSITIONS.includes(countdown.position as CountdownPosition)
    ? (countdown.position as CountdownPosition)
    : DEFAULT_DISPLAY_EXTRAS.kickoffCountdown.position;

  const presets: string[] = [];
  if (Array.isArray(announcement.presets)) {
    for (const item of announcement.presets) {
      const text = cleanAnnouncementText(item);
      if (text && !presets.includes(text)) presets.push(text);
      if (presets.length >= ANNOUNCEMENT_PRESET_LIMIT) break;
    }
  }
  const text = cleanAnnouncementText(announcement.text);
  const until = Number(announcement.until);

  return {
    kickoffCountdown: {
      enabled: countdown.enabled === true,
      leadMinutes: Number.isFinite(lead)
        ? Math.min(COUNTDOWN_LEAD_MAX, Math.max(COUNTDOWN_LEAD_MIN, Math.round(lead)))
        : DEFAULT_DISPLAY_EXTRAS.kickoffCountdown.leadMinutes,
      position,
    },
    announcement: {
      // Zonder tekst valt er niets te tonen.
      active: announcement.active === true && text.length > 0,
      text,
      position: announcement.position === "top" ? "top" : "bottom",
      tone: announcement.tone === "alert" ? "alert" : "neutral",
      until: announcement.until != null && Number.isFinite(until) && until > 0 ? Math.round(until) : null,
      presets,
    },
  };
}

export function displayExtrasFromJson(json: string | null | undefined): DisplayExtras {
  if (!json || !json.trim()) return normalizeDisplayExtras(null);
  try {
    return normalizeDisplayExtras(JSON.parse(json));
  } catch {
    return normalizeDisplayExtras(null);
  }
}

export function serializeDisplayExtras(extras: DisplayExtras): string {
  return JSON.stringify(normalizeDisplayExtras(extras));
}

/** Staat de mededeling op dit moment op het scherm? */
export function announcementVisible(announcement: Announcement, now: number): boolean {
  if (!announcement.active || !announcement.text) return false;
  return announcement.until == null || announcement.until > now;
}

/** Wedstrijdstatussen waarin de start nog moet komen. */
const BEFORE_START = new Set(["SETUP", "PREMATCH"]);

/**
 * Seconden tot de geplande start, of null als de aftelklok nu niet hoort te staan: uitgeschakeld,
 * geen gepland uur, wedstrijd al bezig of afgesloten, nog te vroeg, of het uur is voorbij.
 */
export function kickoffCountdownSeconds(input: {
  settings: KickoffCountdownSettings;
  kickoffAt: string | Date | null | undefined;
  status: string | null | undefined;
  closedAt?: string | Date | null;
  now: number;
}): number | null {
  const { settings, kickoffAt, status, closedAt, now } = input;
  if (!settings.enabled || !kickoffAt || closedAt) return null;
  if (!status || !BEFORE_START.has(status)) return null;
  const at = kickoffAt instanceof Date ? kickoffAt.getTime() : new Date(kickoffAt).getTime();
  if (!Number.isFinite(at)) return null;
  const remaining = Math.ceil((at - now) / 1000);
  if (remaining <= 0 || remaining > settings.leadMinutes * 60) return null;
  return remaining;
}

/** "12:34" onder het uur, anders "1:02:03". */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}
