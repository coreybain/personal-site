/**
 * ArticleJsonLd — one `Article`, on `/blog/[slug]`.
 *
 * ── Ownership ──────────────────────────────────────────────────────────────
 *
 * The blog routes belong to the writing pass; structured data belongs to the
 * SEO pass. This component is the seam: it lives here with the rest of the
 * graph, so `@id` stability, the Person reference and the escaping rule are all
 * decided in one place, and `/blog/[slug]` imports it and hands it the post it
 * has already read. Nothing about it needs to be understood to edit a post page,
 * and nothing about the post page needs to be understood to change the graph.
 *
 * ── `Article`, not `BlogPosting` ───────────────────────────────────────────
 *
 * `BlogPosting` is a subtype and would be defensible, but it asserts membership
 * of a `Blog` — which would then want its own node, an `blogPost` back-reference
 * and a decision about what an empty blog is (ADR 018 says the section may
 * launch with nothing in it). `Article` makes the claim that is true of every
 * post regardless of how many exist, and Google treats the two identically.
 *
 * ── What is here because the row carries it ────────────────────────────────
 *
 *   headline        the title. Trimmed at 110 characters — the documented limit
 *                   above which the annotation is ignored outright.
 *   datePublished   the first-publication instant, stamped once by
 *                   `posts.publish` and never re-dated, so fixing a typo does
 *                   not move the post to the top of a feed.
 *   dateModified    deliberately absent. The row has no `updatedAt` the public
 *                   read layer can see, and inventing one from `computedAt`
 *                   would claim every post was edited whenever the cron ran.
 *   image           the cover, absolute already (UploadThing, ADR 010).
 *   timeRequired    the reading estimate the index prints, in ISO 8601 duration
 *                   form. The page and the graph quote the same number because
 *                   both call `readingMinutes()`.
 *
 * Server component, no client JS.
 */

import { readingMinutes } from "@/lib/derive";
import { absoluteUrl } from "@/lib/seo";
import type { Identity, Post } from "@/lib/snapshot";

import { JsonLd } from "./JsonLd";
import { graph, personStub, websiteStub } from "./schema";

/** The length beyond which a `headline` is ignored rather than truncated. */
const HEADLINE_MAX = 110;

export function ArticleJsonLd({
  post,
  identity,
}: {
  post: Post;
  identity: Identity;
}) {
  const url = absoluteUrl(`/blog/${post.slug}`);

  return (
    <JsonLd
      data={graph({
        "@type": "Article",
        "@id": `${url}#article`,
        url,
        headline: post.title.slice(0, HEADLINE_MAX),
        description: post.excerpt,
        inLanguage: "en-AU",
        datePublished: post.publishedAt,
        // Stubs, not bare `@id`s: this page does not declare the Person, and
        // Google requires `author.name` on an Article. Same `@id` as the full
        // node on / and /resume, so the two merge rather than multiply.
        author: personStub(identity),
        publisher: personStub(identity),
        isPartOf: websiteStub(identity),
        // The canonical document this markup describes. Required for the
        // annotation to attach to the page rather than float free of it.
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
        image: [post.coverImage.url],
        timeRequired: `PT${readingMinutes(post)}M`,
        ...(post.tags.length > 0 ? { keywords: [...post.tags] } : null),
      })}
    />
  );
}
