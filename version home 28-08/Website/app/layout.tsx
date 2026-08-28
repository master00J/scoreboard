import type { Metadata, Viewport } from "next";
import { getSiteUrl } from "@/lib/site-url";
import { SITE_KEYWORDS } from "@/lib/seo";
import { SiteShell } from "@/components/site-shell";
import { SeoJsonLd } from "@/components/seo-json-ld";
import { SupportChatWidget } from "@/components/support-chat-widget";
import "./globals.css";
import "./globals-professional-home.css";

const siteUrl = getSiteUrl();

const googleVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "ArenaCue | Scoreboard, LED boarding & Display Control",
    template: "%s | ArenaCue",
  },
  description:
    "ArenaCue is professionele Windows-software voor live scoreboards, LED boarding, sponsorrotatie, matchstatus en stadiondisplay.",
  keywords: SITE_KEYWORDS,
  authors: [{ name: "ArenaCue", url: siteUrl }],
  creator: "ArenaCue",
  publisher: "ArenaCue",
  icons: {
    icon: "/assets/arenacue-icon.png",
    apple: "/assets/arenacue-icon.png",
  },
  manifest: "/manifest.webmanifest",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  ...(googleVerification ? { verification: { google: googleVerification } } : {}),
};

export const viewport: Viewport = {
  themeColor: "#020617",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl-BE">
      <body>
        <SeoJsonLd />
        <SiteShell>{children}</SiteShell>
        <SupportChatWidget />
      </body>
    </html>
  );
}
