/**
 * The one conversion the blog needs that `@/components/site/format` does not
 * already provide.
 *
 * `format.ts` splits its date helpers by input: `stamp`/`longDate` take a
 * calendar day (`2026-03-03`) and `stampTime` takes an instant
 * (`2026-03-03T06:00:00Z`). `posts.publishedAt` is an instant, but a post is
 * dated by its *day* — nobody wants "06:00 UTC" under a headline, and the
 * snapshot stamp in the footer is the only place on this site where the time of
 * day is load-bearing.
 *
 * So the blog takes the day out of the instant, and does it by slicing the
 * string rather than by constructing a `Date`. That is not laziness: an ISO
 * instant stored by Convex is always UTC and always fixed-width (schema.ts
 * guarantees both — it is what makes the `by_published_publishedAt` index sort
 * correctly), and `new Date(iso).getDate()` would reintroduce exactly the
 * timezone drift `parseIso` exists to avoid. The first ten characters are the
 * UTC calendar day by construction.
 */

/** `2026-03-03T06:00:00Z` → `2026-03-03`. UTC, always. */
export function dayOf(isoInstant: string): string {
  return isoInstant.slice(0, 10);
}
