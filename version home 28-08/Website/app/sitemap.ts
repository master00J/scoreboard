import type { MetadataRoute } from "next";
import { getSeoSitemapEntries } from "@/lib/seo-posts";
import { getSiteUrl } from "@/lib/site-url";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();

  const now = new Date();
  const seoPosts = await getSeoSitemapEntries();

  return [
    { url: siteUrl, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/functies`, lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    {
      url: `${siteUrl}/arenacue-kleine-middelgrote-clubs`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    { url: `${siteUrl}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.55 },
    ...seoPosts.map((post) => ({
      url: `${siteUrl}/blog/${post.slug}`,
      lastModified: new Date(post.published_at),
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
    { url: `${siteUrl}/vereisten`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${siteUrl}/changelog`, lastModified: now, changeFrequency: "weekly", priority: 0.35 },
    { url: `${siteUrl}/licenses`, lastModified: now, changeFrequency: "monthly", priority: 0.25 },
    { url: `${siteUrl}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${siteUrl}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
