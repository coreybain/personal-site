import Link from "next/link";

import { stamp } from "@/components/site/format";
import { Panel } from "@/components/site/Panel";
import type { BlogDerived } from "@/lib/derive";
import { pad2, readingMinutes } from "@/lib/derive";

import { dayOf } from "./meta";

/**
 * Deck zone. The index of everything published — or, when nothing is, the
 * instrument that says so.
 *
 * ── The empty state ────────────────────────────────────────────────────────
 *
 * ADR 018 permits the blog to launch with nothing in it, so "no posts" is a
 * designed state and not a fallback. The design is the one the rest of the site
 * already speaks: **an instrument reading zero.** A dial at `00` is not an
 * error — every readout below the horizon on this site is a real measurement,
 * and this is a real measurement too.
 *
 * What it deliberately is not: a dashed-outline box, an illustration, a
 * "coming soon", or the sentence v2 shipped — "No blog posts published yet" —
 * which ADR 018 names as the flaw to avoid repeating. The difference between
 * that and this is that this one *volunteers the reason*, in the same voice the
 * rest of the page uses, and then points somewhere useful (the coda in the sky
 * zone below).
 *
 * ── The populated state ────────────────────────────────────────────────────
 *
 * One row per post: index, title, tags, date, reading estimate. Mono
 * throughout, because this is deck material and the deck's numerals are
 * machined. The whole row is the link — a title-only target is a 40px-wide hit
 * area on a page whose readers are as likely to be on a phone as not.
 */

export function PostIndex({ posts }: Pick<BlogDerived, "posts">) {
  if (posts.length === 0) {
    return (
      <section className="pt-16 sm:pt-20">
        <Panel label="Index" meta="00 published" padded={false} delay={60}>
          <div className="blog-empty">
            <div className="blog-empty-readout">
              <span className="blog-empty-zero">00</span>
              <span className="hor-label">posts</span>
            </div>

            <div className="blog-empty-copy">
              <p className="hor-body">
                That is the reading, not a failed query. Everything else on this
                site is a real measurement and so is this one.
              </p>
              <p className="hor-body">
                The section stays out of the navigation until the first post is
                published — a nav key promising something that is not there is
                the specific mistake this rebuild exists to stop making. The
                page and its address work either way, which is why you are
                reading this rather than a 404.
              </p>
            </div>
          </div>
        </Panel>
      </section>
    );
  }

  return (
    <section className="pt-16 sm:pt-20">
      <Panel
        label="Index"
        meta={`${pad2(posts.length)} published`}
        padded={false}
        delay={60}
      >
        {posts.map((post, index) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="blog-row"
            /* The row already reads "01 · Title · 4 min"; the tags are the one
               part a screen reader would otherwise hear as a bare word list
               with no relationship to it. */
            aria-label={`${post.title} — published ${stamp(dayOf(post.publishedAt))}`}
          >
            <span className="hor-label" aria-hidden="true">
              {pad2(index + 1)}
            </span>

            <span className="blog-row-title">
              <span className="hor-readout-sm block truncate">{post.title}</span>
              {post.tags.length > 0 ? (
                <span className="hor-micro mt-1 block truncate">
                  {post.tags.join(" · ")}
                </span>
              ) : null}
            </span>

            <span className="blog-row-meta hor-label whitespace-nowrap">
              {stamp(dayOf(post.publishedAt))} · {readingMinutes(post)} min
            </span>
          </Link>
        ))}
      </Panel>
    </section>
  );
}
