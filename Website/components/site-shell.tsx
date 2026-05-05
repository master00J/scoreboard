"use client";

import type { ReactNode } from "react";
import { CookieConsentProvider } from "@/components/cookie-consent-context";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <CookieConsentProvider>
      {children}
      <CookieConsentBanner />
    </CookieConsentProvider>
  );
}
