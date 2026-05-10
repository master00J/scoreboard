import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { DemoRequestForm } from "@/components/demo-request-form";
import { ReviewSubmitForm } from "@/components/review-submit-form";
import { CookieSettingsTrigger } from "@/components/cookie-settings-trigger";
import { homePageMetadata } from "@/lib/seo";
import { getPublishedReviews } from "@/lib/reviews-public";

export const metadata: Metadata = homePageMetadata();

const highlights = ["Live score", "Sponsorrotatie", "Display output", "LED boarding"];

const stats = [
  { value: "16:9", label: "stadiondisplay" },
  { value: "LAN", label: "offline inzetbaar" },
  { value: "Live", label: "bediening in realtime" },
];

const features = [
  {
    title: "Live scorebord",
    body: "Bedien score, klok, fases en stadion-output vanuit één strak control panel.",
    tag: "Match control",
  },
  {
    title: "Wedstrijdlog met undo",
    body: "Registreer goals, wissels en kaarten chronologisch, met snelle correcties wanneer nodig.",
    tag: "Operator safety",
  },
  {
    title: "Sponsorrotatie",
    body: "Plan sponsorvisuals per wedstrijdfase en verdeel schermtijd over prematch, rust en live match.",
    tag: "Commercials",
  },
  {
    title: "Stadiondisplay",
    body: "Toon scorebord, intro's, visuals of sponsorbeelden fullscreen op een vaste 16:9-output.",
    tag: "Broadcast output",
  },
  {
    title: "LED boarding",
    body: "Gebruik ArenaCue LED boarding als aparte app voor perimeter, tribunezones en playlists.",
    tag: "LED zones",
  },
  {
    title: "Media & spelers",
    body: "Beheer teamassets, spelersintro's, wedstrijdvisuals en mediabestanden centraal.",
    tag: "Media workflow",
  },
];

const workflow = [
  "Start ArenaCue Scoreboard op de regie-opstelling.",
  "Koppel de schermketen, output of capturebron.",
  "Zet teams, sponsors en wedstrijdflow klaar voor de aftrap.",
  "Bedien klok, score, visuals en sponsorrotatie live tijdens de match.",
];

const releaseItems = [
  "Heldere versies met duidelijke release notes",
  "Snelle toegang tot de juiste installer of portable build",
  "Changelog per release voor clubs en operators",
  "Voorspelbare updates voor minder stress op wedstrijddagen",
];

