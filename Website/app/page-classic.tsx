import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { DemoRequestForm } from "@/components/demo-request-form";
import { CookieSettingsTrigger } from "@/components/cookie-settings-trigger";
import { homePageMetadata } from "@/lib/seo";

export const metadata: Metadata = homePageMetadata();

const features = [
  {
    title: "Live scorebord",
    body: "Bedien score, klok en wedstrijdfases in realtime vanuit één overzichtelijk paneel.",
  },
  {
    title: "Wedstrijdlog met undo",
    body: "Registreer goals, wissels en kaarten in een chronologische log met snelle correctie.",
  },
  {
    title: "Sponsorrotatie",
    body: "Plan sponsorvisuals per fase en verdeel schermtijd slim over prematch, match en rust.",
  },
  {
    title: "Stadiondisplay",
    body: "Toon visuals fullscreen of naast het scorebord op een vaste 16:9 display-output.",
  },
  {
    title: "LED boarding",
    body: "Aparte ArenaCue-app voor perimeter- en tribuneschermen: zones, playlists en sponsorlogo's op een configureerbare pixelcanvas.",
  },
  {
    title: "Media & spelers",
    body: "Beheer teamlogo's, spelerintro's en wedstrijdvisuals in één centrale workflow.",
  },
];

const workflow = [
  "Start ArenaCue Scoreboard (en optioneel LED boarding) op de regie-opstelling.",
  "Koppel je scherm- of displayketen en controleer de output.",
  "Stel teams, wedstrijd en sponsors op voor de aftrap.",
  "Bedien de volledige match live vanuit het control panel.",
];

const releaseItems = [
  "Heldere versies met duidelijke release notes",
  "Eenvoudig terugvinden welke versie je gebruikt",
  "Snelle toegang tot de juiste download per release",
  "Minder onzekerheid op wedstrijddagen door voorspelbare updates",
];

