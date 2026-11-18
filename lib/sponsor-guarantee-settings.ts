/**
 * Instellingen van de operator voor sponsorgaranties, als JSON in `AppSettings.sponsorGuaranteeJson`.
 *
 * - `countManualPlays`: telt een sponsorclip die de operator met de hand start mee voor de
 *   geboekte tijd van die sponsor? Standaard niet: zo blijven de totalen zoals vroeger, toen
 *   handmatige clips helemaal niet geteld werden. Ze worden wel altijd bewaard.
 * - `reserveSec`: seconden per fase die de live-weergave achterhoudt voor onderbrekingen
 *   (goal, kaart, wissel). Een sponsor is "in gevaar" als hij meer tegoed heeft dan de fase
 *   nog kan geven na die reserve.
 */

export type SponsorGuaranteeSettings = {
  countManualPlays: boolean;
  reserveSec: number;
};

export const DEFAULT_SPONSOR_RESERVE_SEC = 60;
export const MAX_SPONSOR_RESERVE_SEC = 900;

export function defaultSponsorGuaranteeSettings(): SponsorGuaranteeSettings {
  return { countManualPlays: false, reserveSec: DEFAULT_SPONSOR_RESERVE_SEC };
}

export function normalizeSponsorReserveSec(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SPONSOR_RESERVE_SEC;
  return Math.max(0, Math.min(MAX_SPONSOR_RESERVE_SEC, Math.round(n)));
}

export function parseSponsorGuaranteeSettings(raw: string | null | undefined): SponsorGuaranteeSettings {
  const base = defaultSponsorGuaranteeSettings();
  if (!raw) return base;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== "object") return base;
    return {
      countManualPlays: o.countManualPlays === true,
      reserveSec: "reserveSec" in o ? normalizeSponsorReserveSec(o.reserveSec) : base.reserveSec,
    };
  } catch {
    return base;
  }
}

export function serializeSponsorGuaranteeSettings(s: Partial<SponsorGuaranteeSettings>): string {
  const base = defaultSponsorGuaranteeSettings();
  return JSON.stringify({
    countManualPlays: s.countManualPlays === true,
    reserveSec: s.reserveSec == null ? base.reserveSec : normalizeSponsorReserveSec(s.reserveSec),
  });
}
