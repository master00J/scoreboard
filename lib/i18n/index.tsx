"use client";

import i18n from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { DEFAULT_LOCALE, normalizeUiLocale, type UiLocale } from "./locales";
import nl from "./locales/nl.json";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import it from "./locales/it.json";

let initialized = false;

export function ensureI18n(locale: UiLocale = DEFAULT_LOCALE) {
  if (!initialized) {
    void i18n.use(initReactI18next).init({
      resources: {
        nl: { translation: nl },
        en: { translation: en },
        fr: { translation: fr },
        it: { translation: it },
      },
      lng: locale,
      fallbackLng: DEFAULT_LOCALE,
      interpolation: { escapeValue: false },
      returnNull: false,
    });
    initialized = true;
  } else if (i18n.language !== locale) {
    void i18n.changeLanguage(locale);
  }
  return i18n;
}

export function I18nProvider({
  locale,
  children,
}: {
  locale: UiLocale;
  children: ReactNode;
}) {
  ensureI18n(locale);

  useEffect(() => {
    void i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
  }, [locale]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

export { i18n, normalizeUiLocale, DEFAULT_LOCALE };
export type { UiLocale };
