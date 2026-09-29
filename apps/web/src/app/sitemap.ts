import type { MetadataRoute } from "next";

import { getPosts, getSiteData } from "@/lib/data";
import { absoluteUrl } from "@/lib/seo";

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
