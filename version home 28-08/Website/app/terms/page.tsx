import type { Metadata } from "next";
import Image from "next/image";
import { LegalFooter } from "@/components/legal-footer";
import { SeoBreadcrumbJsonLd } from "@/components/seo-breadcrumb-json-ld";
import { COMPANY_LEGAL } from "@/lib/company-legal";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  segmentTitle: "Voorwaarden",
  description:
    "Algemene product- en websitevoorwaarden voor ArenaCue scoreboardsoftware en het gebruik van deze site.",
  path: "/terms",
  keywordsExtra: ["algemene voorwaarden", "gebruiksvoorwaarden"],
});

export default function TermsPage() {
  return (
    <main className="legal-page">
      <SeoBreadcrumbJsonLd
        items={[
          { name: "Home", path: "/" },
          { name: "Voorwaarden", path: "/terms" },
        ]}
      />
      <a className="brand" href="/">
        <Image
          src="/assets/arenacue-icon.png"
          alt=""
          width={44}
          height={44}
          className="brand-icon"
        />
        <span>
          <strong>Arena<span>Cue</span></strong>
          <small>Scoreboard, LED boarding &amp; Display Control</small>
        </span>
      </a>
      <article className="legal-card">
        <p className="section-kicker">Voorwaarden</p>
        <h1>Websitevoorwaarden</h1>
        <p>
          Deze website geeft informatie over ArenaCue, software voor scoreboard-
          en stadiondisplaycontrole. Informatie op deze site kan wijzigen zonder
          voorafgaande kennisgeving.
        </p>

        <h2>Demo en download</h2>
        <p>
          Demo-aanvragen zijn vrijblijvend. Een download, licentie of
          commerciële overeenkomst wordt pas actief na bevestiging door ArenaCue.
        </p>

        <h2>Software</h2>
        <p>
          ArenaCue wordt geleverd als Windows-software. Beschikbare functies,
          installatievormen en updates kunnen per versie verschillen.
        </p>

        <h2>Intellectuele eigendom</h2>
        <p>
          De naam ArenaCue, visuele identiteit, teksten en software blijven
          eigendom van de rechthebbende partij, tenzij schriftelijk anders
          overeengekomen.
        </p>

        <h2>Cookies en privacy</h2>
        <p>
          Het gebruik van cookies en vergelijkbare technieken op deze website wordt beschreven in de{" "}
          <a href="/privacy">privacyverklaring</a>. Via het cookiebanner en &quot;Cookie-instellingen&quot;
          in de footer kun je je voorkeuren beheren.
        </p>

        <h2>Contact</h2>
        <p>
          Voor vragen over voorwaarden of commerciële afspraken:{" "}
          <a href="mailto:info@arenacue.be">info@arenacue.be</a>. Uitbater: {COMPANY_LEGAL.legalName}.
        </p>
      </article>
      <LegalFooter />
    </main>
  );
}