export default async function Home() {
  const reviews = await getPublishedReviews(6);

  return (
    <main>
      <section className="hero-shell pro-hero-shell">
        <header className="nav pro-nav">
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
            <Link href="/vereisten">Systeemvereisten</Link>
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

        <div className="hero-grid pro-hero-grid" id="top">
          <div className="hero-copy pro-hero-copy">
            <div className="eyebrow">
              <span />
              Live match control voor clubs en stadions
            </div>
            <h1>
              Eén regietafel voor score, sponsors en stadionvisuals.
            </h1>
            <p className="hero-lead">
              ArenaCue helpt operators om elke wedstrijdfase gecontroleerd te sturen: van klok en score tot
              sponsorrotatie, spelerintro&apos;s, display-output en LED boarding. Strak genoeg voor een stadion,
              simpel genoeg voor een vrijwilliger met gezonde stress.
            </p>
            <div className="hero-badges" aria-label="ArenaCue onderdelen">
              {highlights.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <div className="hero-actions">
              <a className="primary-button" href="#contact">
                Plan je ArenaCue demo
                <span>→</span>
              </a>
              <Link className="secondary-button" href="/functies">
                Bekijk functies
              </Link>
              <Link className="secondary-button" href="/vereisten">
                Check systeemvereisten
              </Link>
            </div>
            <dl className="trust-row pro-trust-row" aria-label="Belangrijkste voordelen">
              {stats.map((item) => (
                <div key={item.label}>
                  <dt>{item.value}</dt>
                  <dd>{item.label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="hero-visual pro-visual" aria-label="ArenaCue software preview">
            <div className="preview-window-bar">
              <div>
                <span />
                <span />
                <span />
              </div>
              <strong>Stadium Control</strong>
              <small>Connected · Match mode</small>
            </div>
            <div className="hero-preview-card pro-preview-card">
              <Image
                src="/assets/scoreboard-preview-hero.png"
                alt="ArenaCue control dashboard preview zonder clubnamen of officiële logo&apos;s"
                width={1672}
                height={941}
                className="hero-product-image pro-product-image"
                priority
              />
            </div>
            <div className="preview-metrics" aria-label="Preview eigenschappen">
              <div>
                <small>Output</small>
                <strong>1920 × 1080</strong>
              </div>
              <div>
                <small>Status</small>
                <strong>Live ready</strong>
              </div>
              <div>
                <small>Layout</small>
                <strong>Score + sponsor</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section pro-section" id="features">
        <div className="section-heading pro-section-heading">
          <p>Wat ArenaCue doet</p>
          <h2>Professionele controle zonder overbodige knoppenchaos.</h2>
        </div>
        <div className="feature-grid pro-feature-grid">
          {features.map((feature, index) => (
            <article className="feature-card pro-feature-card" key={feature.title}>
              <div className="feature-card-top">
                <div className="feature-index">{String(index + 1).padStart(2, "0")}</div>
                <span>{feature.tag}</span>
              </div>
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

      <section className="split-section pro-workflow-section" id="software">
        <div>
          <p className="section-kicker">Software delivery</p>
          <h2>Van opstart tot live output in een duidelijke workflow.</h2>
          <p>
            ArenaCue Scoreboard wordt geleverd als Windows-installer of portable build. ArenaCue LED boarding is een
            aparte download voor lint- en LED-schermen, met dezelfde heldere releaseflow.
          </p>
        </div>
        <ol className="workflow-timeline" aria-label="ArenaCue workflow">
          {workflow.map((item, index) => (
            <li key={item}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{item}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section product-section">
        <div className="product-grid">
          <article className="product-card product-card-primary">
            <p className="section-kicker">ArenaCue Scoreboard</p>
            <h2>Voor klok, score, sponsors en displays.</h2>
            <p>
              De centrale regiesoftware voor matchdagen. Operators sturen de volledige wedstrijdflow vanuit één
              dashboard, met duidelijke preview en snelle controles.
            </p>
            <Link className="secondary-button" href="/functies">
              Bekijk scoreboard features
            </Link>
          </article>
          <article className="product-card">
            <p className="section-kicker">ArenaCue LED boarding</p>
            <h2>Voor perimeter en tribuneschermen.</h2>
            <p>
              Een aparte app voor LED-zones, sponsorplaylists en breedbeeldcontent. Ideaal wanneer je boarding los van
              het scoreboard wil beheren.
            </p>
            <a className="secondary-button" href="#contact">
              Vraag LED boarding demo
            </a>
          </article>
        </div>
      </section>

      <section className="section product-section" id="pricing">
        <div className="product-grid">
          <article className="product-card product-card-primary">
            <p className="section-kicker">Prijs & licentie</p>
            <h2>Prijs op aanvraag, afgestemd op je club.</h2>
            <p>
              Elke club gebruikt een andere schermketen: één stadiondisplay, extra LED-zones, meerdere installaties of
              begeleiding bij opstart. Daarom maken we een voorstel op maat na een korte demo of intake.
            </p>
            <ul className="check-list compact">
              <li>Windows-build voor ArenaCue Scoreboard of LED boarding</li>
              <li>Klantportaal met download, licentiestatus en geactiveerde toestellen</li>
              <li>Release-updates met duidelijke changelog voor operators</li>
              <li>Advies over pc, schermresolutie en wedstrijddag-opstelling</li>
            </ul>
            <a className="secondary-button" href="#contact">
              Vraag prijsindicatie aan
            </a>
          </article>
          <article className="product-card">
            <p className="section-kicker">Voor je stadion-pc</p>
            <h2>Check eerst de systeemvereisten.</h2>
            <p>
              Video, sponsorrotatie en een tweede scherm vragen een stabiele Windows-pc. Bekijk de minimum- en
              aanbevolen specificaties voordat je ArenaCue op wedstrijddag inzet.
            </p>
            <Link className="secondary-button" href="/vereisten">
              Bekijk systeemvereisten
            </Link>
          </article>
        </div>
      </section>

      <section className="updates" id="updates">
        <div className="updates-card pro-updates-card">
          <div>
            <p className="section-kicker">Updates</p>
            <h2>Altijd duidelijk welke versie je draait.</h2>
            <p>
              Elke release krijgt een duidelijke versie en changelog, zodat clubs en operators snel weten wat nieuw is
              en met vertrouwen live kunnen werken.
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

      <section className="section reviews-section" id="reviews">
        <div className="section-heading pro-section-heading">
          <p>Reviews</p>
          <h2>Ervaringen van clubs en operators</h2>
        </div>
        {reviews.length > 0 ? (
          <div className="reviews-grid">
            {reviews.map((review) => (
              <article className="review-card" key={review.id}>
                <p className="review-quote">“{review.quote}”</p>
                <div className="review-meta">
                  <strong>{review.name}</strong>
                  <span>
                    {review.club}
                    {review.role ? ` · ${review.role}` : ""}
                  </span>
                </div>
                <div className="review-rating" aria-label={`${review.rating} op 5`}>
                  {"★".repeat(review.rating)}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="reviews-empty">
            Nog geen gepubliceerde reviews. Wil je als eerste je ervaring delen? Gebruik het formulier hieronder.
          </p>
        )}
        <div className="review-form-shell">
          <h3>Dien een review in</h3>
          <p>
            Je review wordt eerst nagekeken en daarna gepubliceerd op de website.
          </p>
          <ReviewSubmitForm />
        </div>
      </section>

      <section className="contact pro-contact" id="contact">
        <div>
          <p className="section-kicker">Start professioneel</p>
          <h2>Klaar om ArenaCue in je stadion of sportclub te gebruiken?</h2>
          <p>
            Plan een demo, bespreek je schermopstelling en ontvang de juiste download voor je club. We houden demo&apos;s
            bewust overzichtelijk met één test per e-mailadres en apparaat; daarna helpen we je verder naar een
            volledige licentie op hetzelfde toestel.
          </p>
        </div>
        <div className="contact-stack">
          <div className="contact-card pro-contact-card">
            <Image src="/assets/arenacue-icon.png" alt="" width={74} height={74} />
            <h3>Vraag een demo of download aan</h3>
            <p>
              Vul je gegevens in en we adviseren je meteen over de juiste ArenaCue-opstelling, systeemvereisten en
              licentie-aanpak voor jouw club.
            </p>
            <a className="secondary-button full" href="mailto:info@arenacue.be">
              info@arenacue.be
            </a>
          </div>
          <DemoRequestForm />
        </div>
      </section>

      <footer className="footer pro-footer">
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
