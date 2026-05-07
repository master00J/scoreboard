import type { Metadata } from "next";
import Image from "next/image";
import fs from "node:fs";
import path from "node:path";
import { LegalFooter } from "@/components/legal-footer";
import { SeoBreadcrumbJsonLd } from "@/components/seo-breadcrumb-json-ld";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  segmentTitle: "Licenties",
  description:
    "Open-source- en third-party software die gebruikt wordt op arenacue.be: npm-attributie en verwijzing naar desktop-build.",
  path: "/licenses",
  keywordsExtra: ["open source", "third-party", "licenties", "MIT"],
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
        <p className="section-kicker">Juridisch</p>
        <h1>Licenties &amp; open source</h1>
        <p>
          ArenaCue gebruikt open-source libraries en diensten van derden. Hieronder vind je een
          automatisch gegenereerde inventaris van <strong>npm-packages</strong> die bij een{" "}
          <strong>productie-build van deze website</strong> horen (runtime-dependencies). Voer{" "}
          <code>npm run legal</code> in de map <code>Website/</code> als dit bestand ontbreekt.
        </p>

        <h2>Desktopsoftware (Electron)</h2>
        <p>
          De ArenaCue-desktopapp wordt gebundeld met Electron en Chromium. Bij elke release-build
          worden daarvoor onder andere <code>OPEN_SOURCE_NOTICES.txt</code>,{" "}
          <code>LICENSES.chromium.html</code> en <code>THIRD_PARTY_NPM.md</code> meegeleverd in de
          installatie (map <strong>Licenties</strong>, bereikbaar via het menu{" "}
          <strong>Help → Licenties en open source</strong>).
        </p>

        <h2 id="npm">Website — npm-packages (productie)</h2>
        {!md ? (
          <p className="legal-muted">
            Het bestand <code>public/legal/third-party-npm.md</code> ontbreekt. Voer uit:{" "}
            <code>npm run legal</code> in <code>Website/</code> (of <code>npm run build</code>, dat
            dit via <code>prebuild</code> genereert).
          </p>
        ) : (
          <pre className="legal-license-pre">{md}</pre>
        )}

        <h2>Verwerkers &amp; APIs</h2>
        <p>
          Voor verwerking van persoonsgegevens via hosting, e-mail (Resend), AI-ondersteuning
          (Anthropic) en eventuele databases, zie ook de{" "}
          <a href="/privacy">privacyverklaring</a>.
        </p>

        <p className="legal-muted">
          Dit overzicht vervangt geen juridisch advies. Bij twijfel over licentiecompatibiliteit:
          raadpleeg een advocaat.
        </p>
      </article>
      <LegalFooter />
    </main>
  );
}
