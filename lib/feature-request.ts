/**
 * Feature-aanvraag vanuit het bedieningspaneel → arenacue.be (`POST /api/app/feature-request`).
 * De licentiesleutel en machine-id komen er in het main-proces bij; de renderer ziet ze niet.
 */

export const FEATURE_REQUEST_MIN_CHARS = 10;
export const FEATURE_REQUEST_MAX_CHARS = 2000;
export const FEATURE_REQUEST_MAX_PHOTOS = 3;
/**
 * Max lengte van de data-URL (base64) per foto. Drie foto's samen blijven zo onder de 4,5 MB
 * die Vercel per verzoek toelaat; daarboven weigert Vercel de aanvraag nog vóór de site ze ziet.
 */
export const FEATURE_REQUEST_MAX_PHOTO_DATA_CHARS = 1_200_000;
export const FEATURE_REQUEST_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const LOCALES = ["nl", "en", "fr", "it"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHOTO_DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,[A-Za-z0-9+/]+={0,2}$/;

export type FeatureRequestPhotoMime = (typeof FEATURE_REQUEST_PHOTO_MIME_TYPES)[number];

export type FeatureRequestPhoto = {
  name: string;
  mimeType: FeatureRequestPhotoMime;
  dataUrl: string;
};

/** Wat het bedieningspaneel instuurt; het main-proces valideert dit nog. */
export type FeatureRequestDraft = {
  text: string;
  contactEmail?: string;
  locale?: string;
  photos?: FeatureRequestPhoto[];
};

export type FeatureRequestInput = {
  text: string;
  contactEmail?: string;
  locale?: (typeof LOCALES)[number];
  photos?: FeatureRequestPhoto[];
};

export type FeatureRequestFailure = "invalid" | "license" | "rate_limited" | "network" | "server";

export type FeatureReply = {
  outcome: "exists" | "already_requested";
  title: string;
  where: string;
  summary: string;
};

export type FeatureRequestResult =
  | { ok: true; outcome: "accepted" }
  | ({ ok: true } & FeatureReply)
  | { ok: false; reason: FeatureRequestFailure };

function replyFromRecord(rec: Record<string, unknown>): FeatureReply | null {
  if (rec.outcome !== "exists" && rec.outcome !== "already_requested") return null;
  const title = typeof rec.title === "string" ? rec.title.trim() : "";
  const where = typeof rec.where === "string" ? rec.where.trim() : "";
  const summary = typeof rec.summary === "string" ? rec.summary.trim() : "";
  if (!title || !where || !summary) return null;
  return { outcome: rec.outcome, title, where, summary };
}

function defaultPhotoName(mimeType: FeatureRequestPhotoMime): string {
  if (mimeType === "image/png") return "photo.png";
  if (mimeType === "image/webp") return "photo.webp";
  return "photo.jpg";
}

/** Bestandsnaam zonder pad; leeg of ongeldig valt terug op een default. */
export function sanitizeFeatureRequestPhotoName(raw: unknown, mimeType: FeatureRequestPhotoMime): string {
  const base = typeof raw === "string" ? raw.trim() : "";
  const leaf = base.split(/[/\\]/).pop() ?? "";
  const cleaned = leaf.replace(/[^\w.\- ()[\]]+/g, "").replace(/^\.+/, "").trim();
  const name = cleaned.slice(0, 80);
  return name || defaultPhotoName(mimeType);
}

/** Valideert één foto; `null` bij verkeerd type, te grote data-URL of geen base64. */
export function normalizeFeatureRequestPhoto(raw: unknown): FeatureRequestPhoto | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const dataUrl = typeof rec.dataUrl === "string" ? rec.dataUrl.trim() : "";
  if (dataUrl.length < 32 || dataUrl.length > FEATURE_REQUEST_MAX_PHOTO_DATA_CHARS) return null;
  const match = PHOTO_DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1] as FeatureRequestPhotoMime;
  if (typeof rec.mimeType === "string" && rec.mimeType.trim() && rec.mimeType.trim() !== mimeType) {
    return null;
  }
  return { name: sanitizeFeatureRequestPhotoName(rec.name, mimeType), mimeType, dataUrl };
}

function normalizeFeatureRequestPhotos(raw: unknown): FeatureRequestPhoto[] | null | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > FEATURE_REQUEST_MAX_PHOTOS) return null;
  if (raw.length === 0) return undefined;
  const photos: FeatureRequestPhoto[] = [];
  for (const item of raw) {
    const photo = normalizeFeatureRequestPhoto(item);
    if (!photo) return null;
    photos.push(photo);
  }
  return photos;
}

/** Valideert wat de renderer stuurt; `null` bij te korte/lange tekst, ongeldig e-mail of foto's. */
export function normalizeFeatureRequestInput(raw: unknown): FeatureRequestInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const text = typeof rec.text === "string" ? rec.text.trim() : "";
  if (text.length < FEATURE_REQUEST_MIN_CHARS || text.length > FEATURE_REQUEST_MAX_CHARS) return null;

  const email = typeof rec.contactEmail === "string" ? rec.contactEmail.trim().toLowerCase() : "";
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) return null;

  const photos = normalizeFeatureRequestPhotos(rec.photos);
  if (photos === null) return null;

  // i18next kan "nl-BE" geven; de site kent alleen de vier app-talen.
  const lang = typeof rec.locale === "string" ? rec.locale.trim().toLowerCase().slice(0, 2) : "";
  const locale = LOCALES.find((code) => code === lang);

  return {
    text,
    ...(email ? { contactEmail: email } : {}),
    ...(locale ? { locale } : {}),
    ...(photos ? { photos } : {}),
  };
}

/** Vertaalt het antwoord van de site naar een reden die het bedieningspaneel kan tonen. */
export function featureRequestResultFromResponse(status: number, json: unknown): FeatureRequestResult {
  const rec = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  if (status >= 200 && status < 300 && rec.ok === true) {
    const reply = replyFromRecord(rec);
    return reply ? { ok: true, ...reply } : { ok: true, outcome: "accepted" };
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
