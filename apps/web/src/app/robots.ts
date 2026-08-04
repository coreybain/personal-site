import type { MetadataRoute } from "next";

import { absoluteUrl, CRAWLER_DISALLOW, IS_INDEXABLE } from "@/lib/seo";

/**
 * /robots.txt — the ADR 018 index gate, at the door.
 *
 * ── Two states, and the default is "no" ────────────────────────────────────
 *
 * Until `NEXT_PUBLIC_SITE_INDEXABLE=true` this file emits a blanket
 * `Disallow: /` and **no `Sitemap:` line**. That is the state every build is in
 * — preview deployments, local, CI — because ADR 018's mitigation only works if
 * the half-built site cannot be found while `spiritdevs.com` is still the live
 * one. Omitting the sitemap reference matters as much as the disallow: a
 * `Sitemap:` line is an invitation, and pointing a crawler at a list of URLs it
 * has just been told not to fetch is a mixed signal that some crawlers resolve
 * in favour of the sitemap.
 *
 * After cutover it opens up, minus the two prefixes in `CRAWLER_DISALLOW` —
 * `/admin` and `/api` — which stay closed permanently. See
 * that constant for why each one is on the list.
 *
 * ── This is not the only lock ──────────────────────────────────────────────
 *
 * robots.txt is a *request*, honoured by well-behaved crawlers, and it governs
 * fetching rather than indexing — a disallowed URL that is linked from
 * elsewhere can still appear in an index as a bare URL. So the same gate is also
 * expressed as `robots: { index: false }` in the root layout's metadata, which
 * is an instruction rather than a request and travels with the page. Both read
 * `IS_INDEXABLE`, so they cannot disagree.
 *
 * ── Statically generated ───────────────────────────────────────────────────
 *
 * This is the `robots.ts` metadata-file convention — Next generates the actual
 * `/robots.txt` handler from this default export. It reads no request-time API
 * and no remote data — only two build-time-inlined `NEXT_PUBLIC_` values — so
 * it is statically generated once per deployment. Flipping the flag therefore
 * requires a rebuild, which is the correct friction for this particular switch.
 */
export default function robots(): MetadataRoute.Robots {
  if (!IS_INDEXABLE) {
    return {
      rules: { userAgent: "*", disallow: "/" },
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...CRAWLER_DISALLOW],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    /**
     * `Host:` names the canonical mirror when a site is reachable at more than
     * one hostname, which is exactly this site's cutover situation (ADR 017:
     * `coreybaines.com` primary, `spiritdevs.com` redirecting to it). Only
     * Yandex still reads it; it costs one line and is correct.
     */
    host: absoluteUrl("/"),
  };
}
