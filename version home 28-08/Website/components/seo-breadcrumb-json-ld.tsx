import { absoluteUrl } from "@/lib/seo";

export type BreadcrumbItem = { name: string; path: string };

/** BreadcrumbList voor zoekmachines. */
export function SeoBreadcrumbJsonLd({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: absoluteUrl(it.path),
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
