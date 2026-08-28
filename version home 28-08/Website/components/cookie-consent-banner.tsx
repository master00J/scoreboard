"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCookieConsent } from "@/components/cookie-consent-context";

export function CookieConsentBanner() {
  const pathname = usePathname();
  const { consent, hydrated, panelOpen, closeCookieSettings, saveConsent } =
    useCookieConsent();
  const [expanded, setExpanded] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    if (!panelOpen) return;
    if (consent) {
      setAnalytics(consent.analytics);
      setMarketing(consent.marketing);
    } else {
      setAnalytics(false);
      setMarketing(false);
    }
  }, [panelOpen, consent]);

  if (!hydrated || !panelOpen) return null;

  if (pathname?.startsWith("/admin")) return null;

  const hasExistingChoice = consent !== null;

  return (
    <div
      className="cookie-banner"
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-banner-title"
    >
      <div className="cookie-banner-inner">
        <div className="cookie-banner-text">
          <p id="cookie-banner-title" className="cookie-banner-title">
            Cookies &amp; privacy
          </p>
          <p className="cookie-banner-lead">
            We gebruiken strikt noodzakelijke cookies en lokale opslag om de site veilig te laten
            werken. Optioneel kun je statistiek- of marketingcookies toestaan zodra we die inschakelen.
            Lees meer in onze{" "}
            <Link href="/privacy#cookies">
              privacyverklaring
            </Link>
            .
          </p>
        </div>

        {expanded && (
          <div className="cookie-banner-preferences">
            <label className="cookie-toggle-row">
              <input type="checkbox" checked disabled />
              <span>
                <strong>Noodzakelijk</strong>
                <small>Altijd aan — sessiebeheer admin, beveiliging, formulieren.</small>
              </span>
            </label>
            <label className="cookie-toggle-row">
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
              />
              <span>
                <strong>Statistiek</strong>
                <small>
                  Helpt ons gebruik te begrijpen (bijv. anonieme paginaweergaven). Momenteel laden we
                  hier nog geen scripts zonder jouw toestemming.
                </small>
              </span>
            </label>
            <label className="cookie-toggle-row">
              <input
                type="checkbox"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
              />
              <span>
                <strong>Marketing</strong>
                <small>Bijv. remarketing of campagnemeting — alleen na expliciete keuze.</small>
              </span>
            </label>
          </div>
        )}

        <div className="cookie-banner-actions">
          <button
            type="button"
            className="cookie-btn ghost"
            onClick={() => setExpanded((x) => !x)}
          >
            {expanded ? "Terug" : "Instellingen"}
          </button>
          <button
            type="button"
            className="cookie-btn secondary"
            onClick={() => saveConsent({ analytics: false, marketing: false })}
          >
            Alleen noodzakelijk
          </button>
          <button
            type="button"
            className="cookie-btn primary"
            onClick={() =>
              saveConsent({
                analytics: expanded ? analytics : true,
                marketing: expanded ? marketing : true,
              })
            }
          >
            {expanded ? "Keuze opslaan" : "Alles accepteren"}
          </button>
          {hasExistingChoice && (
            <button type="button" className="cookie-btn ghost close-only" onClick={closeCookieSettings}>
              Sluiten
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
