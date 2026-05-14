import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { LegalFooter } from "@/components/legal-footer";
import { SeoBreadcrumbJsonLd } from "@/components/seo-breadcrumb-json-ld";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  segmentTitle: "ArenaCue voor kleine en middelgrote clubs",
  description:
    "ArenaCue helpt kleine en middelgrote sportclubs professioneel te scoren, sponsors zichtbaar te maken en wedstrijddagen eenvoudiger te regisseren zonder zware stadioninfrastructuur.",
  path: "/arenacue-kleine-middelgrote-clubs",
  keywordsExtra: [
    "scoreboard software kleine clubs",
    "scorebord sportclub",
    "sponsorrotatie voetbalclub",
    "stadionscherm software",
    "voetbalclub scorebord",
    "ArenaCue clubs",
  ],
});

const benefits = [
  {
    title: "Professionele uitstraling zonder complexe regie",
    text: "Bedien score, klok, fases, goalmomenten en sponsorvisuals vanuit een duidelijke Windows-app. Ideaal voor vrijwilligers of clubmedewerkers die snel moeten kunnen schakelen.",
  },
  {
    title: "Sponsors krijgen zichtbare waarde",
    text: "Plan sponsorclips, afbeeldingen en rotaties rond prematch, rust en live wedstrijdmomenten. Zo wordt schermtijd concreet verkoopbaar voor lokale partners.",
  },
  {
    title: "Groeit mee met je infrastructuur",
    text: "Start met een hoofdscherm of LED-output en breid later uit met extra media, spelers, playlists of LED boarding workflows wanneer de club daar klaar voor is.",
  },
];

const useCases = [
  "Voetbalclubs met een bestaand LED-scherm of tv-output langs het veld.",
  "Sportverenigingen die sponsors professioneler willen tonen tijdens wedstrijddagen.",
  "Clubs die een lokale, betrouwbare oplossing willen zonder verplichte cloud voor de live regie.",
  "Organisaties die met beperkte bezetting toch scorebord, media en sponsorrotatie willen beheren.",
];

export default function SmallMediumClubsPage() {
  return (
    <main className="features-deep-page">
      <SeoBreadcrumbJsonLd
        items={[
          { name: "Home", path: "/" },
          { name: "Kleine en middelgrote clubs", path: "/arenacue-kleine-middelgrote-clubs" },
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
        <p className="section-kicker">Voor clubs</p>
        <h1>ArenaCue voor kleine en middelgrote clubs</h1>
        <p className="features-deep-lead">
          Niet elke club heeft een volledige stadionregie nodig. ArenaCue is gemaakt om ook kleinere en middelgrote
          sportclubs een professioneel wedstrijdbeeld te geven: scorebord, klok, sponsorrotatie, media en live
          wedstrijdmomenten vanuit één overzichtelijke bediening.
        </p>
        <p className="features-deep-lead tight">
          De kern draait lokaal op je wedstrijd-PC. Daardoor blijft de live bediening betrouwbaar op wedstrijddagen,
          terwijl cloud- en mobiele functies kunnen helpen voor extra gemak waar dat past.
        </p>

        <section className="features-deep-section">
          <h2>Waarom clubs hiervoor kiezen</h2>
          <div className="features-mini-grid">
            {benefits.map((benefit) => (
              <div key={benefit.title} className="features-mini-card">
                <h3>{benefit.title}</h3>
                <p>{benefit.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="features-deep-section">
          <h2>Geschikt voor</h2>
          <ul className="features-deep-list">
            {useCases.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="features-deep-section">
          <h2>Wat je meteen kunt inzetten</h2>
          <ul className="features-deep-list">
            <li>
              <strong>Live scorebord:</strong> score, timer, wedstrijdstatus en duidelijke schermweergave voor publiek.
            </li>
            <li>
              <strong>Wedstrijdmomenten:</strong> goals, wissels, kaarten en team- of spelerintro&apos;s waar je die
              visueel wilt ondersteunen.
            </li>
            <li>
              <strong>Sponsorrotatie:</strong> media en playlists voor lokale sponsors, prematch, rust en live fases.
            </li>
            <li>
              <strong>Mobiele bediening:</strong> optioneel via LAN of cloud voor snelle acties vanaf een telefoon.
            </li>
          </ul>
        </section>

        <section className="features-deep-section">
          <h2>Meer weten?</h2>
          <p className="features-deep-lead tight">
            Bekijk de volledige <Link href="/functies">functielijst</Link>, controleer de{" "}
            <Link href="/vereisten">systeemvereisten</Link> of vraag een demo aan via de homepage.
          </p>
          <div className="hero-actions">
            <Link className="primary-button" href="/#contact">
              Demo aanvragen
            </Link>
            <Link className="secondary-button" href="/functies">
              Bekijk functies
            </Link>
          </div>
        </section>
      </article>

      <LegalFooter />
    </main>
  );
}
