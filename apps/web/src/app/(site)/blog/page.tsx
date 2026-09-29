import type { Metadata } from "next";

import { BlogCoda } from "@/components/site/blog/BlogCoda";
import { BlogIntro } from "@/components/site/blog/BlogIntro";
import { PostGrid } from "@/components/site/blog/PostGrid";
import { PostIndex } from "@/components/site/blog/PostIndex";
import { PostViews } from "@/components/site/blog/PostViews";
import { Boundary } from "@/components/site/Boundary";
import { num, stampTime } from "@/components/site/format";
import { getPosts, getSiteData } from "@/lib/data";
import { countWord, deriveBlog } from "@/lib/derive";
import { IS_INDEXABLE } from "@/lib/seo";

import "./blog.css";

/**
 * ISR, five minutes — the same window every `(site)` page declares. The literal
 * is written out rather than imported from `REVALIDATE_SECONDS` because Next
 * requires this value to be statically analysable; see the ISR section of
 * `@/lib/data`'s header for why 300.
 */
export const revalidate = 300;

/**
 * `generateMetadata` rather than a `metadata` constant, for the usual reason —
 * the description counts real posts, and a module-scope object is built once per
 * process.
 *
 * Both reads are `cache()`d and metadata generation shares a request scope with
 * the render below, so this page costs one round of Convex queries in total, not
 * two.
 *
 * The empty description is written as a *statement*, not an apology. It is the
 * text a search result would show while the blog is empty, and "no posts yet"
 * indexed against Corey's name is worse than saying nothing at all — so it says
 * what the section is for and points at the work.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [{ identity, projects }, posts] = await Promise.all([
    getSiteData(),
    getPosts(),
  ]);
  const { count, totalMinutes, tags } = deriveBlog(posts);

  return {
    // Bare — the `(site)` layout's `title.template` supplies "— Corey Baines".
    title: "Writing",
    description:
      count === 0
        ? `Working notes from ${identity.name}, ${identity.role} at ${identity.company} — the decisions behind ${countWord(
            projects.length,
          ).toLowerCase()} production platforms. Nothing published yet.`
        : `${countWord(count)} ${
            count === 1 ? "post" : "posts"
          } by ${identity.name} on architecture, delivery and agent-assisted engineering — ${num(
            totalMinutes,
          )} minutes of reading across ${tags.length} subjects.`,
    alternates: { canonical: "/blog" },

    /**
     * ── ADR 018: the empty index asks not to be indexed ────────────────────
     *
     * The route always renders — hiding the nav entry is not the same as
     * removing the page, and an inbound link has to resolve. But an index with
     * nothing in it is a page whose honest content is "nothing published yet",
     * and that indexed under Corey's name is precisely the impression v2 gave.
     * So while `count === 0` the page says so, and the moment the first post is
     * published the directive disappears on its own — the same event that puts
     * "Writing" in the nav pill and `/blog` in the sitemap.
     *
     * ── Why it is also gated on `IS_INDEXABLE` ────────────────────────────
     *
     * A page's `robots` **replaces** the root layout's rather than merging with
     * it. Before cutover the root emits `noindex, nofollow, nocache`, which is
     * already strictly stronger than anything this needs to say — and emitting
     * `noindex, follow` here would have quietly *relaxed* the site-wide gate on
     * exactly one page. So this directive exists only in the state where it is
     * the stricter of the two: after cutover, when the root says `index`.
     * Before cutover the whole site is closed and this has nothing to add.
     */
    ...(count === 0 && IS_INDEXABLE
      ? { robots: { index: false, follow: true } }
      : null),
  };
}

/**
 * /blog — the writing index.
 *
 * ── ADR 018, on the page ───────────────────────────────────────────────────
 *
 * This route **always renders**, published posts or not. Hiding the nav entry
 * (which `showBlogInNav()` does, in the `(site)` layout) is not the same as
 * removing the page: an inbound link, a search result or a URL typed by someone
 * who read the admin has to resolve, and resolving to a 404 would be the site
 * telling a small lie about itself. So the empty case is designed rather than
 * guarded — see `<PostIndex>` for what the zero reads like, and `<BlogCoda>` for
 * where it sends you.
 *
 * ── Zones ──────────────────────────────────────────────────────────────────
 *
 * **With posts**, the page stays in the sky: the intro, a seam, then the posts
 * shown one of two ways behind a Posts | Index switch (`<PostViews>`), cards
 * by default. The index and the cards are the same list, and stacking them in
 * separate zones made the reader scroll past it twice before reaching anything
 * else.
 *
 * **Empty**, it keeps the three-zone grammar every other index uses: the page
 * crosses the horizon into the deck, where the index is the instrument that
 * reads `00`, then surfaces for `<BlogCoda>`.
 *
 * ── Reads ──────────────────────────────────────────────────────────────────
 *
 * Two `cache()`d readers, started together: the Snapshot (identity, the figures
 * the coda quotes) and the posts, which sit outside the Snapshot on purpose —
 * they have no mock fallback, because an empty blog must render as empty. Both
 * are read **once**, here, and passed down as props; nothing below this function
 * fetches.
 */
export default async function BlogPage() {
  const [{ identity, gitStats, projects, computedAt }, posts] =
    await Promise.all([getSiteData(), getPosts()]);

  const blog = deriveBlog(posts);

  return (
    <main>
      {/* ── above the horizon: what this section is ───────────────── */}
      <section className="hor-sky">
        <div className="hor-wash" aria-hidden="true" />
        <div className="hor-shell">
          <BlogIntro identity={identity} {...blog} />
        </div>
      </section>

      {blog.count > 0 ? (
        <>
          {/* A seam, not a horizon: the posts are one list shown two ways,
              so there is no instrument deck to cross into. Bare — the fade
              without the rule — because the toggle below already marks
              where the posts start. */}
          <div className="blog-seam blog-seam-bare" aria-hidden="true" />

          <section className="hor-sky">
            <div className="hor-shell">
              <PostViews
                cards={<PostGrid posts={blog.posts} />}
                index={<PostIndex posts={blog.posts} />}
              />
            </div>
          </section>
        </>
      ) : (
        <>
          <Boundary label={`Index · ${stampTime(computedAt)}`} />

          {/* ── below the horizon: the zero ───────────────────────── */}
          <div className="hor-deck-zone">
            <div className="hor-deck-grid" aria-hidden="true" />
            <div className="hor-shell pb-16 sm:pb-20">
              <PostIndex posts={blog.posts} />
            </div>
          </div>

          <Boundary direction="out" />

          {/* ── back above the horizon: the way out ───────────────── */}
          <section className="hor-sky">
            <div className="hor-shell">
              <BlogCoda gitStats={gitStats} projectCount={projects.length} />
            </div>
          </section>
        </>
      )}
    </main>
  );
}
