import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();

  const now = new Date();

  return [
    { url: siteUrl, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/privacy`, lastModified: now, changeFrequency: "monthly", priority: 0.35 },
    { url: `${siteUrl}/portal`, lastModified: now, changeFrequency: "monthly", priority: 0.45 },
  ];
}
