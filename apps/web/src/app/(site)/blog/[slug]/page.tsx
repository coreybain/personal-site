import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PostHero } from "@/components/site/blog/PostHero";
import { PostNav } from "@/components/site/blog/PostNav";
import { Prose } from "@/components/site/blog/Prose";
import { ArticleJsonLd } from "@/components/site/seo";
import { getPosts, getSiteData } from "@/lib/data";
import { deriveBlog } from "@/lib/derive";
import { renderMarkdown } from "@/lib/markdown";

import "../blog.css";

type PostParams = { slug: string };

/**
 * ISR, five minutes — the window every `(site)` page declares. Written as a
 * literal because Next requires the value to be statically analysable; see the
 * ISR section of `@/lib/data`'s header.
 */
export const revalidate = 300;

/**
 * The published posts, prerendered at build time.
 *
 * **Legitimately empty at launch.** This is the one `generateStaticParams` in
 * the app that can return `[]` in normal operation: `getPosts()` has no mock
 * fallback (ADR 018), so a deployment with nothing published prerenders no post
 * pages at all — and there are none to prerender. That is not the degraded case
 * `/work/[slug]` guards against; it is the launch state, and `dynamicParams`
 * below covers the first post whenever it lands.
 *
 * This is the *build-time* list, not the whole list: `generateStaticParams` runs
 * during `next build` only and is not re-run by ISR.
 */
export async function generateStaticParams(): Promise<PostParams[]> {
  const posts = await getPosts();

  return posts.map((post) => ({ slug: post.slug }));
}

/**
 * Slugs not prerendered above render on demand, then cache for the same 300s as
 * everything else.
 *
 * `true`, for the reason `/work/[slug]` settled on `true`, only more so: with an
 * empty build-time list, `false` would 404 **every post ever written** until the
 * next deploy. A post published from the admin appears in the /blog index within
 * one revalidation window; the detail page has to agree with it.
 *
 * It costs nothing in correctness because the page below 404s on its own.
 * `getPostBySlug` searches the published list from an anonymous Convex client,
 * so a draft slug and a nonexistent slug are both `undefined` and both get
 * `notFound()` — a real 404, generated once and cached, not a rendered page.
 * That is the property the admin's editor screen describes to the author.
 */
export const dynamicParams = true;

