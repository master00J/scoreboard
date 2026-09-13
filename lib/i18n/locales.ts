export const UI_LOCALES = ["nl", "en", "fr", "it"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];
export const DEFAULT_LOCALE: UiLocale = "nl";

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value);
}

export function normalizeUiLocale(value: unknown): UiLocale {
  return isUiLocale(value) ? value : DEFAULT_LOCALE;
}

/** Website-iframe: `?lang=it` (of `locale`) wint van opgeslagen demo-settings. */
export function uiLocaleFromSearch(search: string): UiLocale | null {
  const q = search.startsWith("?") ? search.slice(1) : search;
  const raw = new URLSearchParams(q).get("lang") ?? new URLSearchParams(q).get("locale");
  return isUiLocale(raw) ? raw : null;
}
