/**
 * seo.ts — the site's public identity as a machine sees it: which host it lives
 * on, and whether it is allowed to be found yet.
 *
 * Two environment variables and nothing else. Both are read **once, here**, so
 * `robots.ts`, `sitemap.ts`, the root layout, every canonical link and every
 * JSON-LD `@id` are all arguing from the same string — a canonical that pointed
 * at a different host than the sitemap would be worse than having neither.
 *
 * ── Why `NEXT_PUBLIC_` on both ─────────────────────────────────────────────
 *
 * Neither is a secret (one is the site's own address, the other is a boolean
 * that is *observable* the moment you fetch /robots.txt), and `NEXT_PUBLIC_`
 * buys the property that matters: it is inlined at **build** time. That is
 * exactly right for an index gate. A variable read from the process at cold
 * start could flip between two ISR revalidations and leave half the prerendered
 * HTML on the CDN saying `noindex` and half saying nothing; inlining means the
 * whole deployment agrees with itself, and changing the answer requires a
 * rebuild — which is the correct amount of friction for "become findable".
 *
 * Nothing under `src/components` imports this in a `"use client"` module, so
 * despite the prefix neither value ships in a client chunk today. If one ever
 * needs to, it costs a few dozen bytes and no secret.
 *
 * ── ADR 017 ────────────────────────────────────────────────────────────────
 *
 * `coreybaines.com` is primary. `spiritdevs.com` becomes a redirect at cutover.
 * That is why every URL this module produces is absolute and rooted at
 * `SITE_URL` rather than at whatever host served the request: a Vercel preview
 * deployment, a `*.vercel.app` alias and the production domain must all emit the
 * *same* canonical, or the preview competes with the site it is previewing.
 */

/**
 * The production origin, normalised to `scheme://host` with no trailing slash.
 *
 * The default is the real answer rather than a placeholder: ADR 017 settled the
 * primary domain, so a checkout with no environment at all still produces
 * correct absolute URLs, and `NEXT_PUBLIC_SITE_URL` exists for previews and for
 * anyone who forks this.
 *
 * Trailing slashes are stripped because `metadataBase` composition and manual
 * `${SITE_URL}${path}` concatenation disagree about them — Next normalises
 * duplicate slashes for `metadataBase`, but the JSON-LD `@id`s below are built
 * by hand and would otherwise carry `//#person`.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://coreybaines.com"
).replace(/\/+$/, "");

/**
 * `metadataBase` for the root layout: the base every relative URL in the
 * Metadata API resolves against — `alternates.canonical`, `openGraph.images`,
 * the generated OG route.
 *
 * A `URL`, not a string, because that is the type Next requires. Constructed
 * once at module scope so a malformed `NEXT_PUBLIC_SITE_URL` fails the build
 * loudly here rather than producing a page of subtly wrong links.
 */
export const METADATA_BASE = new URL(SITE_URL);

/**
 * Whether search engines may index **anything**. Ships `false` (ADR 018).
 *
 * The comparison is against the exact string `"true"`, so every other value —
 * unset, empty, `"1"`, `"yes"`, `"TRUE"` — reads as "not yet". A gate whose
 * failure mode is "accidentally indexed the unfinished site under Corey's name
 * while he is job-hunting" only gets to fail closed.
 *
 * Set it exactly once, at cutover, on the production deployment:
 *
 *     NEXT_PUBLIC_SITE_INDEXABLE=true
 *
 * Never on a preview. The whole point of ADR 018's mitigation is that the build
 * happens against a preview URL while `spiritdevs.com` stays live, and a preview
 * that indexes itself is the one way that mitigation can backfire.
 */
export const IS_INDEXABLE = process.env.NEXT_PUBLIC_SITE_INDEXABLE === "true";

/**
 * Paths that are disallowed to crawlers **even after cutover**.
 *
 *   /admin     Clerk-gated CRUD. Already `noindex` in its own layout metadata;
 *              this is the second lock, on the door rather than the room.
 *   /api       Route handlers — uploadthing today, more later. Never a page.
 *
 * These are the same two prefixes `sitemap.ts` refuses to emit. Independent
 * mechanisms are deliberate — robots.txt is a request, a `<meta>` is an
 * instruction, and an absent sitemap entry is silence.
 */
export const CRAWLER_DISALLOW = ["/admin", "/api"] as const;

/**
 * An absolute URL on the production origin.
 *
 * Used for the things Next will not resolve for us: JSON-LD `@id` and `url`
 * fields, the `Sitemap:` line in robots.txt, and every entry in the sitemap
 * (which the protocol requires be absolute). Metadata fields do **not** need
 * this — they have `metadataBase` — and passing an absolute URL there would
 * silently opt that field out of the base, so prefer a relative path in
 * `alternates` and `openGraph`.
 *
 * `"/"` maps to the bare origin rather than to `https://host/`, so the person
 * `@id` and the homepage `url` in the graph are the same string a browser shows.
 */
export function absoluteUrl(path: string): string {
  if (path === "/" || path === "") return SITE_URL;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
