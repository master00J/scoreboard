"use client";

import { useCookieConsent } from "@/components/cookie-consent-context";

export function CookieSettingsTrigger({
  className = "",
  label = "Cookie-instellingen",
}: {
  className?: string;
  label?: string;
}) {
  const { openCookieSettings } = useCookieConsent();

  return (
    <button
      type="button"
      className={`cookie-settings-trigger ${className}`.trim()}
      onClick={() => openCookieSettings()}
    >
      {label}
    </button>
  );
}
