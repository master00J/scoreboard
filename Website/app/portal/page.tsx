import { cookies } from "next/headers";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { LegalFooter } from "@/components/legal-footer";
import { LicensePortalForm } from "@/components/license-portal-form";
import { PortalDashboard } from "@/components/portal-dashboard";
import { PortalLoginPanel } from "@/components/portal-login-panel";
import { PortalReleaseNoticeStrip } from "@/components/portal-release-notice";
import { SeoBreadcrumbJsonLd } from "@/components/seo-breadcrumb-json-ld";
import { getAppReleasePayload } from "@/lib/app-release";
import { loadPortalLicenseCardsForOwnerEmail } from "@/lib/portal-dashboard-data";
import { PORTAL_COOKIE_NAME, verifyPortalSessionToken } from "@/lib/portal-auth";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = {
  ...pageMetadata({
    segmentTitle: "Klantportaal",
    description:
      "Log veilig in met je e-mailadres, bekijk je ArenaCue-licenties, download de app en beheer geactiveerde installaties.",
    path: "/portal",
    keywordsExtra: ["ArenaCue login", "licentie download", "klantportaal"],
  }),
  robots: { index: true, follow: true },
};

type SearchParams = Promise<{ fout?: string }>;

export default async function PortalPage(props: { searchParams?: SearchParams }) {
  const sp = props.searchParams ? await props.searchParams : {};
  const linkInvalid = sp.fout === "link";

  const jar = await cookies();
  const sessionEmail = await verifyPortalSessionToken(jar.get(PORTAL_COOKIE_NAME)?.value);

  const releaseVersion = getAppReleasePayload().version.trim() || null;

  let mainSection: ReactNode;
  if (sessionEmail) {
    const licenses = await loadPortalLicenseCardsForOwnerEmail(sessionEmail);
    if (licenses === null) {
      mainSection = (
        <div className="data-card">
          <p className="form-error" style={{ margin: 0 }}>
            Kon je licentiegegevens niet laden. Probeer later opnieuw of neem contact op met ArenaCue.
          </p>
        </div>
      );
    } else {
      mainSection = (
        <PortalDashboard
          email={sessionEmail}
          licenses={licenses}
          portalReleaseVersion={releaseVersion}
        />
      );
    }
  } else {
    mainSection = (
      <>
        <PortalLoginPanel linkError={linkInvalid} />
        <div className="data-card" style={{ marginTop: 24 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: "1.25rem", letterSpacing: "-0.03em" }}>
            Direct opzoeken met sleutel
          </h2>
          <p className="form-hint" style={{ marginBottom: 22 }}>
            Geen e-mail bij de hand? Vul hier je licentiesleutel en het gekoppelde e-mailadres in — hetzelfde als
            voorheen op deze pagina.
          </p>
          <LicensePortalForm portalReleaseVersion={releaseVersion} />
        </div>
      </>
    );
  }

  return (
    <main className="app-shell">
      <SeoBreadcrumbJsonLd
        items={[
          { name: "Home", path: "/" },
          { name: "Klantportaal", path: "/portal" },
        ]}
      />
      <div className="app-shell-inner">
        <nav className="app-nav" style={{ marginBottom: 22 }}>
          <strong>ArenaCue</strong>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Link href="/functies">Functies</Link>
            <Link href="/vereisten">Systeemvereisten</Link>
            <Link href="/changelog">Changelog</Link>
            <Link href="/">Home</Link>
            <Link href="/#contact">Demo</Link>
          </div>
        </nav>

        <div className="data-card" style={{ marginBottom: 22 }}>
          <h1 style={{ margin: "0 0 8px", fontSize: "1.55rem", letterSpacing: "-0.03em" }}>Klantportaal</h1>
          <p className="form-hint" style={{ margin: 0 }}>
            <strong>Inloggen voor klanten:</strong> vul hieronder het e-mailadres in dat bij je licentie hoort — je
            ontvangt een eenmalige loginlink (geen wachtwoord). Of gebruik direct het formulier met sleutel + e-mail als
            je snel iets wilt nakijken.
          </p>
          <p className="form-hint" style={{ marginTop: 10 }}>
            Download je ArenaCue voor een nieuwe pc? Bekijk eerst de{" "}
            <Link href="/vereisten">systeemvereisten</Link>, zodat de wedstrijd-pc klaar is voor video,
            sponsorrotatie en tweede scherm.
          </p>
        </div>

        <PortalReleaseNoticeStrip />

        {mainSection}

        <LegalFooter />
      </div>
    </main>
  );
}
