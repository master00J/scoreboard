import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Privacy | ArenaCue",
  description: "Privacyverklaring voor ArenaCue demo-aanvragen en websitegebruik.",
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <a className="brand" href="/">
        <Image
          src="/assets/arenacue-icon.png"
          alt=""
          width={44}
          height={44}
          className="brand-icon"
        />
        <span>
          <strong>Arena<span>Cue</span></strong>
          <small>Scoreboard, LED boarding &amp; Display Control</small>
        </span>
      </a>
      <article className="legal-card">
        <p className="section-kicker">Privacy</p>
        <h1>Privacyverklaring</h1>
        <p>
          ArenaCue verwerkt alleen gegevens die nodig zijn om demo-aanvragen,
          productvragen en zakelijke communicatie op te volgen.
        </p>

        <h2>Welke gegevens verwerken we?</h2>
        <p>
          Wanneer je een demo aanvraagt, kunnen we je naam, e-mailadres,
          club/organisatie, telefoonnummer en bericht bewaren.
        </p>

        <h2>Waarom verwerken we die gegevens?</h2>
        <p>
          We gebruiken deze gegevens om je aanvraag te beantwoorden, een demo te
          plannen en relevante productinformatie te bezorgen.
        </p>

        <h2>Bewaartermijn</h2>
        <p>
          Demo-aanvragen bewaren we zolang dat redelijk nodig is voor opvolging,
          verkoop en support. Je kunt altijd vragen om je gegevens te laten
          verwijderen.
        </p>

        <h2>Contact</h2>
        <p>
          Vragen over privacy? Mail naar{" "}
          <a href="mailto:info@arenacue.be">info@arenacue.be</a>.
        </p>
      </article>
    </main>
  );
}