/**
 * Per-post metadata: title, description and Open Graph, from the row.
 *
 * Ownership boundary — the site-wide defaults (`metadataBase`, the default OG
 * image, `robots`, the canonical host per ADR 017) belong to the SEO pass and
 * are set once in the root layout. What is *per post* is here, and nothing here
 * assumes what that pass will do beyond the two things Next guarantees:
 * `openGraph` from this segment replaces the parent's `openGraph` wholesale
 * rather than merging into it, and a relative image URL is resolved against
 * whatever `metadataBase` ends up being. The cover URL is absolute (UploadThing,
 * ADR 010), so it is correct either way.
 *
 * `type: "article"` with `publishedTime` emits `article:published_time`, which
 * is what makes a post look like a post rather than a page to anything that
 * reads the graph. The date is the first-publication instant — stamped once by
 * `posts.publish` and never re-dated — so it does not move when a typo is fixed.
 *
 * A slug that resolves to nothing returns bare title metadata rather than
 * throwing: this function runs *before* the page's `notFound()`, and a metadata
 * exception on a 404 would turn a clean 404 into a 500. It gets no canonical,
 * because a page that does not exist has no canonical URL.
 *
 * ── Amended by the SEO pass ────────────────────────────────────────────────
 *
 * Two changes, both site-wide concerns rather than per-post ones, and both
 * exactly the kind of thing the ownership note above hands over:
 *
 *   1. The titles are now **bare**. `(site)/layout.tsx` declares
 *      `title.template: "%s — Corey Baines"`, applied once from live identity,
 *      so `${post.title} — ${identity.name}` here would render doubled.
 *   2. `alternates.canonical` is set per post. It resolves against
 *      `metadataBase` (ADR 017), which is what stops a preview deployment
 *      competing with production for the same post.
 *
 * The `openGraph` block is untouched, and the prediction it was written against
 * held: a segment's `openGraph` replaces the parent's wholesale, so the cover
 * image below wins over the site-wide card image set in the root layout.
 *
 * ── Amended again by the launch-hygiene pass ───────────────────────────────
 *
 * "Replaces wholesale" cuts both ways, and curling a rendered post is what
 * showed it. Every other page on the site emits `og:site_name` and `og:locale`,
 * inherited from the root layout because those pages declare no `openGraph` of
 * their own. A post declares one — so it was inheriting neither, and its card
 * was the only card on the site with no site name under the headline.
 *
 * Both are restated below. They are not per-post facts, which is exactly why
 * they are easy to lose here: the fix is to repeat them, because Next offers no
 * way to merge into a parent's `openGraph`. `identity` is already in hand, so it
 * costs nothing. If a second page ever needs its own `openGraph`, it needs these
 * two lines too.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<PostParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [{ identity }, posts] = await Promise.all([getSiteData(), getPosts()]);
  const post = posts.find((p) => p.slug === slug);

  if (!post) {
    return { title: "Writing" };
  }

  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      // Restated, not inherited — see the docblock's second amendment.
      siteName: identity.name,
      locale: "en_AU",
      title: post.title,
      description: post.excerpt,
      publishedTime: post.publishedAt,
      authors: [identity.name],
      tags: post.tags,
      images: [
        {
          url: post.coverImage.url,
          alt: post.coverImage.alt,
          // Forwarded only when the row carries them. Absent dimensions are
          // legal in the graph and better than invented ones — every consumer
          // falls back to fetching the image.
          ...(post.coverImage.width !== undefined
            ? { width: post.coverImage.width }
            : null),
          ...(post.coverImage.height !== undefined
            ? { height: post.coverImage.height }
            : null),
        },
      ],
    },
  };
}

/**
 * /blog/[slug] — one post.
 *
 * Sky for the head, a seam, sky again for the body and the timeline links.
 * **No deck.** Every other detail page on this site crosses the horizon because
 * it has measurements to put down there; a post has an argument instead, and
 * inventing telemetry to fill a deck zone would be the site doing the exact
 * thing it was rebuilt to stop doing. The `.blog-seam` rule keeps the horizon's
 * beat without pretending there is instrumentation behind it.
 *
 * ── One read, one render ───────────────────────────────────────────────────
 *
 * The post, its index, its neighbours and the identity line all come from the
 * same pair of `cache()`d reads, so the `03 / 07` in the hero and the "older
 * post" at the foot cannot disagree with each other.
 *
 * The body is compiled to HTML **here, on the server**, by `@/lib/markdown` —
 * once per ISR window, not once per visitor, and never in a browser. See
 * `<Prose>` for why the result is set as HTML and why that is safe.
 */
export default async function PostPage({
  params,
}: {
  params: Promise<PostParams>;
}) {
  const { slug } = await params;
  const [{ identity }, posts] = await Promise.all([getSiteData(), getPosts()]);

  const blog = deriveBlog(posts);
  const index = blog.postIndex(slug);

  if (index === -1) notFound();

  const post = posts[index];
  const { prev, next } = blog.neighbours(index);
  const html = await renderMarkdown(post.body);

  return (
    <main>
      {/* Article, from the SEO pass's shared graph — one import, the post and
          the identity this page already holds, no extra reads and no client JS.
          It authors nothing and asserts nothing the page does not print; see
          components/site/seo/ArticleJsonLd.tsx for what it deliberately leaves
          out (a `dateModified` there is no honest source for). */}
      <ArticleJsonLd post={post} identity={identity} />

      {/* ── the head ──────────────────────────────────────────────── */}
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell">
          <PostHero
            post={post}
            index={index}
            postCount={blog.count}
            identity={identity}
          />
        </div>
      </section>

      {/* A horizon with nothing below it — see the docblock. */}
      <div className="blog-seam" aria-hidden="true" />

      {/* ── the post ──────────────────────────────────────────────── */}
      <section className="hor-sky">
        <div className="hor-shell">
          <article className="pt-14 pb-12 sm:pt-16 sm:pb-14">
            <Prose html={html} />
          </article>

          <PostNav prev={prev} next={next} />
        </div>
      </section>
    </main>
  );
}
