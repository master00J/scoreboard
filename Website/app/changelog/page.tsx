import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { LegalFooter } from "@/components/legal-footer";
import { SeoBreadcrumbJsonLd } from "@/components/seo-breadcrumb-json-ld";
import { getCustomerChangelog } from "@/lib/customer-changelog";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = {
  ...pageMetadata({
    segmentTitle: "Changelog",
    description:
      "Overzicht van klantrelevante updates voor ArenaCue-software en het licentieportaal.",
    path: "/changelog",
    keywordsExtra: ["release notes", "updates ArenaCue"],
  }),
  robots: { index: true, follow: true },
};

function formatDisplayDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat("nl-BE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

export default function ChangelogPage() {
  const entries = getCustomerChangelog();

  return (
    <main className="legal-page">
      <SeoBreadcrumbJsonLd
        items={[
          { name: "Home", path: "/" },
          { name: "Changelog", path: "/changelog" },
        ]}
      />
      <a className="brand" href="/">
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
      </a>

      <article className="legal-card changelog-card">
        <p className="section-kicker">Productupdates</p>
        <h1>Changelog</h1>
        <p className="changelog-intro">
          Hier tonen we wijzigingen die voor clubs en operators relevant zijn — nieuwe functies,
          gedrag van sponsoring en display, het licentieportaal en de website.
        </p>
        <p className="changelog-intro muted-link-wrap">
          Staat je versie niet vermeld? Open het{" "}
          <Link href="/portal">klantportaal</Link> voor de actuele download. De desktopapp kan
          automatisch controleren of er een nieuwere build beschikbaar is.
        </p>

        {entries.length === 0 ? (
          <p className="changelog-empty">Er zijn nog geen changelog-items geplaatst.</p>
        ) : (
          <div className="changelog-timeline">
            {entries.map((entry, index) => (
              <article key={`${entry.date}-${entry.title}-${index}`} className="changelog-entry">
                <div className="changelog-entry-meta">
                  <time dateTime={entry.date}>{formatDisplayDate(entry.date)}</time>
                  {entry.version ? (
                    <span className="changelog-version" title="Softwareversie">
                      v{entry.version}
                    </span>
                  ) : null}
                </div>
                <h2>{entry.title}</h2>
                {entry.bullets.length > 0 ? (
                  <ul>
                    {entry.bullets.map((b, bi) => (
                      <li key={`${entry.date}-${bi}-${b.slice(0, 24)}`}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        )}

        <p className="changelog-footnote">
          Wil je op de hoogte blijven van releases? Houd het klantportaal in de gaten of{" "}
          <a href="/#contact">vraag een demo aan</a> — we verwijzen je dan naar de juiste download.
        </p>
      </article>

      <LegalFooter />
    </main>
  );
}
