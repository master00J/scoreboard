"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  COOKIE_CONSENT_STORAGE_KEY,
  parseStoredConsent,
  writeConsent,
  type StoredCookieConsent,
} from "@/lib/cookie-consent";

type CookieConsentContextValue = {
  /** null = nog geen keuze na hydrate */
  consent: StoredCookieConsent | null;
  hydrated: boolean;
  /** Banner of handmatige instellingen-overlay tonen */
  panelOpen: boolean;
  openCookieSettings: () => void;
  closeCookieSettings: () => void;
  saveConsent: (prefs: Pick<StoredCookieConsent, "analytics" | "marketing">) => void;
};

const CookieConsentContext = createContext<CookieConsentContextValue | null>(null);

export function useCookieConsent(): CookieConsentContextValue {
  const ctx = useContext(CookieConsentContext);
  if (!ctx) {
    throw new Error("useCookieConsent moet binnen CookieConsentProvider gebruikt worden");
  }
  return ctx;
}

export function CookieConsentProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [consent, setConsent] = useState<StoredCookieConsent | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    setConsent(parseStoredConsent(raw));
    setHydrated(true);
  }, []);

  const openCookieSettings = useCallback(() => {
    setManualOpen(true);
  }, []);

  const closeCookieSettings = useCallback(() => {
    setManualOpen(false);
  }, []);

  const saveConsent = useCallback((prefs: Pick<StoredCookieConsent, "analytics" | "marketing">) => {
    const next = writeConsent({
      v: 1,
      necessary: true,
      analytics: prefs.analytics,
      marketing: prefs.marketing,
    });
    setConsent(next);
    setManualOpen(false);
  }, []);

  const panelOpen =
    hydrated && (consent === null || manualOpen);

  const value = useMemo(
    () => ({
      consent,
      hydrated,
      panelOpen,
      openCookieSettings,
      closeCookieSettings,
      saveConsent,
    }),
    [consent, hydrated, panelOpen, openCookieSettings, closeCookieSettings, saveConsent],
  );

  return (
    <CookieConsentContext.Provider value={value}>{children}</CookieConsentContext.Provider>
  );
}
