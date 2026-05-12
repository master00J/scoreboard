import type { Metadata } from "next";
import Image from "next/image";
import { LegalFooter } from "@/components/legal-footer";
import { COMPANY_LEGAL } from "@/lib/company-legal";
import { SeoBreadcrumbJsonLd } from "@/components/seo-breadcrumb-json-ld";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  segmentTitle: "Privacy",
  description:
    "Privacyverklaring, cookies en gegevensverwerking voor ArenaCue demo-aanvragen, licentieportal, website en mobiele app.",
  path: "/privacy",
  keywordsExtra: ["AVG", "GDPR", "cookies", "gegevensbescherming"],
});

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <SeoBreadcrumbJsonLd
        items={[
          { name: "Home", path: "/" },
          { name: "Privacy", path: "/privacy" },
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
        <p className="section-kicker">Privacy</p>
        <h1>Privacyverklaring</h1>
        <p>
          ArenaCue respecteert je privacy. Deze verklaring beschrijft hoe we persoonsgegevens en
          cookies verwerken via{" "}
          <a href="https://arenacue.be" rel="noopener noreferrer">
            arenacue.be
          </a>{" "}
          en verwante diensten (demo-aanvragen, licentieportal, administratie en de mobiele
          ArenaCue Control-app).
        </p>

        <h2>Verwerkingsverantwoordelijke</h2>
        <p>
          {COMPANY_LEGAL.legalName}, {COMPANY_LEGAL.streetLine}, {COMPANY_LEGAL.cityLine}. BTW{" "}
          {COMPANY_LEGAL.vatNumber}. Contact:{" "}
          <a href="mailto:info@arenacue.be">info@arenacue.be</a>. Voor specifieke rechten en vragen over je gegevens
          kun je dit adres gebruiken.
        </p>

        <h2>Welke gegevens verwerken we?</h2>
        <ul>
          <li>
            <strong>Demo-aanvragen:</strong> naam, e-mailadres, club/organisatie, optioneel
            telefoonnummer en je bericht.
          </li>
          <li>
            <strong>Licentie &amp; portal:</strong> licentie-informatie en activatiegegevens die je
            zelf invoert of die door de desktopsoftware worden gemeld volgens het product.
          </li>
          <li>
            <strong>Mobiele ArenaCue Control-app:</strong> koppelcode, serveradres of cloud-URL,
            venue-ID, tijdelijke sessietoken en operator/viewer-rol. De camera wordt alleen gebruikt
            om een QR-koppelcode te scannen; er worden geen camerabeelden door ons opgeslagen.
          </li>
          <li>
            <strong>Websitebeheer:</strong> beperkte technische gegevens via hosting en beveiliging
            (zoals IP-adressen in serverlogs), waar dat noodzakelijk is voor stabiliteit en misbruikpreventie.
          </li>
        </ul>

        <h2 id="cookies">Cookies en lokale opslag</h2>
        <p>
          Via de cookiebanner op de website kun je kiezen welke niet-noodzakelijke categorieën je
          toestaat. Je voorkeur bewaren we in de browser (<code>localStorage</code>) zodat we je bij
          een volgend bezoek niet opnieuw hoeven te vragen, tenzij je je cache wist of we de policy
          inhoudelijk wijzigen.
        </p>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead>
              <tr>
                <th>Categorie</th>
                <th>Doel</th>
                <th>Techniek</th>
                <th>Bewaartermijn</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Noodzakelijk</td>
                <td>
                  Beveiligde beheerderssessie (admin), werking formulieren, bescherming tegen misbruik.
                </td>
                <td>HTTP-cookie (httpOnly, signed sessie)</td>
                <td>Sessieduur (bv. tot uitlogen / vervaltijd token)</td>
              </tr>
              <tr>
                <td>Voorkeuren</td>
                <td>Jouw cookiekeuze bewaren.</td>
                <td>
                  <code>localStorage</code> sleutel{" "}
                  <code className="legal-code-inline">arenacue_cookie_consent_v1</code>
                </td>
                <td>Tot je voorkeur wist of aanpast</td>
              </tr>
              <tr>
                <td>Statistiek</td>
                <td>Inzicht in gebruik (anoniem waar mogelijk).</td>
                <td>Alleen na jouw toestemming; momenteel laden we standaard geen analytics-scripts.</td>
                <td>Volgens leverancier zodra ingeschakeld</td>
              </tr>
              <tr>
                <td>Marketing</td>
                <td>Remarketing of campagnemeting.</td>
                <td>Alleen na jouw expliciete toestemming.</td>
                <td>Volgens leverancier zodra ingeschakeld</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Je kunt je keuze altijd wijzigen via &quot;Cookie-instellingen&quot; in de footer van de
          website.
        </p>
        <p>
          In de mobiele app bewaren we verbindingsinstellingen en tijdelijke sessiegegevens lokaal op
          het toestel, zodat een operator niet telkens opnieuw hoeft te koppelen. Je kunt deze gegevens
          verwijderen door de app-data te wissen of de app te verwijderen.
        </p>

        <h2>Waarom verwerken we gegevens? (rechtsgronden)</h2>
        <ul>
          <li>
            <strong>Uitvoering van een aanvraag / voorbereiding van een overeenkomst:</strong> om demo-
            en licentieverzoeken op te volgen.
          </li>
          <li>
            <strong>Gerechtvaardigd belang:</strong> beveiliging van de website, fraudepreventie en
            verbetering van de dienstverlening, telkens in evenwicht met je rechten.
          </li>
          <li>
            <strong>Toestemming:</strong> voor niet-noodzakelijke cookies en vergelijkbare technieken,
            waar de wet dat vereist (via de cookiebanner).
          </li>
        </ul>

        <h2>Bewaartermijnen</h2>
        <p>
          Demo-aanvragen en zakelijke correspondentie bewaren we zolang dat redelijk nodig is voor
          opvolging, verkoop en support. Je kunt altijd verzoeken om verwijdering, behoudens wettelijke
          bewaarplichten.
        </p>

        <h2>Ontvangers en hosting</h2>
        <p>We gebruiken zorgvuldig geselecteerde diensten voor hosting en infrastructuur, waaronder:</p>
        <ul>
          <li>
            <strong>Vercel</strong> (of vergelijkbare hosting) voor het uitbaten van deze Next.js-site.
          </li>
          <li>
            <strong>Supabase</strong> voor opslag van demo-aanvragen en gerelateerde applicatiegegevens,
            volgens hun voorwaarden en beveiligingsmaatregelen.
          </li>
          <li>
            <strong>Resend</strong> (of vergelijkbare e-mailprovider) voor transactionele e-mails
            rond demo-aanvragen indien geconfigureerd.
          </li>
          <li>
            <strong>Anthropic</strong> als AI-leverancier (Claude) voor de support-chatbot rechtsonder
            op deze site. Wanneer je iets typt in het chatvenster wordt je vraag eenmalig naar
            Anthropic verzonden om een antwoord te genereren. We slaan gesprekken niet op aan onze
            zijde.
          </li>
        </ul>
        <p>
          Wanneer cloudbediening actief is, communiceert de mobiele app met de ArenaCue API om
          commando&apos;s naar de gekoppelde desktopsoftware door te geven. Bij lokale LAN-bediening
          communiceert de app rechtstreeks met de wedstrijd-pc op hetzelfde netwerk.
        </p>
        <p>
          Een verwerking buiten de Europese Economische Ruimte kan plaatsvinden als de aanbieder
          passende waarborgen biedt (zoals standaardcontractbepalingen). Raadpleeg de privacy policies
          van deze leveranciers voor details.
        </p>

        <h2>Je rechten</h2>
        <p>
          Afhankelijk van de toepasselijke privacywetgeving kun je onder meer vragen om inzage,
          rectificatie of verwijdering van je persoonsgegevens, beperking van de verwerking, bezwaar of
          dataportabiliteit. Je kunt ook een klacht indienen bij de Gegevensbeschermingsautoriteit (
          <a href="https://www.gegevensbeschermingsautoriteit.be" rel="noopener noreferrer">
            gegevensbeschermingsautoriteit.be
          </a>
          ).
        </p>

        <h2>Beveiliging</h2>
        <p>
          We nemen passende technische en organisatorische maatregelen om persoonsgegevens te
          beschermen, waaronder beveiligde verbindingen (HTTPS), strikte scheiding tussen publieke en
          beheerdersroutes waar mogelijk, en minimale blootstelling van gevoelige sleutels op de client.
        </p>

        <h2>Wijzigingen</h2>
        <p>
          Deze verklaring kan worden bijgewerkt bij nieuwe functionaliteit of wettelijke vereisten.
          De datum van de laatste inhoudelijke aanpassing vind je hieronder; een materiële wijziging
          kan een nieuwe cookieprompt uitlokken.
        </p>
        <p>
          <strong>Laatst bijgewerkt:</strong>{" "}
          {new Intl.DateTimeFormat("nl-BE", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }).format(new Date("2026-05-09"))}
          .
        </p>

        <h2>Contact</h2>
        <p>
          Vragen over privacy of cookies? Mail naar{" "}
          <a href="mailto:info@arenacue.be">info@arenacue.be</a>.
        </p>
      </article>
      <LegalFooter />
    </main>
  );
}
