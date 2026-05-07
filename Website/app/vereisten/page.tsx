import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { LegalFooter } from "@/components/legal-footer";
import { SeoBreadcrumbJsonLd } from "@/components/seo-breadcrumb-json-ld";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  segmentTitle: "Systeemvereisten",
  description:
    "Minimale en aanbevolen hardware voor ArenaCue Scoreboard en LED boarding op Windows — geschikt voor wedstrijddagen van 4–6 uur met video en sponsorrotatie.",
  path: "/vereisten",
  keywordsExtra: [
    "Windows",
    "hardware",
    "stadion PC",
    "videoweergave",
    "systeemvereisten",
    "aanbevolen specificaties",
  ],
});

export default function VereistenPage() {
  return (
    <main className="legal-page">
      <SeoBreadcrumbJsonLd
        items={[
          { name: "Home", path: "/" },
          { name: "Systeemvereisten", path: "/vereisten" },
        ]}
      />
      <Link className="brand" href="/">
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

      <article className="legal-card">
        <p className="section-kicker">Technisch</p>
        <h1>Systeemvereisten</h1>
        <p>
          ArenaCue <strong>Scoreboard</strong> en <strong>LED boarding</strong> draaien als{" "}
          <strong>Windows-desktopsoftware</strong> (Electron). Tijdens een typische wedstrijddag staat de pc vaak{" "}
          <strong>4 tot 6 uur</strong> aan met <strong>live regie</strong>, <strong>timer</strong> en herhaaldelijk{" "}
          <strong>fullscreen- of rotatievideo</strong> (sponsors, clips). Daarvoor is voldoende rekenkracht, geheugen
          en vooral <strong>betrouwbare videodecode</strong> op de GPU belangrijk.
        </p>

        <h2>Besturingssysteem</h2>
        <ul>
          <li>
            <strong>Windows 10 of Windows 11</strong> (64-bit)
          </li>
          <li>Alle recente updates en stabiele grafische stuurprogramma&apos;s (Intel / AMD / NVIDIA)</li>
        </ul>

        <h2>Minimum (werkbaar)</h2>
        <p className="legal-muted">
          Geschikt voor lichte tot middelzware playlists. Bij veel gelijktijdige HD/4K-video of lange speelduur kan de
          machine eerder tegen de grens aan zitten.
        </p>
        <ul>
          <li>
            <strong>Processor:</strong> 4 fysieke cores (of vergelijkbaar), bijv. Intel Core i5 (8e generatie of
            nieuwer) of AMD Ryzen 5 (2000-serie of nieuwer)
          </li>
          <li>
            <strong>Geheugen:</strong> <strong>8 GB RAM</strong>
          </li>
          <li>
            <strong>Opslag:</strong> <strong>SSD</strong> met minstens <strong>10 GB vrije ruimte</strong> voor programma
            en database (exclusief je mediabibliotheek — video&apos;s kunnen vele GB extra zijn)
          </li>
          <li>
            <strong>Grafisch:</strong> GPU met hardwarematige videodecode voor gangbare formaten (o.a. H.264); installeer
            de <strong>nieuwste officiële drivers</strong> van de fabrikant
          </li>
          <li>
            <strong>Schermen:</strong> bedieningspaneel minimaal <strong>1920 × 1080</strong>; aparte videouitgang voor
            het stadionscherm volgens jullie installatie (HDMI/DisplayPort enz.)
          </li>
        </ul>

        <h2>Aanbevolen voor wedstrijddag (4–6 uur, stevige video)</h2>
        <p className="legal-muted">
          Richtlijn voor comfortabele bediening met sponsorrotatie, langere clips en minder risico op haperingen of
          geheugendruk na uren draaien.
        </p>
        <ul>
          <li>
            <strong>Geheugen:</strong> <strong>16 GB RAM</strong>
          </li>
          <li>
            <strong>Processor:</strong> 6+ cores of recente mid-range CPU (bijv. Intel Core i5/i7 of AMD Ryzen 5/7,
            laatste generaties)
          </li>
          <li>
            <strong>Grafisch:</strong> <strong>dedicated GPU</strong> (entry-level is vaak al voldoende) of sterke
            geïntegreerde GPU (bijv. Intel Iris Xe, recente AMD RDNA); altijd <strong>actuele drivers</strong>
          </li>
          <li>
            <strong>Opslag:</strong> snelle <strong>NVMe SSD</strong> voor OS, app en cache; mediabestanden kunnen op een
            tweede schijf
          </li>
          <li>
            <strong>Energie &amp; achtergrond:</strong> op wedstrijddag <strong>geen energiebesparing op &quot;maximaal
            batterij&quot;</strong>; sluit onnodige zware apps (back-ups, game launchers, browser met veel tabs)
          </li>
        </ul>

        <h2>Netwerk (optioneel)</h2>
        <p>
          De kern van Scoreboard kan <strong>volledig offline</strong>. Voor{" "}
          <strong>cloud remote control</strong>, <strong>licentiecontrole</strong> of koppelingen met online diensten is
          een stabiele internetverbinding nodig. Voor bediening via de <strong>mobiele app</strong> op hetzelfde netwerk:
          zie de documentatie bij de app (firewall/poorten).
        </p>

        <h2>Mobiele app (operator)</h2>
        <p>
          De ArenaCue <strong>Android</strong>-app voor remote bediening heeft lagere eisen dan de wedstrijd-PC; een
          recente telefoon of tablet met ondersteunde Android-versie volstaat doorgaans. Zware videoweergave gebeurt op
          de desktop, niet op de telefoon.
        </p>

        <p className="legal-muted">
          Concrete limieten (resolutie, codec, bitrate) hangen af van jullie mediabestanden en schermconfiguratie. Bij
          twijfel: test een volledige wedstrijdsimulatie op de beoogde wedstrijd-PC vóór de eerste live inzet.
        </p>

        <p>
          <Link href="/functies">← Terug naar functies</Link>
          {" · "}
          <Link href="/">Home</Link>
        </p>
      </article>
      <LegalFooter />
    </main>
  );
}
