/**
 * Feature-aanvraag vanuit het bedieningspaneel → arenacue.be (`POST /api/app/feature-request`).
 * De licentiesleutel en machine-id komen er in het main-proces bij; de renderer ziet ze niet.
 */

export const FEATURE_REQUEST_MIN_CHARS = 10;
export const FEATURE_REQUEST_MAX_CHARS = 2000;

const LOCALES = ["nl", "en", "fr", "it"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Wat het bedieningspaneel instuurt; het main-proces valideert dit nog. */
export type FeatureRequestDraft = {
  text: string;
  contactEmail?: string;
  locale?: string;
};

export type FeatureRequestInput = {
  text: string;
  contactEmail?: string;
  locale?: (typeof LOCALES)[number];
};

export type FeatureRequestFailure = "invalid" | "license" | "rate_limited" | "network" | "server";

export type FeatureRequestResult = { ok: true } | { ok: false; reason: FeatureRequestFailure };

/** Valideert wat de renderer stuurt; `null` bij te korte/lange tekst of een ongeldig e-mailadres. */
export function normalizeFeatureRequestInput(raw: unknown): FeatureRequestInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const text = typeof rec.text === "string" ? rec.text.trim() : "";
  if (text.length < FEATURE_REQUEST_MIN_CHARS || text.length > FEATURE_REQUEST_MAX_CHARS) return null;

  const email = typeof rec.contactEmail === "string" ? rec.contactEmail.trim().toLowerCase() : "";
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) return null;

  // i18next kan "nl-BE" geven; de site kent alleen de vier app-talen.
  const lang = typeof rec.locale === "string" ? rec.locale.trim().toLowerCase().slice(0, 2) : "";
  const locale = LOCALES.find((code) => code === lang);

  return { text, ...(email ? { contactEmail: email } : {}), ...(locale ? { locale } : {}) };
}

/** Vertaalt het antwoord van de site naar een reden die het bedieningspaneel kan tonen. */
export function featureRequestResultFromResponse(status: number, json: unknown): FeatureRequestResult {
  const rec = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  if (status >= 200 && status < 300 && rec.ok === true) {
    return { ok: true };
  }
  const reason = rec.reason;
  if (reason === "invalid" || reason === "license" || reason === "rate_limited") {
    return { ok: false, reason };
  }
  if (status === 429) return { ok: false, reason: "rate_limited" };
  if (status === 400 || status === 422) return { ok: false, reason: "invalid" };
  if (status === 401 || status === 403) return { ok: false, reason: "license" };
  return { ok: false, reason: "server" };
}
