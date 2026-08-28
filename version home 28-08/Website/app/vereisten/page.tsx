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
          <li>
            Voor nieuwe B2B-installaties: <strong>Windows 11 Pro</strong> als standaard (beheer, updates, stabiliteit)
          </li>
          <li>Alle recente updates en stabiele grafische stuurprogramma&apos;s (Intel / AMD / NVIDIA)</li>
        </ul>

        <h2>Minimum (kleinere clubs, werkbaar)</h2>
        <p className="legal-muted">
          Geschikt voor scorebord + lichte tot middelzware sponsorvideo. Bij zware playlists of veel HD/4K-content zit
          deze klasse sneller tegen de grens.
        </p>
        <ul>
          <li>
            <strong>Processor:</strong> bij voorkeur <strong>6 cores / 12 threads</strong>, bv. Intel Core i5 (10e gen
            of nieuwer) of AMD Ryzen 5 3600+
          </li>
          <li>
            <strong>Geheugen:</strong> <strong>16 GB RAM</strong> (niet 8 GB voor matchday met video)
          </li>
          <li>
            <strong>Opslag:</strong> <strong>256 GB SSD</strong> minimum (NVMe aanbevolen), met voldoende ruimte voor
            mediabibliotheek
          </li>
          <li>
            <strong>Grafisch:</strong> recente iGPU kan voor basisgebruik, maar instap <strong>dedicated GPU</strong>{" "}
            (bv. GTX 1650-klasse of beter) is robuuster voor lange video-sessies
          </li>
          <li>
            <strong>Schermen:</strong> bedieningspaneel minimaal <strong>1920 × 1080</strong>; aparte videouitgang voor
            het stadionscherm volgens jullie installatie (HDMI/DisplayPort enz.)
          </li>
        </ul>

        <h2>Aanbevolen (profclub / zware matchday 4–6 uur)</h2>
        <p className="legal-muted">
          Voor hoge betrouwbaarheid met langere sessies, zwaardere video, meerdere outputs en minder risico op haperingen.
        </p>
        <ul>
          <li>
            <strong>Processor:</strong> Intel Core i7 (12e gen+) of AMD Ryzen 7 (5700X / 7700X of beter)
          </li>
          <li>
            <strong>Geheugen:</strong> <strong>32 GB RAM</strong>
          </li>
          <li>
            <strong>Grafisch:</strong> NVIDIA RTX 3060 / 4060-klasse of gelijkwaardig; focus op stabiele
            hardware-decode/encode en multi-display output
          </li>
          <li>
            <strong>Opslag:</strong> <strong>1 TB NVMe SSD</strong> (eventueel tweede SSD voor media om I/O te scheiden)
          </li>
          <li>
            <strong>Display outputs:</strong> liefst <strong>3+ uitgangen</strong> (operator + hoofdscherm + reserve /
            capture), afhankelijk van de setup
          </li>
          <li>
            <strong>Energie &amp; updates:</strong> wedstrijddag-profiel zonder energiebesparing; updatevensters plannen
            buiten wedstrijduren; onnodige zware achtergrondapps sluiten
          </li>
        </ul>

        <h2>Netwerk (afhankelijk van inzet)</h2>
        <p>
          De kern van Scoreboard kan <strong>volledig offline</strong>. Voor{" "}
          <strong>cloud remote control</strong>, <strong>licentiecontrole</strong> of koppelingen met online diensten is
          een stabiele internetverbinding nodig. Voor bediening via de <strong>mobiele app</strong> op hetzelfde netwerk
          is bekabeld Ethernet voor de wedstrijd-PC sterk aanbevolen; wifi alleen als fallback.
        </p>

        <h2>Matchday hardening (sterk aanbevolen)</h2>
        <ul>
          <li>
            <strong>UPS (noodstroom):</strong> korte stroomdip mag geen reboot en live-uitval veroorzaken
          </li>
          <li>
            <strong>Driver discipline:</strong> test GPU-drivers vooraf, niet blind vlak voor een wedstrijd updaten
          </li>
          <li>
            <strong>Preflight test:</strong> simuleer volledige wedstrijdflow met echte media op de doel-PC
          </li>
          <li>
            <strong>Failover:</strong> hou een reserve-output of fallback-beeld beschikbaar voor noodgevallen
          </li>
        </ul>

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
