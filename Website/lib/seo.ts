import type { Metadata } from "next";
import { getSiteUrl } from "@/lib/site-url";

export const SITE_NAME = "ArenaCue";

/** Kernbegrippen voor zoekmachines (nl/be-context). */
export const SITE_KEYWORDS = [
  "ArenaCue",
  "scoreboard software",
  "LED boarding",
  "perimeterscherm",
  "stadionscoreboard",
  "stadiondisplay",
  "voetbal scorebord",
  "live scorebord",
  "display control",
  "sponsorrotatie",
  "sportclub software",
  "Windows scoreboard",
];

export function absoluteUrl(path: string): string {
  const origin = getSiteUrl().replace(/\/$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${normalized}`;
}

/** Standaard metadata voor binnenpagina's (title wordt `${segmentTitle} | ArenaCue` via layout-template). */
export function pageMetadata(opts: {
  segmentTitle: string;
  description: string;
  path: string;
  keywordsExtra?: string[];
}): Metadata {
  const url = absoluteUrl(opts.path);
  const keywords = [...SITE_KEYWORDS, ...(opts.keywordsExtra ?? [])];
  const ogTitle = `${opts.segmentTitle} | ${SITE_NAME}`;
  return {
    title: opts.segmentTitle,
    description: opts.description,
    keywords,
    alternates: {
      canonical: url,
      languages: {
        "nl-BE": url,
      },
    },
    openGraph: {
      title: ogTitle,
      description: opts.description,
      url,
      siteName: SITE_NAME,
      locale: "nl_BE",
      type: "website",
      images: [
        {
          url: "/assets/arenacue-icon.png",
          alt: `${SITE_NAME} — logo`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: opts.description,
      images: ["/assets/arenacue-icon.png"],
    },
  };
}

export function homePageMetadata(): Metadata {
  const url = absoluteUrl("/");
  const titleAbsolute = "ArenaCue | Scoreboard, LED boarding & Display Control";
  const description =
    "ArenaCue is professionele Windows-software voor live scoreboards, LED perimeter/tribune-output, sponsorrotatie en stadiondisplay. Lokaal, snel en betrouwbaar voor clubs en stadions.";
  return {
    title: { absolute: titleAbsolute },
    description,
    keywords: SITE_KEYWORDS,
    alternates: {
      canonical: url,
      languages: {
        "nl-BE": url,
      },
    },
    openGraph: {
      title: titleAbsolute,
      description:
        "Control every moment. Display every detail. Scoreboard- en LED-boardingsoftware voor Belgische sportclubs en stadions.",
      url,
      siteName: SITE_NAME,
      locale: "nl_BE",
      type: "website",
      images: [
        {
          url: "/assets/arenacue-icon.png",
          alt: `${SITE_NAME} — scoreboard- en LED-boardingsoftware voor Windows`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: titleAbsolute,
      description:
        "Professionele Windows-software voor scoreboards, LED boarding, sponsorrotatie en stadionvisuals.",
      images: ["/assets/arenacue-icon.png"],
    },
  };
}