export default function Home() {
  return (
    <main>
      <section className="hero-shell">
        <header className="nav">
          <a className="brand" href="#top" aria-label="ArenaCue home">
            <Image
              src="/assets/arenacue-icon.png"
              alt=""
              width={44}
              height={44}
              priority
              className="brand-icon"
            />
            <span>
              <strong>
                Arena<span>Cue</span>
              </strong>
              <small>Scoreboard, LED boarding &amp; Display Control</small>
            </span>
          </a>
          <nav aria-label="Hoofdnavigatie">
            <a href="#features">Features</a>
            <Link href="/functies">Alle functies</Link>
            <a href="#software">Software</a>
            <a href="#updates">Updates</a>
            <Link href="/changelog">Changelog</Link>
            <Link href="/portal">Klantportaal</Link>
            <a href="#contact">Demo</a>
          </nav>
          <div className="nav-trailing">
            <Link href="/portal" className="nav-portal-mobile-only">
              Klantportaal
            </Link>
            <a className="nav-cta" href="#contact">
              Boek demo
            </a>
          </div>
        </header>

        <div className="hero-grid" id="top">
          <div className="hero-copy">
            <div className="eyebrow">
              <span />
              Gebouwd voor clubs, stadions en live regie
            </div>
            <h1>
              Command every moment.
              <br />
              Impress every crowd.
            </h1>
            <p className="hero-lead">
              ArenaCue bestaat uit professionele software voor live scoreboards, sponsorrotatie en stadionvisuals — met
              aparte <strong>LED boarding</strong> voor perimeter en tribunes. Zo beheer je elke wedstrijdfase
              gecontroleerd, strak en betrouwbaar.
            </p>
            <div className="hero-actions">
              <a className="primary-button" href="#contact">
                Plan je ArenaCue demo
                <span>→</span>
              </a>
              <Link className="secondary-button" href="/functies">
                Alle functies
              </Link>
              <Link className="secondary-button" href="/portal">
                Klantportaal — inloggen
              </Link>
            </div>
            <dl className="trust-row" aria-label="Belangrijkste voordelen">
              <div>
                <dt>Offline ready</dt>
                <dd>LAN/lokaal inzetbaar</dd>
              </div>
              <div>
                <dt>Windows</dt>
                <dd>Eenvoudige installer</dd>
              </div>
              <div>
                <dt>Live</dt>
                <dd>Regie in realtime</dd>
              </div>
            </dl>
          </div>

          <div className="hero-visual" aria-label="ArenaCue software preview">
            <div className="status-line">
              <span className="dot" />
              Productpreview
              <b>Control + Display</b>
            </div>
            <div className="hero-preview-card">
              <Image
                src="/assets/scoreboard-preview-hero.png"
                alt="ArenaCue control dashboard preview"
                width={1280}
                height={720}
                className="hero-product-image"
                priority
              />
              <a className="secondary-button hero-preview-cta" href="#contact">
                Bekijk live demo
              </a>
            </div>
            <div className="floating-logo">
              <Image
                src="/assets/arenacue-icon.png"
                alt="ArenaCue software icoon"
                width={150}
                height={150}
                priority
              />
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="features">
        <div className="section-heading">
          <p>Wat ArenaCue vandaag doet</p>
          <h2>Alles om je wedstrijddag professioneel te sturen.</h2>
        </div>
        <div className="feature-grid">
          {features.map((feature, index) => (
            <article className="feature-card" key={feature.title}>
              <div className="feature-index">{String(index + 1).padStart(2, "0")}</div>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
        <p className="features-see-all">
          <Link href="/functies" className="secondary-button">
            Uitgebreide functionaliteit →
          </Link>
        </p>
      </section>

      <section className="split-section" id="software">
        <div>
          <p className="section-kicker">Software delivery</p>
          <h2>Downloadbaar, eenvoudig te installeren en klaar voor wedstrijddagen.</h2>
          <p>
            ArenaCue Scoreboard wordt geleverd als Windows-installer of portable build;{" "}
            <strong>ArenaCue LED boarding</strong> is een aparte download voor lint- en LED-schermen (zelfde
            distributiepatroon).
            Je team kan snel live: opstarten, wedstrijd klaarzetten, output openen en starten.
          </p>
          <ul className="check-list">
            {workflow.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="updates" id="updates">
        <div className="updates-card">
          <div>
            <p className="section-kicker">Updates</p>
            <h2>Altijd duidelijk welke versie je draait.</h2>
            <p>
              Elke release krijgt een duidelijke versie en heldere changelog, zodat clubs en operators snel weten wat
              nieuw is en met vertrouwen live kunnen werken.
            </p>
            <p className="updates-changelog-link">
              <Link className="secondary-button" href="/changelog">
                Bekijk alle updates
              </Link>
            </p>
          </div>
          <ul className="check-list compact">
            {releaseItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="contact" id="contact">
        <div>
          <p className="section-kicker">Start professioneel</p>
          <h2>Klaar om ArenaCue in je stadion of sportclub te gebruiken?</h2>
          <p>
            Plan een demo, bespreek je schermopstelling en ontvang de juiste download voor je club. Demo&apos;s: één
            aanvraag per e-mail en één demo per apparaat; daarna kan een volledige licentie wél op hetzelfde toestel.
          </p>
        </div>
        <div className="contact-stack">
          <div className="contact-card">
            <Image src="/assets/arenacue-icon.png" alt="" width={74} height={74} />
            <h3>Vraag een demo of download aan</h3>
            <p>
              Vul je gegevens in en we adviseren je meteen over de juiste ArenaCue-opstelling voor jouw club.
            </p>
            <a className="secondary-button full" href="mailto:info@arenacue.be">
              info@arenacue.be
            </a>
          </div>
          <DemoRequestForm />
        </div>
      </section>

      <footer className="footer">
        <span>© {new Date().getFullYear()} ArenaCue</span>
        <span>Scoreboard, LED boarding &amp; Display Control</span>
        <span className="footer-links">
          <Link href="/functies">Functies</Link>
          <Link href="/portal">Klantportaal</Link>
          <Link href="/changelog">Changelog</Link>
          <a href="/privacy">Privacy</a>
          <a href="/vereisten">Systeemvereisten</a>
          <a href="/licenties">Licenties</a>
          <a href="/terms">Voorwaarden</a>
          <CookieSettingsTrigger />
        </span>
      </footer>
    </main>
  );
}
