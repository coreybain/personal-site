import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

const nextConfig: NextConfig = {
  /**
   * Cache Components (Next 16): pages prerender to a static shell, and live
   * data is cached per function with `'use cache'` + `cacheLife`, replacing the
   * old per-route `export const revalidate = 300`. See `@/lib/data` for the
   * cached reads and docs/plans/preview-area.md for why posts carry a tag.
   */
  cacheComponents: true,
  cacheLife: {
    /**
     * Every live read on the public site. Refreshed in the background once a
     * copy is five minutes old — the same window the site's ISR used — so
     * nothing public is more than about five minutes behind Convex. `expire`
     * is long on purpose: if Convex is unreachable the last good copy keeps
     * serving, exactly as ISR kept the last good page.
     */
    site: {
      stale: 300,
      revalidate: 300,
      expire: 60 * 60 * 24 * 30,
    },
  },
  images: {
    /**
     * Post covers are Uploadfile URLs (ADR 020). Listing the host lets
     * `next/image` resize and re-encode them (AVIF/WebP) instead of shipping
     * the 1–2 MB source PNG — which on /blog, where the lead card's cover is the
     * LCP element, was the difference between ~0.8 s and ~3 s.
     */
    // `www.uploadfile.dev/f/…` is the stored URL; it redirects to the storage
    // host, which the optimiser follows, so both are allowed.
    remotePatterns: [
      new URL("https://www.uploadfile.dev/f/**"),
      new URL("https://files.uploadfile.dev/production/**"),
    ],
  },
  experimental: {
    /**
     * Contact submissions may include up to 4 MB of attachments. The default
     * Server Action limit is 1 MB, so leave one megabyte for multipart fields
     * and React's action envelope while keeping the public request bounded.
     */
    serverActions: { bodySizeLimit: "5mb" },
  },
  /**
   * Deliberately no `outputFileTracingIncludes` for the résumé PDF's fonts.
   *
   * The obvious reading of `@home/pdf` is that it reads five `.woff` files off
   * disk at render time and therefore needs `packages/pdf/assets/fonts` forced
   * into `/api/resume.pdf`'s trace. It does not. Turbopack recognises each
   * `new URL('../assets/fonts/…', import.meta.url)` in that package as an asset
   * reference, copies the file to `.next/server/assets/<name>.<hash>.woff`, and
   * rewrites the expression to point there — verified by reading the compiled
   * route and its `.nft.json`. Tracing the originals would ship 170 KB the
   * function never opens.
   *
   * It would also not be a fix for the failure it looks like it prevents: a
   * build that *didn't* rewrite the URL would resolve `../assets/fonts/`
   * relative to a chunk inside `.next`, where a traced copy of the source tree
   * is not. What actually keeps this working is that every specifier in
   * `packages/pdf/src/fonts.ts` is a string literal, which is documented at
   * length there, next to the bug that taught us.
   */
};

export default withBotId(nextConfig);
