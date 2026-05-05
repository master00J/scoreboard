import { absoluteUrl, SITE_NAME } from "@/lib/seo";

/** Sitewide structured data (Organization, WebSite, SoftwareApplication). */
export function SeoJsonLd() {
  const rootUrl = absoluteUrl("/");
  const logoUrl = absoluteUrl("/assets/arenacue-icon.png");

  const graph = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${rootUrl}#organization`,
      name: SITE_NAME,
      url: rootUrl,
      logo: logoUrl,
      email: "info@arenacue.be",
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
      inLanguage: "nl-BE",
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "@id": `${rootUrl}#software`,
      name: `${SITE_NAME} Stadium Scoreboard`,
      applicationCategory: "SportsApplication",
      operatingSystem: "Windows",
      offers: {
        "@type": "Offer",
        url: absoluteUrl("/portal"),
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
