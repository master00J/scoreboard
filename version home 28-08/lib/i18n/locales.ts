export const UI_LOCALES = ["nl", "en", "fr"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];
export const DEFAULT_LOCALE: UiLocale = "nl";

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value);
}

export function normalizeUiLocale(value: unknown): UiLocale {
  return isUiLocale(value) ? value : DEFAULT_LOCALE;
}
