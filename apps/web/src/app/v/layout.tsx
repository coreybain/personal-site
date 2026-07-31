import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * The `/v/*` segment: seven archived homepage explorations, kept and never
 * indexed.
 *
 * ── Why they stay ──────────────────────────────────────────────────────────
 *
 * They are the design record. Horizon — the current homepage — was chosen
 * *against* these six alternatives across two rounds, and `/variants` is the
 * page that shows the comparison. Deleting them would delete the argument.
 *
 * ── Why they must never be indexed ─────────────────────────────────────────
 *
 * Every one of them renders `@/lib/snapshot`'s mock rather than live Convex
 * data, and every one of them is a near-duplicate of the homepage: same person,
 * same claims, same figures, different typography. Indexed, they would do two
 * bad things at once — split the site's authority across eight pages competing
 * for one query, and put **fabricated telemetry** in front of a hiring manager
 * on a site whose entire argument is that its numbers are real.
 *
 * ── Why a layout, and why it is *additional* to robots.txt ─────────────────
 *
 * A layout because `robots` set here is inherited by all seven routes and by
 * anything added to this folder later — the failure mode of doing it per-page is
 * an eighth exploration that quietly ships indexable. The children set their own
 * `title` and `description` and touch nothing else, so those survive and this
 * merges in beneath them.
 *
 * `robots.ts` also disallows `/v/`, but the two are not redundant:
 *
 *   - robots.txt only takes effect *after cutover*, when the file stops saying
 *     `Disallow: /` and starts listing prefixes. This tag is unconditional, so
 *     these pages are noindex in every state the deployment can be in.
 *   - robots.txt governs *fetching*. A disallowed URL that is linked from
 *     somewhere else can still be indexed as a bare URL with no snippet; only a
 *     `noindex` the crawler is allowed to read prevents that. Which is the
 *     small irony worth writing down: after cutover, `Disallow: /v/` stops
 *     Googlebot fetching these pages and therefore stops it *seeing* this tag.
 *     Belt and braces, in that order, is why both exist.
 *
 * `nofollow` too: these pages link back to `/work` and `/contact` with mock
 * copy, and there is no reason to spend crawl budget rediscovering real pages
 * through fake ones.
 *
 * This layout renders nothing. Each exploration owns its own chrome — several
 * have a `layout.tsx` of their own for fonts and CSS — so the only thing this
 * segment adds is the directive.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ArchivedVariantsLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return children;
}
