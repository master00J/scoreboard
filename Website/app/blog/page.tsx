import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { LegalFooter } from "@/components/legal-footer";
import { SeoBreadcrumbJsonLd } from "@/components/seo-breadcrumb-json-ld";
import { getPublishedSeoPosts } from "@/lib/seo-posts";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  segmentTitle: "Blog",
  description:
    "Praktische ArenaCue-artikels over scorebordsoftware, sponsorrotatie, stadiondisplay en LED boarding voor sportclubs.",
  path: "/blog",
  keywordsExtra: [
    "ArenaCue blog",
    "scoreboard software tips",
    "sponsorrotatie sportclub",
    "LED boarding uitleg",
  ],
});

export default async function BlogPage() {
  const posts = await getPublishedSeoPosts(48);

  return (
    <main className="features-deep-page">
      <SeoBreadcrumbJsonLd
        items={[
          { name: "Home", path: "/" },
          { name: "Blog", path: "/blog" },
        ]}
      />

      <Link className="brand features-deep-brand" href="/">
        <Image src="/assets/arenacue-icon.png" alt="" width={44} height={44} className="brand-icon" />
        <span>
          <strong>
            Arena<span>Cue</span>
          </strong>
          <small>Scoreboard, LED boarding &amp; Display Control</small>
        </span>
      </Link>

      <article className="legal-card features-deep-card">
        <p className="section-kicker">Kennisbank</p>
        <h1>ArenaCue blog</h1>
        <p className="features-deep-lead">
          Wekelijkse artikels met praktische inzichten voor sportclubs die scorebordsoftware, sponsorrotatie,
          stadiondisplay of LED boarding professioneler willen inzetten.
        </p>

        <section className="features-deep-section">
          {posts.length === 0 ? (
            <p className="features-deep-lead tight">
              Er zijn nog geen gepubliceerde blogartikels. Zodra de wekelijkse SEO-cron een artikel heeft gemaakt,
              verschijnt het hier automatisch.
            </p>
          ) : (
            <div className="seo-post-grid">
              {posts.map((post) => (
                <Link key={post.id} className="seo-post-card" href={`/blog/${post.slug}`}>
                  <time dateTime={post.published_at}>
                    {new Date(post.published_at).toLocaleDateString("nl-BE", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </time>
                  <h2>{post.title}</h2>
                  <p>{post.excerpt}</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </article>

      <LegalFooter />
    </main>
  );
}
