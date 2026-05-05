import Image from "next/image";
import { DemoRequestForm } from "@/components/demo-request-form";

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
    title: "Media & spelers",
    body: "Beheer teamlogo's, spelersvisuals, goalvideo's, wissels, kaarten en intro's lokaal.",
  },
];

const workflow = [
  "Installeer ArenaCue op de regie-laptop.",
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
              <strong>Arena<span>Cue</span></strong>
              <small>Scoreboard & Display Control</small>
            </span>
          </a>
          <nav aria-label="Hoofdnavigatie">
            <a href="#features">Features</a>
            <a href="#software">Software</a>
            <a href="#updates">Updates</a>
            <a href="#contact">Demo</a>
          </nav>
          <a className="nav-cta" href="#contact">Boek demo</a>
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
              ArenaCue is professionele Windows-software voor live scoreboards,
              sponsorrotatie en stadionvisuals. Alles draait lokaal, snel en
              betrouwbaar tijdens de wedstrijd.
            </p>
            <div className="hero-actions">
              <a className="primary-button" href="#contact">
                Start met ArenaCue
                <span>→</span>
              </a>
              <a className="secondary-button" href="#software">
                Bekijk software
              </a>
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
      </section>

      <section className="split-section" id="software">
        <div>
          <p className="section-kicker">Software delivery</p>
          <h2>Downloadbaar, eenvoudig te installeren en klaar voor wedstrijddagen.</h2>
          <p>
            ArenaCue wordt geleverd als Windows-installer of portable build.
            Clubs hoeven geen complexe serveromgeving op te zetten: installeren,
            wedstrijd aanmaken, display openen en starten.
          </p>
          <ul className="check-list">
            {workflow.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="download-card">
          <Image
            src="/assets/arenacue-icon.png"
            alt=""
            width={96}
            height={96}
          />
          <h3>ArenaCue for Windows</h3>
          <p>
            Installer en portable versie voor clubs die snel willen starten met
            scoreboard- en sponsorcontrole.
          </p>
          <a className="primary-button full" href="#contact">
            Vraag download aan
          </a>
        </div>
      </section>

      <section className="updates" id="updates">
        <div className="updates-card">
          <div>
            <p className="section-kicker">Updates</p>
            <h2>Nieuwe versies kunnen later automatisch gemeld worden in de app.</h2>
            <p>
              Elke release kan voorzien worden van een duidelijke versie, korte
              changelog en downloadbare installer. Zo houden clubs eenvoudig bij
              welke ArenaCue-versie ze gebruiken.
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
            Plan een demo, bespreek je schermopstelling en ontvang de juiste
            download voor je club.
          </p>
        </div>
        <div className="contact-stack">
          <div className="contact-card">
            <Image
              src="/assets/arenacue-icon.png"
              alt=""
              width={74}
              height={74}
            />
            <h3>Vraag een demo of download aan</h3>
            <p>
              Vul je gegevens in en we nemen contact op om de juiste
              ArenaCue-opstelling voor je club te bespreken.
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
        <span>Stadium Scoreboard & Display Control</span>
        <span className="footer-links">
          <a href="/portal">Klantportaal</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Voorwaarden</a>
        </span>
      </footer>
    </main>
  );
}
