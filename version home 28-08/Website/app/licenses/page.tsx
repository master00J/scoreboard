import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import { LegalFooter } from "@/components/legal-footer";
import { SeoBreadcrumbJsonLd } from "@/components/seo-breadcrumb-json-ld";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  segmentTitle: "Licenties",
  description:
    "ArenaCue-licentie: inloggen op het klantportaal, software downloaden, installaties beheren. Plus open-sourcevermelding voor de website.",
  path: "/licenses",
  keywordsExtra: [
    "ArenaCue licentie",
    "klantportaal",
    "download",
    "activatie",
    "open source",
  ],
});

function loadThirdPartyMarkdown(): string | null {
  try {
    const p = path.join(process.cwd(), "public", "legal", "third-party-npm.md");
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

export default function LicensesPage() {
  const md = loadThirdPartyMarkdown();

  return (
    <main className="legal-page">
      <SeoBreadcrumbJsonLd
        items={[
          { name: "Home", path: "/" },
          { name: "Licenties", path: "/licenses" },
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
          <strong>
            Arena<span>Cue</span>
          </strong>
          <small>Scoreboard, LED boarding &amp; Display Control</small>
        </span>
      </a>
      <article className="legal-card">
        <p className="section-kicker">Voor clubs &amp; operators</p>
        <h1>Je licentie, download &amp; ondersteuning</h1>
        <p>
          Met een ArenaCue-licentie activeer je de <strong>desktopsoftware</strong> op je wedstrijd-PC
          (Windows). Je ziet in het portaal welke producten bij je contract horen, tot wanneer je
          licentie geldig is, en op welke machines de app al geregistreerd is.
        </p>

        <h2>Wat kun je zelf doen?</h2>
        <ul>
          <li>
            <strong>Inloggen op het klantportaal</strong> met het e-mailadres dat bij je licentie
            hoort — daar vind je je licentiesleutel en downloadlinks (installer of portable).
          </li>
          <li>
            <strong>Installaties beheren</strong>: overzicht van geactiveerde toestellen en ruimte
            voor nieuwe activaties volgens je pakket.
          </li>
          <li>
            <strong>Software bijwerken</strong>: nieuwe versies verschijnen op dezelfde plek; na
            installatie blijft je activatie geldig op die machine.
          </li>
        </ul>

        <p style={{ marginTop: "22px" }}>
          <Link className="primary-button" href="/portal">
            Open het klantportaal
          </Link>
        </p>
        <p className="legal-muted" style={{ marginTop: "14px" }}>
          Liever rechtstreeks? Ga naar{" "}
          <a href="/licentie">
            <code>/licentie</code>
          </a>{" "}
          — dezelfde portal, korter adres om te delen.
        </p>

        <h2>Hulp nodig?</h2>
        <p>
          Klopt er iets niet met je sleutel, activatie of download? Mail ons op{" "}
          <a href="mailto:info@arenacue.be">info@arenacue.be</a> — vermeld je club en het e-mailadres
          van de licentie, dan kunnen we je snel verder helpen.
        </p>

        <h2>Updates &amp; functionaliteit</h2>
        <p>
          Nieuw in de software of op het portaal vind je in het{" "}
          <a href="/changelog">changelog</a>. Algemene productinfo staat op{" "}
          <a href="/functies">Functies</a>.
        </p>

        <h2>Privacy &amp; gegevens</h2>
        <p>
          Voor hosting, e-mail (bijv. portaal-login), demo-aanvragen en andere verwerking van
          persoonsgegevens verwijzen we naar de{" "}
          <a href="/privacy">privacyverklaring</a> en de{" "}
          <a href="/terms">algemene voorwaarden</a>.
        </p>

        <details className="legal-details-disclosure">
          <summary>Open source &amp; third-party (technische bijlage — website)</summary>
          <p style={{ marginTop: "16px" }}>
            ArenaCue gebruikt open-sourcebibliotheken en diensten van derden. Hieronder staat een
            automatisch gegenereerde lijst van <strong>npm-packages</strong> die bij een{" "}
            <strong>productie-build van deze website</strong> horen. Ontbreekt het bestand? Voer
            in de map <code>Website/</code> het commando <code>npm run legal</code> uit (of{" "}
            <code>npm run build</code>, dat dit via <code>prebuild</code> aanmaakt).
          </p>

          <h2 id="npm">Website — npm-packages (productie)</h2>
          {!md ? (
            <p className="legal-muted">
              Het bestand <code>public/legal/third-party-npm.md</code> ontbreekt. Voer uit:{" "}
              <code>npm run legal</code> in <code>Website/</code>.
            </p>
          ) : (
            <pre className="legal-license-pre">{md}</pre>
          )}

          <h2>Desktopsoftware (Electron)</h2>
          <p>
            De ArenaCue-desktopapp wordt gebundeld met Electron en Chromium. Bij elke
            release-build zitten onder andere <code>OPEN_SOURCE_NOTICES.txt</code>,{" "}
            <code>LICENSES.chromium.html</code> en <code>THIRD_PARTY_NPM.md</code> in de installatie
            (map <strong>Licenties</strong>, via <strong>Help → Licenties en open source</strong> in
            de app).
          </p>

          <h2>Verwerkers &amp; APIs</h2>
          <p>
            Voor hosting, e-mail (Resend), AI-ondersteuning (Anthropic) en databases: zie de{" "}
            <a href="/privacy">privacyverklaring</a>.
          </p>

          <p className="legal-muted">
            Dit overzicht vervangt geen juridisch advies. Bij twijfel over licentiecompatibiliteit:
            raadpleeg een advocaat.
          </p>
        </details>
      </article>
      <LegalFooter />
    </main>
  );
}
