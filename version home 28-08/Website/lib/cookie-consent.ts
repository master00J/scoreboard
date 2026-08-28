export const COOKIE_CONSENT_STORAGE_KEY = "arenacue_cookie_consent_v1";

export type StoredCookieConsent = {
  v: 1;
  /** Altijd actief (technisch noodzakelijk voor deze site). */
  necessary: true;
  /** Statistiek / gebruiksmeting (nu niet geladen tenzij je dit activeert). */
  analytics: boolean;
  /** Marketing / remarketing (nu niet geladen tenzij je dit activeert). */
  marketing: boolean;
  savedAt: string;
};

export function parseStoredConsent(raw: string | null): StoredCookieConsent | null {
  if (!raw?.trim()) return null;
  try {
    const data = JSON.parse(raw) as Partial<StoredCookieConsent>;
    if (data.v !== 1 || data.necessary !== true) return null;
    return {
      v: 1,
      necessary: true,
      analytics: Boolean(data.analytics),
      marketing: Boolean(data.marketing),
      savedAt:
        typeof data.savedAt === "string" && data.savedAt.length > 0
          ? data.savedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeConsent(prefs: Omit<StoredCookieConsent, "savedAt">): StoredCookieConsent {
  const full: StoredCookieConsent = {
    ...prefs,
    savedAt: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(full));
  }
  return full;
}

/** Client-side: heeft gebruiker analytics gemarkeerd (voor eventuele Script-tags). */
export function readConsentAnalyticsAllowed(): boolean {
  if (typeof window === "undefined") return false;
  const c = parseStoredConsent(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY));
  return c?.analytics === true;
}
