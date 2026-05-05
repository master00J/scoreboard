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
    body: "Bedien score, klok, matchstatus en fases vanuit een overzichtelijk controlepaneel.",
  },
  {
    title: "Sponsorrotatie",
    body: "Plan sponsorvisuals per fase en verspreid schermtijd eerlijk over wedstrijd, rust en prematch.",
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
    body: "Beheer teamlogo's, spelersvisuals, goalvideo's, wissels, kaarten en intro's lokaal.",
  },
];

const workflow = [
  "Installeer ArenaCue Scoreboard (en optioneel LED boarding) op de regie-laptop.",
  "Verbind het scherm of display-systeem via HDMI, capture of LAN.",
  "Maak teams, wedstrijd en sponsors aan.",
  "Bedien de volledige match live vanuit het control panel.",
];

const releaseItems = [
  "Windows installer en portable build",
  "Duidelijke versies en release notes",
  "Downloadbare installers per softwareversie",
  "Voorbereid op automatische update-meldingen in de desktopapp",
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
              Control every moment.
              <br />
              Display every detail.
            </h1>
            <p className="hero-lead">
              ArenaCue is professionele Windows-software voor live scoreboards, sponsorrotatie en stadionvisuals — met
              optionele <strong>LED boarding</strong> voor perimeter en tribunes. Alles draait lokaal, snel en
              betrouwbaar tijdens de wedstrijd.
            </p>
            <div className="hero-actions">
              <a className="primary-button" href="#contact">
                Start met ArenaCue
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
              Connected
              <b>Mode: sponsor rotation</b>
            </div>
            <div className="score-preview">
              <div className="team-card">
                <div className="crest">H</div>
                <strong>2</strong>
              </div>
              <div className="clock-card">
                <small>1st half</small>
                <strong>15:48</strong>
                <span>Sponsor window: 62%</span>
              </div>
              <div className="team-card">
                <div className="crest away">A</div>
                <strong>0</strong>
              </div>
            </div>
            <div className="panel-grid">
              <div>
                <small>Match controls</small>
                <button>Pause</button>
                <button>Set time</button>
              </div>
              <div>
                <small>Sponsor planning</small>
                <p>Budget verspreid over de volledige fase</p>
              </div>
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
          <h2>Alles wat je nodig hebt voor een strak wedstrijdscherm.</h2>
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
            Clubs hoeven geen complexe serveromgeving op te zetten: installeren, wedstrijd aanmaken, display openen en
            starten.
          </p>
          <ul className="check-list">
            {workflow.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="download-cards-stack">
          <div className="download-card">
            <Image src="/assets/arenacue-icon.png" alt="" width={96} height={96} />
            <h3>ArenaCue Scoreboard</h3>
            <p>Installer en portable versie voor scoreboard-, sponsor- en displaycontrole tijdens de match.</p>
            <a className="primary-button full" href="#contact">
              Vraag download aan
            </a>
          </div>
          <div className="download-card">
            <Image src="/assets/arenacue-icon.png" alt="" width={96} height={96} />
            <h3>ArenaCue LED boarding</h3>
            <p>Losstaande app voor perimeter/tribune-LED: zones, playlists en sponsors op pixelprecieze output.</p>
            <a className="primary-button full" href="#contact">
              Vraag download aan
            </a>
          </div>
        </div>
      </section>

      <section className="updates" id="updates">
        <div className="updates-card">
          <div>
            <p className="section-kicker">Updates</p>
            <h2>Nieuwe versies kunnen later automatisch gemeld worden in de app.</h2>
            <p>
              Elke release kan voorzien worden van een duidelijke versie, korte changelog en downloadbare installer. Zo
              houden clubs eenvoudig bij welke ArenaCue-versie ze gebruiken.
            </p>
            <p className="updates-changelog-link">
              <Link className="secondary-button" href="/changelog">
                Bekijk changelog voor clubs
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
              Vul je gegevens in en we nemen contact op om de juiste ArenaCue-opstelling voor je club te bespreken.
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
          <a href="/terms">Voorwaarden</a>
          <CookieSettingsTrigger />
        </span>
      </footer>
    </main>
  );
}
