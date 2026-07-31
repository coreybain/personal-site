import type { MetadataRoute } from "next";

import { getPosts, getSiteData } from "@/lib/data";
import { absoluteUrl } from "@/lib/seo";

/**
 * /sitemap.xml — every page on the public site, and nothing else.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 *
 *   /v/*, /variants   The seven archived homepage explorations and their index.
 *                     They are a kept design record, they render the mock, and
 *                     each is a near-duplicate of the homepage with invented
 *                     numbers. They also carry route-level `noindex`; the
 *                     absence here is the quiet half of the same decision.
 *   /admin, /api      Gated, and not pages.
 *   /blog             Only while it has nothing in it — see below.
 *   /ask              Not absent — **gone**. Ask Corey is a launcher in the
 *                     `(site)` layout now, not a route, and there is no URL
 *                     left to submit.
 *
 * A sitemap is a positive assertion ("these are worth crawling"), so the right
 * way to exclude something is to not mention it. There is no `exclude` list in
 * this file for the same reason there is no list of pages that do not exist.
 *
 * ── `lastModified` is real or it is the snapshot ───────────────────────────
 *
 * Posts have a genuine per-row date: `publishedAt`, stamped once by
 * `posts.publish`. Everything else on this site is a projection of the Snapshot
 * — the homepage's telemetry, the work grid's figures, the resume's live signal
 * all change exactly when `computedAt` changes and not otherwise — so
 * `computedAt` is not a stand-in for a missing date, it *is* the date those
 * documents last changed.
 *
 * The one place that is approximate is `/work/[slug]`: the `Project` contract
 * carries no timestamp (the Convex row's `_creationTime` is dropped by
 * `mapProject`), so a case study reports the snapshot instant like its index
 * does. That over-reports slightly rather than under-reporting, which is the
 * safe direction for a recrawl hint.
 *
 * ── Reads ──────────────────────────────────────────────────────────────────
 *
 * Two `cache()`d readers, started together — the same two `/blog` itself uses.
 * This is a Route Handler with its own request scope, so it does not share the
 * pages' reads; one round of queries per regeneration, every 300 seconds at
 * most, is the whole cost.
 *
 * `revalidate` is declared for the same reason every page declares it: without
 * it this file would be generated once at build and a post published from the
 * admin would be missing from the sitemap until the next deploy, while the /blog
 * index (revalidating every five minutes) already listed it.
 */
export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ projects, computedAt }, posts] = await Promise.all([
    getSiteData(),
    getPosts(),
  ]);

  /**
   * `changeFrequency` and `priority` are hints, and Google ignores both. They
   * are here because the sitemap protocol defines them and other crawlers do
   * read them, and they are set from what is actually true of each route: the
   * homepage and /fun move whenever the cron or the phone posts; a case study
   * changes when it is edited; /resume is the page a hiring manager is being
   * sent to, so it ranks with the homepage.
   */
  const snapshotStamp = new Date(computedAt);

  const entries: MetadataRoute.Sitemap = [
    {
      url: absoluteUrl("/"),
      lastModified: snapshotStamp,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: absoluteUrl("/work"),
      lastModified: snapshotStamp,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: absoluteUrl("/resume"),
      lastModified: snapshotStamp,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: absoluteUrl("/labs"),
      lastModified: snapshotStamp,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    /*
     * `/ask` used to be submitted here. It is not a route any more — Ask Corey
     * became a launcher mounted in the `(site)` layout — and a widget has no
     * URL to crawl, so the line is gone rather than redirected. Nothing is lost
     * for a crawler: everything Ask Corey could ever quote is the published
     * text of the pages already listed in this file.
     */
    {
      url: absoluteUrl("/contact"),
      lastModified: snapshotStamp,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: absoluteUrl("/fun"),
      lastModified: snapshotStamp,
      changeFrequency: "daily",
      priority: 0.5,
    },
  ];

  for (const project of projects) {
    entries.push({
      url: absoluteUrl(`/work/${project.slug}`),
      lastModified: snapshotStamp,
      changeFrequency: "monthly",
      priority: 0.8,
    });
  }

  /**
   * ── ADR 018: the blog appears here only once it exists ──────────────────
   *
   * `/blog` always *renders* — an inbound link has to resolve, and the empty
   * state is designed rather than guarded. Submitting it while empty is a
   * different claim: it tells a crawler an index of writing is worth fetching
   * and hands it a page whose honest content is "nothing published yet", which
   * is the soft-404 shape and is the exact impression v2 gave. So the section
   * enters the sitemap on the same event that puts it in the nav — the first
   * published post.
   *
   * `posts` arrives newest-first off `by_published_publishedAt`, so `[0]` is
   * the freshest and is the index's real last-modified date.
   */
  if (posts.length > 0) {
    entries.push({
      url: absoluteUrl("/blog"),
      lastModified: new Date(posts[0].publishedAt),
      changeFrequency: "weekly",
      priority: 0.7,
    });

    for (const post of posts) {
      entries.push({
        url: absoluteUrl(`/blog/${post.slug}`),
        lastModified: new Date(post.publishedAt),
        changeFrequency: "yearly",
        priority: 0.6,
      });
    }
  }

  return entries;
}
