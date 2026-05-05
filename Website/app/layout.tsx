import type { Metadata, Viewport } from "next";
import { getSiteUrl } from "@/lib/site-url";
import "./globals.css";

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "ArenaCue | Scoreboard, LED boarding & Display Control",
  description:
    "ArenaCue is professionele Windows-software voor live scoreboards, LED boarding, sponsorrotatie, matchstatus en stadiondisplay control.",
  icons: {
    icon: "/assets/arenacue-icon.png",
    apple: "/assets/arenacue-icon.png",
  },
  manifest: "/manifest.webmanifest",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "ArenaCue | Scoreboard, LED boarding & Display Control",
    description:
      "Control every moment. Display every detail. Scoreboard- en LED-boardingsoftware voor sportclubs en stadions.",
    type: "website",
    locale: "nl_BE",
    siteName: "ArenaCue",
    images: ["/assets/arenacue-icon.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "ArenaCue | Scoreboard, LED boarding & Display Control",
    description:
      "Professionele Windows-software voor scoreboards, LED perimeter/tribune-output, sponsorrotatie en stadionvisuals.",
    images: ["/assets/arenacue-icon.png"],
  },
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
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
