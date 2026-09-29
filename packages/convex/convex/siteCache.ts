/**
 * siteCache.ts — tells the public site to drop its cached copies of posts.
 *
 * The site caches post reads under the `posts` cache tag (apps/web
 * `lib/data.ts`). Whenever a post goes live, comes down, or a live post's
 * content changes, `lib/postOperations.ts` schedules `revalidatePosts`, which
 * calls the site's `/api/revalidate` route so the change is visible on the next
 * request rather than after the five-minute refresh. The preview area also
 * calls `updateTag` itself from its Server Actions; this covers every other
 * path — MCP, the scheduler and the Convex CLI.
 *
 * Configuration lives in the Convex deployment environment:
 *
 *   SITE_ORIGIN              e.g. https://spiritdevs.com
 *   SITE_REVALIDATE_SECRET   shared with the site's REVALIDATE_SECRET
 *
 * With either unset (local tests, a fresh deployment) the call is skipped and
 * logged; the five-minute refresh still applies, so nothing breaks.
 */
import { internalAction } from './_generated/server';

export const revalidatePosts = internalAction({
  args: {},
  handler: async () => {
    const origin = process.env.SITE_ORIGIN?.trim().replace(/\/+$/, '');
    const secret = process.env.SITE_REVALIDATE_SECRET?.trim();
    if (!origin || !secret) {
      console.log('[siteCache] SITE_ORIGIN or SITE_REVALIDATE_SECRET unset; relying on the five-minute refresh.');
      return { revalidated: false as const };
    }

    const response = await fetch(`${origin}/api/revalidate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tags: ['posts'] }),
      redirect: 'error',
    });
    if (!response.ok) {
      // Thrown so the failure is visible in the Convex logs. Nothing retries it:
      // the five-minute refresh is the fallback.
      throw new Error(`Site revalidation failed with HTTP ${response.status}.`);
    }
    return { revalidated: true as const };
  },
});
