import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LegalFooter } from "@/components/legal-footer";
import { SeoBreadcrumbJsonLd } from "@/components/seo-breadcrumb-json-ld";
import { absoluteUrl, pageMetadata } from "@/lib/seo";
import { getPublishedSeoPostBySlug } from "@/lib/seo-posts";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedSeoPostBySlug(slug);
  if (!post) {
    return pageMetadata({
      segmentTitle: "Blogartikel",
      description: "ArenaCue blogartikel over scoreboard software, sponsorrotatie en LED boarding.",
      path: `/blog/${slug}`,
    });
  }

  return pageMetadata({
    segmentTitle: post.title,
    description: post.meta_description,
    path: `/blog/${post.slug}`,
    keywordsExtra: post.keywords,
  });
}

export default async function SeoBlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = await getPublishedSeoPostBySlug(slug);
  if (!post) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.meta_description,
    url: absoluteUrl(`/blog/${post.slug}`),
    image: absoluteUrl("/assets/scoreboard-preview-hero.png"),
    datePublished: post.published_at,
    dateModified: post.published_at,
    inLanguage: "nl-BE",
    keywords: post.keywords,
    articleSection: "Scoreboard software",
    author: {
      "@type": "Organization",
      name: "ArenaCue",
      url: absoluteUrl("/"),
    },
    publisher: {
      "@type": "Organization",
      name: "ArenaCue",
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl("/assets/arenacue-icon.png"),
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": absoluteUrl(`/blog/${post.slug}`),
    },
  };

  return (
    <main className="features-deep-page">
      <SeoBreadcrumbJsonLd
        items={[
          { name: "Home", path: "/" },
          { name: "Blog", path: "/blog" },
          { name: post.title, path: `/blog/${post.slug}` },
        ]}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Link className="brand features-deep-brand" href="/">
        <Image src="/assets/arenacue-icon.png" alt="" width={44} height={44} className="brand-icon" />
        <span>
          <strong>
            Arena<span>Cue</span>
          </strong>
          <small>Scoreboard, LED boarding &amp; Display Control</small>
        </span>
      </Link>

      <article className="legal-card features-deep-card seo-article">
        <p className="section-kicker">ArenaCue blog</p>
        <h1>{post.title}</h1>
        <time className="seo-article-date" dateTime={post.published_at}>
          {new Date(post.published_at).toLocaleDateString("nl-BE", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </time>
        <p className="features-deep-lead">{post.content_json.intro}</p>

        {post.content_json.sections.map((section) => (
          <section className="features-deep-section" key={section.heading}>
            <h2>{section.heading}</h2>
            <p className="features-deep-lead tight">{section.body}</p>
          </section>
        ))}

        <section className="features-deep-section">
          <h2>Conclusie</h2>
          <p className="features-deep-lead tight">{post.content_json.conclusion}</p>
          <div className="features-cta-row">
            <Link className="primary-button" href="/#contact">
              Demo aanvragen
            </Link>
            <Link className="secondary-button" href="/functies">
              Bekijk functies
            </Link>
            <Link className="secondary-button" href="/arenacue-kleine-middelgrote-clubs">
              Voor clubs
            </Link>
            <Link className="secondary-button" href="/blog">
              Meer artikels
            </Link>
          </div>
        </section>
      </article>

      <LegalFooter />
    </main>
  );
}
