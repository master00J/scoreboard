import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_PRESET_LIMIT,
  ANNOUNCEMENT_TEXT_MAX,
  DEFAULT_DISPLAY_EXTRAS,
  announcementVisible,
  displayExtrasFromJson,
  formatCountdown,
  kickoffCountdownSeconds,
  normalizeDisplayExtras,
  serializeDisplayExtras,
} from "./display-extras";

const NOW = Date.parse("2026-10-04T14:00:00Z");
const countdown = { enabled: true, leadMinutes: 60, position: "top-right" as const };

describe("extra's op het scherm: opslag", () => {
  it("geeft de standaard bij lege of kapotte JSON", () => {
    expect(displayExtrasFromJson(null)).toEqual(DEFAULT_DISPLAY_EXTRAS);
    expect(displayExtrasFromJson("{niet json")).toEqual(DEFAULT_DISPLAY_EXTRAS);
    expect(displayExtrasFromJson("[1,2]")).toEqual(DEFAULT_DISPLAY_EXTRAS);
  });

  it("begrenst de aanlooptijd en weigert een onbekende plek", () => {
    const extras = normalizeDisplayExtras({ kickoffCountdown: { enabled: true, leadMinutes: 99999, position: "links" } });
    expect(extras.kickoffCountdown).toEqual({ enabled: true, leadMinutes: 24 * 60, position: "top-right" });
    expect(normalizeDisplayExtras({ kickoffCountdown: { leadMinutes: 0 } }).kickoffCountdown.leadMinutes).toBe(1);
  });

  it("maakt van de mededeling één regel en kapt ze af", () => {
    const extras = normalizeDisplayExtras({
      announcement: { active: true, text: "  Auto 1-ABC-123\n staat   fout  ", tone: "alert", position: "top" },
    });
    expect(extras.announcement.text).toBe("Auto 1-ABC-123 staat fout");
    expect(extras.announcement.tone).toBe("alert");
    expect(extras.announcement.position).toBe("top");
    const long = normalizeDisplayExtras({ announcement: { active: true, text: "x".repeat(500) } });
    expect(long.announcement.text).toHaveLength(ANNOUNCEMENT_TEXT_MAX);
  });

  it("kan geen lege mededeling actief zetten", () => {
    expect(normalizeDisplayExtras({ announcement: { active: true, text: "   " } }).announcement.active).toBe(false);
  });

  it("houdt bewaarde zinnen uniek en beperkt", () => {
    const presets = ["a", "a", " b ", "", 5, ...Array.from({ length: 20 }, (_, i) => `zin ${i}`)];
    const extras = normalizeDisplayExtras({ announcement: { presets } });
    expect(extras.announcement.presets.slice(0, 3)).toEqual(["a", "b", "zin 0"]);
    expect(extras.announcement.presets).toHaveLength(ANNOUNCEMENT_PRESET_LIMIT);
  });

  it("komt ongewijzigd terug na opslaan en lezen", () => {
    const extras = normalizeDisplayExtras({
      kickoffCountdown: { enabled: true, leadMinutes: 30, position: "center" },
      announcement: { active: true, text: "Volgende thuiswedstrijd zaterdag 20u", until: NOW + 60_000, presets: ["Welkom"] },
    });
    expect(displayExtrasFromJson(serializeDisplayExtras(extras))).toEqual(extras);
  });
});

describe("mededeling", () => {
  const base = normalizeDisplayExtras({ announcement: { active: true, text: "Welkom" } }).announcement;

  it("staat op het scherm tot de operator stopt", () => {
    expect(announcementVisible(base, NOW)).toBe(true);
    expect(announcementVisible({ ...base, active: false }, NOW)).toBe(false);
  });

  it("verdwijnt vanzelf na de ingestelde tijd", () => {
    expect(announcementVisible({ ...base, until: NOW + 1 }, NOW)).toBe(true);
    expect(announcementVisible({ ...base, until: NOW }, NOW)).toBe(false);
  });
});

describe("aftelklok naar de start", () => {
  const kickoffAt = new Date(NOW + 20 * 60_000).toISOString();

  it("telt af binnen de aanlooptijd", () => {
    expect(kickoffCountdownSeconds({ settings: countdown, kickoffAt, status: "PREMATCH", now: NOW })).toBe(1200);
    expect(kickoffCountdownSeconds({ settings: countdown, kickoffAt, status: "SETUP", now: NOW })).toBe(1200);
  });

  it("blijft weg als ze uit staat, er geen uur is of de wedstrijd bezig is", () => {
    expect(kickoffCountdownSeconds({ settings: { ...countdown, enabled: false }, kickoffAt, status: "PREMATCH", now: NOW })).toBeNull();
    expect(kickoffCountdownSeconds({ settings: countdown, kickoffAt: null, status: "PREMATCH", now: NOW })).toBeNull();
    expect(kickoffCountdownSeconds({ settings: countdown, kickoffAt: "geen datum", status: "PREMATCH", now: NOW })).toBeNull();
    expect(kickoffCountdownSeconds({ settings: countdown, kickoffAt, status: "FIRST_HALF", now: NOW })).toBeNull();
    expect(kickoffCountdownSeconds({ settings: countdown, kickoffAt, status: "PREMATCH", closedAt: kickoffAt, now: NOW })).toBeNull();
  });

  it("verschijnt pas binnen de aanlooptijd en verdwijnt op het uur zelf", () => {
    const far = new Date(NOW + 61 * 60_000).toISOString();
    expect(kickoffCountdownSeconds({ settings: countdown, kickoffAt: far, status: "PREMATCH", now: NOW })).toBeNull();
    expect(kickoffCountdownSeconds({ settings: countdown, kickoffAt: new Date(NOW).toISOString(), status: "PREMATCH", now: NOW })).toBeNull();
    expect(kickoffCountdownSeconds({ settings: countdown, kickoffAt: new Date(NOW + 400).toISOString(), status: "PREMATCH", now: NOW })).toBe(1);
  });

  it("schrijft de tijd leesbaar", () => {
    expect(formatCountdown(1200)).toBe("20:00");
    expect(formatCountdown(59)).toBe("00:59");
    expect(formatCountdown(3723)).toBe("1:02:03");
    expect(formatCountdown(-5)).toBe("00:00");
  });
});
