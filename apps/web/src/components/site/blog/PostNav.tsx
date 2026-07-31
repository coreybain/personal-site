import type { CSSProperties } from "react";
import Link from "next/link";

import { longDate } from "@/components/site/format";
import type { Post } from "@/lib/snapshot";

import { ArrowLeft, ArrowRight } from "./Glyphs";
import { PostCover } from "./PostCover";
import { dayOf } from "./meta";

/**
 * Sky zone, at the foot of a post. Where to go next, if there is a next.
 *
 * ── This is where the blog stops copying /work ─────────────────────────────
 *
 * `CaseNav` renders two cards *always*: the case-study list wraps, so the first
 * platform's "previous" is the last one, and no page has a dead corner. A blog
 * cannot do that. The list is a timeline, and wrapping from the newest post to
 * the oldest under a label that says "newer" would be a lie about chronology —
 * a small one, but this site's whole argument is that the things it prints are
 * true. So the ends are honest: one card, or on a blog with a single post, none
 * at all and the section does not render.
 *
 * The direction labels are in reading terms rather than array terms. `posts` is
 * newest first, so the *older* post is the later array entry — `deriveBlog().
 * neighbours` does that translation once so no caller has to think about it
 * twice.
 */

function delay(ms: number): CSSProperties {
  return { "--hor-delay": `${ms}ms` } as CSSProperties;
}

function NavCard({
  post,
  direction,
  ms,
}: {
  post: Post;
  direction: "older" | "newer";
  ms: number;
}) {
  const isNewer = direction === "newer";

  return (
    <Link
      href={`/blog/${post.slug}`}
      className={`hor-card hor-lift hor-rise blog-nav ${
        isNewer ? "blog-nav-newer" : ""
      }`}
      style={delay(ms)}
    >
      <div className="blog-nav-art">
        <PostCover cover={post.coverImage} size="tile" />
      </div>

      <div className="min-w-0 flex-1 py-1 pr-1">
        <span
          className={`hor-eyebrow ${isNewer ? "justify-end" : ""}`}
          style={{ display: "flex" }}
        >
          {isNewer ? null : <ArrowLeft />}
          {isNewer ? "Newer post" : "Older post"}
          {isNewer ? <ArrowRight /> : null}
        </span>
        <p className="hor-h3 mt-2 truncate">{post.title}</p>
        <p className="hor-micro mt-1.5 truncate">
          {longDate(dayOf(post.publishedAt))}
        </p>
      </div>
    </Link>
  );
}

export function PostNav({
  prev,
  next,
}: {
  /** The older post, or `null` at the end of the timeline. */
  prev: Post | null;
  /** The newer post, or `null` on the most recent one. */
  next: Post | null;
}) {
  if (prev === null && next === null) return null;

  return (
    <nav className="pt-16 pb-16 sm:pt-20 sm:pb-20" aria-label="Other posts">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <span className="hor-eyebrow">
          <span className="hor-mono">02</span>
          <span className="hor-tick" aria-hidden="true" />
          Keep reading
        </span>
        <Link href="/blog" className="hor-link hor-micro">
          All writing
        </Link>
      </div>

      {/* Two columns even with one card, so a post at either end of the
          timeline keeps the same measure as one in the middle rather than
          stretching a lone card across the shell. Older on the left, newer on
          the right — the timeline runs the way it is read. The empty `<div>`
          holds the left column open when the oldest post has no older
          neighbour; the right needs no placeholder because there is nothing
          after it to align. */}
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        {prev ? <NavCard post={prev} direction="older" ms={60} /> : <div />}
        {next ? <NavCard post={next} direction="newer" ms={120} /> : null}
      </div>
    </nav>
  );
}
