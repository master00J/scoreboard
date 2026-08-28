import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { LegalFooter } from "@/components/legal-footer";
import { SeoBreadcrumbJsonLd } from "@/components/seo-breadcrumb-json-ld";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  segmentTitle: "Functies",
  description:
    "ArenaCue Scoreboard en ArenaCue LED boarding: alle hoofdfuncties voor wedstrijdregie, stadionscherm, sponsors, media — plus perimeter/tribune-LED met zones en playlists.",
  path: "/functies",
  keywordsExtra: [
    "wedstrijdregie",
    "LED boarding",
    "perimeterscherm",
    "stadionsoftware",
    "sponsorplanning",
    "wedstrijddisplay",
    "voetbal display software",
  ],
});

export default function FunctiesPage() {
  return (
    <main className="features-deep-page">
      <SeoBreadcrumbJsonLd
        items={[
          { name: "Home", path: "/" },
          { name: "Functies", path: "/functies" },
        ]}
      />

      <Link className="brand features-deep-brand" href="/">
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
      </Link>

      <article className="legal-card features-deep-card">
        <p className="section-kicker">Software</p>
        <h1>Alle functies</h1>
        <p className="features-deep-lead">
          ArenaCue bestaat uit <strong>twee producten</strong>: <strong>ArenaCue Scoreboard</strong> voor live
          wedstrijdregie en het hoofdstadionscherm, en <strong>ArenaCue LED boarding</strong> voor perimeter-, lint- en
          tribuneschermen met eigen zones en playlists. Hieronder zie je per product welke impact je operationeel mag
          verwachten.
        </p>
        <p className="features-deep-lead tight">
          <strong>Wedstrijd-PC:</strong> voor langere sessies (typisch 4–6 uur) met video en sponsorrotatie gelden
          concrete hardwarerichtlijnen — zie{" "}
          <Link href="/vereisten">systeemvereisten</Link>.
        </p>

        {/* —— Scoreboard —— */}
        <section className="features-product-block" aria-labelledby="heading-scoreboard">
          <h2 id="heading-scoreboard" className="features-product-title">
            ArenaCue Scoreboard
          </h2>
          <p className="features-deep-lead tight">
            Live scorebord, timer, wedstrijdmodi, sponsors naast of fullscreen op het display — één control‑paneel, één
            duidelijke regieflow naar je stadionscherm voor een professioneel wedstrijdbeeld.
          </p>

          <section className="features-deep-section" id="platform-scoreboard">
            <h3>Dagelijkse werking</h3>
            <ul className="features-deep-list">
              <li>
                <strong>Snel inzetbaar:</strong> focus op vlotte opstart voor regie op wedstrijddagen, zonder complexe
                voorbereiding.
              </li>
              <li>
                <strong>Betrouwbaar tijdens live momenten:</strong> gebouwd voor stabiele bediening wanneer timing
                cruciaal is.
              </li>
              <li>
                <strong>Duidelijke regieflow:</strong> operatorbediening en schermoutput zijn logisch gescheiden zodat je
                rustig en snel kunt schakelen.
              </li>
              <li>
                <strong>Toegang en licentie:</strong> activatie en status via het{" "}
                <Link href="/portal">online klantportaal</Link> van ArenaCue.
              </li>
            </ul>
          </section>

          <section className="features-deep-section" id="score">
            <h3>Live scorebord &amp; tijd</h3>
            <ul className="features-deep-list">
              <li>
                Bedien <strong>score</strong>, <strong>klok</strong> en <strong>wedstrijdfase</strong> (o.a. eerste
                helft, tweede helft, rust, extra time waar van toepassing).
              </li>
              <li>
                Duidelijke status voor start/pauze/hervatting van de timer; geschikt voor klassieke voetbalwedstrijden
                met configureerbare duur per helft en rust.
              </li>
              <li>
                Weergave op het stadionscherm met vaste layout en typografie — leesbaar op afstand, met teamlogo&apos;s
                en scores naast elkaar.
              </li>
            </ul>
          </section>

          <section className="features-deep-section" id="events">
            <h3>Wedstrijdgebeurtenissen</h3>
            <ul className="features-deep-list">
              <li>
                Goals vastleggen met scorer en tijdstip; geschikt voor celebratie- of intro-momenten op het scherm waar
                je dat configureert.
              </li>
              <li>
                <strong>Wissels:</strong> tonen van in- en uitgaande spelers tijdens een wisselmoment.
              </li>
              <li>
                <strong>Kaarten:</strong> visuele ondersteuning voor tijdelijke kaartmomenten (bijvoorbeeld gele kaart).
              </li>
              <li>
                <strong>Gebeurtenislog:</strong> chronologisch overzicht van acties voor de regie (inhoud kan per
                versie uitgebreid zijn).
              </li>
            </ul>
          </section>

          <section className="features-deep-section" id="sponsors">
            <h3>Sponsors &amp; schermtijd</h3>
            <ul className="features-deep-list">
              <li>
                <strong>Budget per fase:</strong> plan hoeveel seconden sponsors zichtbaar zijn in prematch, tijdens de
                wedstrijd (per helft), rust enzovoort — afgestemd op je contracten.
              </li>
              <li>
                <strong>Eerlijke verdeling:</strong> rotatie tussen sponsors op basis van verbruik en budget; clips
                lopen netjes uit zodat je niet midden in een spot moet onderbreken.
              </li>
              <li>
                <strong>Na budget:</strong> sponsoring kan stoppen en het scherm kan automatisch terugkeren naar het
                scorebord (instelbaar gedrag).
              </li>
              <li>
                Weergave <strong>fullscreen</strong> of <strong>naast het scorebord</strong> tijdens live phases —
                afhankelijk van modus en routing van je display.
              </li>
            </ul>
          </section>

          <section className="features-deep-section" id="media">
            <h3>Media, playlists &amp; visuals</h3>
            <ul className="features-deep-list">
              <li>
                Bibliotheek met <strong>video&apos;s en afbeeldingen</strong>; videoduur kan uit de bestanden worden
                gelezen bij import.
              </li>
              <li>
                <strong>Playlists</strong> per context (idle, prematch, rust, …) voor het tonen van generieke loops —
                bv. matchday-visual plus sponsor-loop zonder complex budgetbeheer.
              </li>
              <li>Sponsor-items gekoppeld aan sponsors met meerdere clips per sponsor waar nodig.</li>
            </ul>
          </section>

          <section className="features-deep-section" id="teams">
            <h3>Teams, spelers &amp; intros</h3>
            <ul className="features-deep-list">
              <li>
                Beheer van <strong>teams</strong> met logo&apos;s en kleuren voor herkenbare weergave.
              </li>
              <li>
                <strong>Spelers</strong> met nummers, namen en optionele foto&apos;s of persoonlijke video&apos;s (bv.
                bij goals of introductie).
              </li>
              <li>
                <strong>Team- en spelerintro&apos;s</strong> voor ceremonieel gebruik vóór of tijdens de wedstrijd.
              </li>
            </ul>
          </section>

          <section className="features-deep-section" id="special">
            <h3>Display-modi &amp; operatorgemak</h3>
            <ul className="features-deep-list">
              <li>
                Verschillende <strong>schermmodi</strong> (scoreboard only, sponsorrotatie, goal, wissel, rust/fulltime,
                enz.) schakel je vanuit het control panel.
              </li>
              <li>
                Ondersteuning voor <strong>blackout</strong> / hold-beeld waar je het scherm tijdelijk wilt dimmen of
                neutraliseren.
              </li>
              <li>
                Integratie van <strong>externe beeldbronnen</strong> (waar ondersteund) om extra videobeeld op het
                scherm te tonen.
              </li>
              <li>
                <strong>Toetsenbordsneltoetsen</strong> voor veelgebruikte acties (bv. timer start/stop) zodat operators
                snel blijven.
              </li>
            </ul>
          </section>

          <section className="features-deep-section" id="export">
            <h3>Na de wedstrijd</h3>
            <ul className="features-deep-list">
              <li>
                <strong>Export / samenvatting</strong> van de wedstrijd (o.a. voor archief of sharing) — beschikbaar
                volgens je softwareversie en configuratie.
              </li>
              <li>
                Gegevens en media blijven bij jou op locatie; er is geen verplichte cloud voor de kernworkflow tijdens
                de match.
              </li>
            </ul>
          </section>
        </section>

        {/* —— LED boarding —— */}
        <section className="features-product-block" aria-labelledby="heading-led">
          <h2 id="heading-led" className="features-product-title">
            ArenaCue LED boarding
          </h2>
          <p className="features-deep-lead tight">
            Losstaande app voor LED-randen en tribunes: je bouwt een <strong>pixelcanvas per zone</strong>, koppelt
            sponsors en playlists, en stuurt fullscreen output naar je LED‑processors — los van het hoofdscorebord, maar met
            hetzelfde licentie‑ en downloadpatroon als Scoreboard.
          </p>

          <section className="features-deep-section" id="led-platform">
            <h3>Dagelijkse werking</h3>
            <ul className="features-deep-list">
              <li>
                <strong>Zelfstandig product:</strong> LED boarding draait naast Scoreboard met een eigen setup voor
                perimeter en tribunes.
              </li>
              <li>
                <strong>Per stadion op maat:</strong> configuratie en media stem je af op je eigen LED-opstelling, zones
                en vakken.
              </li>
              <li>
                <strong>Licentie:</strong> zelfde <Link href="/portal">klantportaal</Link> voor status en downloads.
              </li>
            </ul>
          </section>

          <section className="features-deep-section" id="led-zones">
            <h3>Zones &amp; pixelcanvas</h3>
            <ul className="features-deep-list">
              <li>
                <strong>Configureerbare zones</strong> (bv. perimeter, tribune, lint): elk met eigen resolutie / canvas
                zodat je LED‑topologie kunt nabootsen.
              </li>
              <li>
                Optioneel een <strong>vast LED-segment</strong> per zone voor herhalende raster‑ of sponsorstroken,
                naast vrije canvasinhoud.
              </li>
              <li>
                Overzichtelijke editor om zones te beheren en naar het juiste outputvenster te routeren (fullscreen per
                zone-display).
              </li>
            </ul>
          </section>

          <section className="features-deep-section" id="led-content">
            <h3>Sponsors, playlists &amp; live</h3>
            <ul className="features-deep-list">
              <li>
                <strong>Sponsors met logo</strong> en visuele assets gekoppeld aan je LED-playlists.
              </li>
              <li>
                <strong>Playlist per segment</strong> (of zone): eigen loop of queue; waar ondersteund kan inhoud{" "}
                <strong>terugvallen op een live feed</strong> i.p.v. enkel vooraf opgenomen clips.
              </li>
              <li>Geschikt voor sponsorrotatie langs het veld zonder de wedstrijdlogica van het hoofdscorebord te mengen.</li>
            </ul>
          </section>

          <section className="features-deep-section" id="led-output">
            <h3>Output &amp; bediening</h3>
            <ul className="features-deep-list">
              <li>
                <strong>Output per zone</strong>, klaar om fullscreen op je LED-rij of processor te tonen.
              </li>
              <li>
                <strong>Sneltoetsen 1–9</strong> op het outputscherm om snel tussen vooraf gekozen slots of segmenten te
                schakelen tijdens de wedstrijd.
              </li>
            </ul>
          </section>

          <section className="features-deep-section" id="led-config">
            <h3>Config delen &amp; backup</h3>
            <ul className="features-deep-list">
              <li>
                <strong>JSON export/import</strong> van je LED‑configuratie — handig om tussen machines te kopiëren of een
                baseline voor het seizoen te bewaren.
              </li>
              <li>
                Instellingen blijven consistent en zijn makkelijk overdraagbaar tussen opstellingen.
              </li>
            </ul>
          </section>
        </section>

        <section className="features-deep-section" id="cta">
          <h3>Volgende stap</h3>
          <p className="features-deep-lead tight">
            Wil je weten welke functies exact in jouw licentie en versie zitten, of een demo op jouw scherm- én
            LED‑opstelling? Neem contact op — we helpen je met de juiste downloads en onboarding.
          </p>
          <div className="features-cta-row">
            <Link className="primary-button" href="/#contact">
              Demo aanvragen
              <span>→</span>
            </Link>
            <Link className="secondary-button" href="/changelog">
              Bekijk changelog
            </Link>
            <Link className="secondary-button" href="/portal">
              Klantportaal
            </Link>
          </div>
        </section>
      </article>

      <LegalFooter />
    </main>
  );
}
