import type { CSSProperties } from "react";

import { longDate } from "@/components/site/format";
import { pad2, readingMinutes } from "@/lib/derive";
import type { Identity, Post } from "@/lib/snapshot";

import { PostCover } from "./PostCover";
import { dayOf } from "./meta";

/**
 * Sky zone. The head of a post: where you are, what it is, when it was written,
 * and the cover.
 *
 * Structurally identical to `CaseHero` — index stamp, display title, a metadata
 * row of full-ink facts separated by rules, then the standfirst — because a post
 * and a case study are the same site making a claim at different lengths.
 *
 * ── The date is the published date, and it never moves ─────────────────────
 *
 * `publishedAt` is stamped once, by the `publish` mutation, and preserved
 * through every later unpublish/republish cycle (see posts.ts). So the `<time>`
 * below is a fact about the writing rather than a fact about the deployment,
 * which is the entire reason that mutation is separate from `update`. The
 * machine-readable attribute carries the full instant; the reader sees the day.
 *
 * The cover is the LCP element on this route — it is the largest thing above the
 * fold — so it is the one image on the site that asks for priority. Its box is
 * reserved by `aspect-ratio` in blog.css, so asking for it early costs no layout
 * shift.
 */

function delay(ms: number): CSSProperties {
  return { "--hor-delay": `${ms}ms` } as CSSProperties;
}

export function PostHero({
  post,
  index,
  postCount,
  identity,
}: {
  post: Post;
  /** Zero-based position in the published list, newest first. */
  index: number;
  postCount: number;
  identity: Identity;
}) {
  return (
    <header className="pt-24 pb-14 sm:pt-28 sm:pb-16 lg:pt-32">
      <div className="hor-rise" style={delay(80)}>
        <span className="hor-eyebrow">
          <span className="hor-mono">
            {pad2(index + 1)} / {pad2(postCount)}
          </span>
          <span className="hor-tick" aria-hidden="true" />
          Writing
        </span>
      </div>

      <h1
        className="hor-display hor-rise mt-5 text-balance sm:mt-6"
        style={delay(130)}
      >
        {post.title}
      </h1>

      <div
        className="hor-rise mt-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:mt-7"
        style={delay(180)}
      >
        <span
          className="block h-[9px] w-[9px] rounded-full"
          style={{ background: "var(--hor-accent)" }}
          aria-hidden="true"
        />
        <time
          className="hor-body"
          style={{ color: "var(--hor-ink)" }}
          dateTime={post.publishedAt}
        >
          {longDate(dayOf(post.publishedAt))}
        </time>
        <span className="hor-vrule" aria-hidden="true" />
        <span className="hor-body" style={{ color: "var(--hor-ink)" }}>
          {readingMinutes(post)} min read
        </span>
        <span className="hor-vrule" aria-hidden="true" />
        <span className="hor-body">{identity.name}</span>
      </div>

      <p
        className="hor-lede hor-rise mt-7 max-w-[62ch] text-pretty"
        style={delay(230)}
      >
        {post.excerpt}
      </p>

      {post.tags.length > 0 ? (
        <ul className="blog-tags hor-rise mt-6" style={delay(270)}>
          {post.tags.map((tag) => (
            <li key={tag} className="hor-chip">
              {tag}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="hor-rise mt-10 sm:mt-12" style={delay(320)}>
        <PostCover cover={post.coverImage} size="hero" priority />
        {post.coverImage.caption ? (
          <p className="hor-micro mt-3">{post.coverImage.caption}</p>
        ) : null}
      </div>
    </header>
  );
}
