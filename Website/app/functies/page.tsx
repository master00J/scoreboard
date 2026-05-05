import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { LegalFooter } from "@/components/legal-footer";
import { SeoBreadcrumbJsonLd } from "@/components/seo-breadcrumb-json-ld";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  segmentTitle: "Functies",
  description:
    "Ontdek alle hoofdfuncties van ArenaCue: live scorebord, timer, sponsors, media, teams, intro's, export en Windows-desktopbediening voor clubs en stadions.",
  path: "/functies",
  keywordsExtra: [
    "wedstrijdregie",
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
          <small>Scoreboard & Display Control</small>
        </span>
      </Link>

      <article className="legal-card features-deep-card">
        <p className="section-kicker">Software</p>
        <h1>Functies van ArenaCue</h1>
        <p className="features-deep-lead">
          ArenaCue is een Windows-desktopapplicatie voor live wedstrijddag: één machine voor regie
          (control) en één scherm voor het publiek (display). Hieronder lees je wat de software
          concreet voor je club of venue kan doen — van score tot sponsors tot export na de match.
        </p>

        <section className="features-deep-section" id="platform">
          <h2>Platform &amp; installatie</h2>
          <ul className="features-deep-list">
            <li>
              <strong>Windows-first:</strong> gebouwd voor snelle setup op een regie-laptop of PC,
              met ondersteuning voor installer en portable variant (afhankelijk van je release).
            </li>
            <li>
              <strong>Lokaal en wedstrijdklaar:</strong> kernfunctionaliteit werkt zonder internet;
              geschikt voor LAN en stabiele wedstrijdavond.
            </li>
            <li>
              <strong>Twee vensters:</strong> een controlevenster voor de operator en een
              uitgangsvenster voor het grote scherm (typisch 16:9, fullscreen).
            </li>
            <li>
              <strong>Licentie:</strong> activatie en status via het{" "}
              <Link href="/portal">online klantportaal</Link> van ArenaCue.
            </li>
          </ul>
        </section>

        <section className="features-deep-section" id="score">
          <h2>Live scorebord &amp; tijd</h2>
          <ul className="features-deep-list">
            <li>
              Bedien <strong>score</strong>, <strong>klok</strong> en <strong>wedstrijdfase</strong>{" "}
              (o.a. eerste helft, tweede helft, rust, extra time waar van toepassing).
            </li>
            <li>
              Duidelijke status voor start/pauze/hervatting van de timer; geschikt voor klassieke
              voetbalwedstrijden met configureerbare duur per helft en rust.
            </li>
            <li>
              Weergave op het stadionscherm met vaste layout en typografie — leesbaar op afstand,
              met teamlogo&apos;s en scores naast elkaar.
            </li>
          </ul>
        </section>

        <section className="features-deep-section" id="events">
          <h2>Wedstrijdgebeurtenissen</h2>
          <ul className="features-deep-list">
            <li>
              Goals vastleggen met scorer en tijdstip; geschikt voor celebratie- of intro-momenten op
              het scherm waar je dat configureert.
            </li>
            <li>
              <strong>Wissels:</strong> tonen van in- en uitgaande spelers tijdens een wisselmoment.
            </li>
            <li>
              <strong>Kaarten:</strong> visuele ondersteuning voor tijdelijke kaartmomenten (bijvoorbeeld
              gele kaart).
            </li>
            <li>
              <strong>Gebeurtenislog op scherm/logica:</strong> chronologisch overzicht van acties
              voor de regie (inhoud kan per versie uitgebreid zijn).
            </li>
          </ul>
        </section>

        <section className="features-deep-section" id="sponsors">
          <h2>Sponsors &amp; schermtijd</h2>
          <ul className="features-deep-list">
            <li>
              <strong>Budget per fase:</strong> plan hoeveel seconden sponsors zichtbaar zijn in
              prematch, tijdens de wedstrijd (per helft), rust enzovoort — afgestemd op je contracten.
            </li>
            <li>
              <strong>Eerlijke verdeling:</strong> rotatie tussen sponsors op basis van verbruik en
              budget; clips worden normaal volledig afgespeeld zodat je niet midden in een spot
              wordt afgebroken.
            </li>
            <li>
              <strong>Na budget:</strong> sponsoring kan stoppen en het scherm kan automatisch
              terugkeren naar het scorebord (instelbaar gedrag).
            </li>
            <li>
              Weergave <strong>fullscreen</strong> of <strong>naast het scorebord</strong> tijdens
              live phases — afhankelijk van modus en routing van je display.
            </li>
          </ul>
        </section>

        <section className="features-deep-section" id="media">
          <h2>Media, playlists &amp; visuals</h2>
          <ul className="features-deep-list">
            <li>
              Bibliotheek met <strong>video&apos;s en afbeeldingen</strong>; videoduur kan uit de
              bestanden worden gelezen bij import.
            </li>
            <li>
              <strong>Playlists</strong> per context (idle, prematch, rust, …) voor het tonen van
              generieke loops — bv. matchday-visual plus sponsor-loop zonder complex budgetbeheer.
            </li>
            <li>
              Sponsor-items gekoppeld aan sponsors met meerdere clips per sponsor waar nodig.
            </li>
          </ul>
        </section>

        <section className="features-deep-section" id="teams">
          <h2>Teams, spelers &amp; intros</h2>
          <ul className="features-deep-list">
            <li>
              Beheer van <strong>teams</strong> met logo&apos;s en kleuren voor herkenbare weergave.
            </li>
            <li>
              <strong>Spelers</strong> met nummers, namen en optionele foto&apos;s of persoonlijke
              video&apos;s (bv. bij goals of introductie).
            </li>
            <li>
              <strong>Team- en spelerintro&apos;s</strong> voor ceremonieel gebruik vóór of tijdens
              de wedstrijd.
            </li>
          </ul>
        </section>

        <section className="features-deep-section" id="special">
          <h2>Display-modi &amp; operatorgemak</h2>
          <ul className="features-deep-list">
            <li>
              Verschillende <strong>schermmodi</strong> (scoreboard only, sponsorrotatie, goal,
              wissel, rust/fulltime, enz.) schakel je vanuit het control panel.
            </li>
            <li>
              Ondersteuning voor <strong>blackout</strong> / hold-beeld waar je het scherm tijdelijk
              wilt dimmen of neutraliseren.
            </li>
            <li>
              Werken met <strong>externe capture-bronnen</strong> (waar ondersteund) om bv. extern
              videobeeld op het canvas te tonen.
            </li>
            <li>
              <strong>Toetsenbordsneltoetsen</strong> voor veelgebruikte acties (bv. timer start/stop)
              zodat operators snel blijven.
            </li>
          </ul>
        </section>

        <section className="features-deep-section" id="export">
          <h2>Na de wedstrijd</h2>
          <ul className="features-deep-list">
            <li>
              <strong>Export / samenvatting</strong> van de wedstrijd (o.a. voor archief of sharing)
              — beschikbaar volgens je softwareversie en configuratie.
            </li>
            <li>
              Gegevens en media blijven bij jou op locatie; er is geen verplichte cloud voor de
              kernworkflow tijdens de match.
            </li>
          </ul>
        </section>

        <section className="features-deep-section" id="cta">
          <h2>Volgende stap</h2>
          <p className="features-deep-lead tight">
            Wil je weten welke functies exact in jouw licentie en versie zitten, of een demo op jouw
            schermopstelling? Neem contact op — we helpen je met de juiste download en onboarding.
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
