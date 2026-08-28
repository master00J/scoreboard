import type { MetadataRoute } from "next";
import { getAdminPathPrefix, getAdminPathSegment } from "@/lib/admin-url";
import { getSiteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  const disallow = [getAdminPathPrefix()];
  if (getAdminPathSegment() !== "admin") {
    disallow.push("/admin");
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow,
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
