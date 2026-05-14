import { absoluteUrl, SITE_NAME } from "@/lib/seo";

/** Sitewide structured data (Organization, WebSite, SoftwareApplication). */
export function SeoJsonLd() {
  const rootUrl = absoluteUrl("/");
  const logoUrl = absoluteUrl("/assets/arenacue-icon.png");
  const screenshotUrl = absoluteUrl("/assets/scoreboard-preview-hero.png");

  const graph = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${rootUrl}#organization`,
      name: SITE_NAME,
      url: rootUrl,
      logo: logoUrl,
      email: "info@arenacue.be",
      contactPoint: {
        "@type": "ContactPoint",
        email: "info@arenacue.be",
        contactType: "sales",
        areaServed: "BE",
        availableLanguage: ["nl", "en"],
      },
      areaServed: ["BE", "NL"],
      knowsAbout: [
        "scoreboard software",
        "LED boarding",
        "stadiondisplay",
        "sponsorrotatie",
        "wedstrijdregie",
      ],
      sameAs: [] as string[],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${rootUrl}#website`,
      name: SITE_NAME,
      url: rootUrl,
      description:
        "ArenaCue — professionele Windows-scoreboardsoftware voor clubs en stadions: live scorebord, sponsorrotatie en display control.",
      publisher: { "@id": `${rootUrl}#organization` },
      about: { "@id": `${rootUrl}#software` },
      inLanguage: "nl-BE",
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "@id": `${rootUrl}#software`,
      name: `${SITE_NAME} Stadium Scoreboard`,
      description:
        "Windows-software voor live scorebord, wedstrijdregie, sponsorrotatie, stadiondisplay en LED boarding.",
      applicationCategory: "SportsApplication",
      applicationSubCategory: "ScoreboardSoftware",
      operatingSystem: "Windows",
      softwareRequirements: "Windows 10 of Windows 11, 64-bit",
      image: screenshotUrl,
      screenshot: screenshotUrl,
      inLanguage: "nl-BE",
      audience: {
        "@type": "Audience",
        audienceType: "Sportclubs, stadions en wedstrijdorganisaties",
      },
      featureList: [
        "Live scorebord en timer",
        "Sponsorrotatie per wedstrijdfase",
        "Stadiondisplay output",
        "LED boarding playlists",
        "Mobiele bediening via LAN of cloud",
      ],
      offers: {
        "@type": "Offer",
        url: absoluteUrl("/#contact"),
        availability: "https://schema.org/OnlineOnly",
        seller: { "@id": `${rootUrl}#organization` },
      },
      publisher: { "@id": `${rootUrl}#organization` },
    },
  ];

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
