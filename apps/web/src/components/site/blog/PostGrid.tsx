import type { CSSProperties } from "react";
import Link from "next/link";

import { longDate } from "@/components/site/format";
import { SkyHead } from "@/components/site/Panel";
import type { BlogDerived } from "@/lib/derive";
import { countWord, pad2, readingMinutes } from "@/lib/derive";
import type { Post } from "@/lib/snapshot";

import { ArrowRight } from "./Glyphs";
import { PostCover } from "./PostCover";
import { dayOf } from "./meta";

/**
 * Sky zone again — the page has surfaced, so the cards go back to rounded
 * glass, generous padding and sans type.
 *
 * The newest post gets the full width and a letterbox cover; the rest run three
 * across. Exactly the shape /work uses for its case studies, on purpose: the two
 * indexes are the same gesture, and a reader who has seen one should not have to
 * learn the other.
 *
 * Renders nothing at all on an empty blog. That is not a guard against a
 * half-seeded deployment (the way `WorkGrid`'s is) — it is the supported launch
 * state, and `<BlogCoda>` takes this slot instead. See ADR 018.
 *
 * ── Why the cover image is required here and nowhere else ──────────────────
 *
 * `coverImage` is a required field on the `posts` row, which makes the blog the
 * one section of the site that can lead with a real photograph rather than
 * procedural art. That is the thesis of the whole rebuild — the v2 homepage had
 * 548 words and zero images — so the cover is the largest thing on a card and
 * the copy arranges itself underneath it.
 */

/** Tags shown on a compact card before the overflow chip takes over. */
const TAG_LIMIT = 3;

function delay(ms: number): CSSProperties {
  return { "--hor-delay": `${ms}ms` } as CSSProperties;
}

function Tags({ tags, limit }: { tags: string[]; limit?: number }) {
  const shown = limit ? tags.slice(0, limit) : tags;
  const rest = tags.length - shown.length;

  return (
    <ul className="blog-tags">
      {shown.map((tag) => (
        <li key={tag} className="hor-chip">
          {tag}
        </li>
      ))}
      {rest > 0 ? (
        <li className="hor-chip" aria-label={`and ${rest} more`}>
          +{rest}
        </li>
      ) : null}
    </ul>
  );
}

/** Date · reading estimate. The same line, in the same order, on every card. */
function CardMeta({ post }: { post: Post }) {
  return (
    <p className="hor-micro">
      <time dateTime={post.publishedAt}>{longDate(dayOf(post.publishedAt))}</time>
      {" · "}
      {readingMinutes(post)} min read
    </p>
  );
}

function LeadCard({ post }: { post: Post }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="hor-card hor-lift hor-rise blog-card p-2.5"
      style={delay(60)}
    >
      <PostCover cover={post.coverImage} size="hero" />

      <div className="grid gap-x-12 gap-y-6 px-3 pt-6 pb-3 sm:px-4 sm:pt-7 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start">
        <div>
          <div className="flex items-center gap-3">
            <span className="hor-label">{pad2(1)}</span>
            <span className="hor-vrule hor-vrule-sm" aria-hidden="true" />
            <span className="hor-label">Latest</span>
          </div>
          <h3 className="hor-h2 mt-3.5 text-balance">{post.title}</h3>
          <div className="mt-3.5">
            <CardMeta post={post} />
          </div>
        </div>

        <div>
          <p className="hor-lede text-pretty">{post.excerpt}</p>
          <div className="mt-5">
            <Tags tags={post.tags} />
          </div>
          <span className="blog-cta mt-5 inline-flex">
            Read the post
            <ArrowRight />
          </span>
        </div>
      </div>
    </Link>
  );
}

function PostCard({ post, index }: { post: Post; index: number }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="hor-card hor-lift hor-rise blog-card p-2.5"
      style={delay(120 + index * 60)}
    >
      <PostCover cover={post.coverImage} size="tile" />

      <div className="flex flex-1 flex-col px-2.5 pt-5 pb-2.5 sm:px-3">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="hor-h3 text-pretty">{post.title}</h3>
          <span className="hor-label">{pad2(index + 1)}</span>
        </div>

        <div className="mt-2.5">
          <CardMeta post={post} />
        </div>

        <p className="hor-body blog-clamp mt-3.5 text-pretty">{post.excerpt}</p>

        <div className="mt-4">
          <Tags tags={post.tags} limit={TAG_LIMIT} />
        </div>

        <span className="blog-cta mt-5 inline-flex self-start">
          Read
          <ArrowRight />
        </span>
      </div>
    </Link>
  );
}

export function PostGrid({ posts }: Pick<BlogDerived, "posts">) {
  const [lead, ...rest] = posts;

  if (!lead) return null;

  return (
    <section className="pt-16 pb-16 sm:pt-20 sm:pb-20 lg:pt-24">
      <SkyHead
        index="02"
        eyebrow="Posts"
        title="Every note has a page."
        lede="Long enough to be worth the argument, short enough to finish. Dates are first-publication dates and never move."
        aside={
          <span className="hor-pill">
            <span
              className="block h-[7px] w-[7px] rounded-full"
              style={{ background: "var(--hor-accent)" }}
              aria-hidden="true"
            />
            {countWord(posts.length)} {posts.length === 1 ? "post" : "posts"}
          </span>
        }
      />

      <div className="grid gap-4 sm:gap-5">
        <LeadCard post={lead} />

        {rest.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
            {rest.map((post, i) => (
              <PostCard key={post.slug} post={post} index={i + 1} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
